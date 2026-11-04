import { LINKS } from '@oes/shared';
import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../infra/prisma.service';
import { AuditService } from '../audit/audit.service';
import { scope, type AuthUser } from '../../common/auth';
import { badRequest, conflict, forbidden, notFound } from '../../common/errors';
import type { Prisma } from '../../generated/prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { DeliveryService } from '../delivery/delivery.service';
import { CourseAccessService } from '../org/course-access.service';

export interface ExamInput {
  code: string; title: string; courseId: string; term: string;
  opensAt: Date; closesAt: Date; durationMin: number; passPercent: number; negativeMarking: number; timingPolicy?: 'INDIVIDUAL' | 'SYNCHRONIZED'; controlMode?: 'AUTOMATIC' | 'MANUAL';
  shuffleQuestions: boolean; instructions?: string; institutionIds: string[];
}

@Injectable()
export class ExamsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly notifications: NotificationsService, private readonly delivery: DeliveryService, private readonly access: CourseAccessService) {}

  /** An exam is visible to campus-scoped users only if one of their institutions participates in it. */
  examScope(u: AuthUser): Prisma.ExamWhereInput {
    return u.institutionIds === null ? {} : { institutions: { some: { institutionId: { in: u.institutionIds } } } };
  }

  async load(u: AuthUser, id: string) {
    const e = await this.prisma.exam.findFirst({
      where: { id, ...this.examScope(u) },
      include: { course: { include: { program: { select: { code: true } } } }, institutions: { include: { institution: { select: { id: true, code: true, name: true } } } }, _count: { select: { questions: true, candidates: true, attempts: true } } },
    });
    if (!e) throw notFound('Exam');
    return e;
  }

  /**
   * What a caller may see of an exam. `load()` stays unfiltered for internal logic; anything returned over HTTP goes through here so a
   * campus-scoped user receives neither the other participating campuses nor candidate/attempt counts for campuses outside their scope.
   */
  async detail(u: AuthUser, id: string) {
    const e = await this.load(u, id);
    const sf = scope.filter(u);
    if (!sf) return e;
    const [candidates, attempts] = await Promise.all([
      this.prisma.examCandidate.count({ where: { examId: id, institutionId: sf } }),
      this.prisma.attempt.count({ where: { examId: id, student: { institutionId: sf } } }),
    ]);
    return { ...e, institutions: e.institutions.filter((i) => scope.allows(u, i.institutionId)), _count: { ...e._count, candidates, attempts } };
  }

  async list(u: AuthUser, q: { status?: string; courseId?: string; page: number; pageSize: number }) {
    const where: Prisma.ExamWhereInput = { ...this.examScope(u), status: q.status as never, courseId: q.courseId };
    const sf = scope.filter(u);
    const [items, total] = await Promise.all([
      this.prisma.exam.findMany({ where, orderBy: { opensAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: {
        course: { select: { code: true, title: true } },
        institutions: { where: sf ? { institutionId: sf } : undefined, select: { institutionId: true } },
        _count: { select: { questions: true, candidates: sf ? { where: { institutionId: sf } } : true, attempts: sf ? { where: { student: { institutionId: sf } } } : true } } } }),
      this.prisma.exam.count({ where }),
    ]);
    return { items, total };
  }

  async create(u: AuthUser, d: ExamInput, ip?: string) {
    if (d.closesAt <= d.opensAt) throw badRequest('The exam window must close after it opens');
    if (d.durationMin > (d.closesAt.getTime() - d.opensAt.getTime()) / 60000) throw badRequest('Duration cannot exceed the length of the exam window');
    const insts = await this.prisma.institution.count({ where: { id: { in: d.institutionIds }, active: true } });
    if (insts !== d.institutionIds.length || !insts) throw badRequest('One or more participating institutions are invalid or inactive');
    const e = await this.prisma.exam.create({
      data: { code: d.code, title: d.title, courseId: d.courseId, term: d.term, createdBy: u.id, opensAt: d.opensAt, closesAt: d.closesAt, durationMin: d.durationMin, passPercent: d.passPercent, negativeMarking: d.negativeMarking, timingPolicy: d.timingPolicy ?? 'INDIVIDUAL', controlMode: d.controlMode ?? 'AUTOMATIC', shuffleQuestions: d.shuffleQuestions, instructions: d.instructions, institutions: { create: d.institutionIds.map((institutionId) => ({ institutionId })) } },
    });
    await this.audit.log({ actor: u, action: 'exam.create', entity: 'exam', entityId: e.id, meta: { code: e.code, institutions: d.institutionIds.length }, ip });
    return e;
  }

  async paper(u: AuthUser, examId: string, includeKey: boolean) {
    await this.access.assertExam(u, await this.load(u, examId));
    const qs = await this.prisma.examQuestion.findMany({ where: { examId }, orderBy: { position: 'asc' }, include: { question: { select: { id: true, stem: true, vignette: true, type: true, difficulty: true, status: true, options: { select: { label: true, text: true, isCorrect: true }, orderBy: { label: 'asc' } } } } } });
    return qs.map((x) => ({ id: x.id, position: x.position, marks: x.marks, questionId: x.questionId, frozen: !!x.snapshot, question: { ...x.question, options: x.question.options.map((o) => ({ label: o.label, text: o.text, ...(includeKey ? { isCorrect: o.isCorrect } : {}) })) } }));
  }

  /** Replace the paper's question list. Only APPROVED, in-scope questions of the exam's course may be used. */
  async setPaper(u: AuthUser, examId: string, items: { questionId: string; marks: number }[], ip?: string) {
    const exam = await this.load(u, examId);
    await this.access.assertExam(u, exam);
    if (!['DRAFT'].includes(exam.status) || !['DRAFT', 'REJECTED'].includes(exam.paperStatus)) throw conflict('BAD_STATE', 'The paper can only be edited while the exam is a draft');
    if (new Set(items.map((i) => i.questionId)).size !== items.length) throw badRequest('Duplicate questions on the paper');
    const qs = await this.prisma.question.findMany({ where: { id: { in: items.map((i) => i.questionId) }, courseId: exam.courseId, status: 'APPROVED', institutionId: scope.filter(u) }, select: { id: true } });
    if (qs.length !== items.length) throw badRequest('Every question must be approved, belong to the exam course and be within your access');
    const total = items.reduce((a, b) => a + b.marks, 0);
    await this.prisma.$transaction([
      this.prisma.examQuestion.deleteMany({ where: { examId } }),
      this.prisma.examQuestion.createMany({ data: items.map((i, idx) => ({ examId, questionId: i.questionId, position: idx + 1, marks: i.marks })) }),
      this.prisma.exam.update({ where: { id: examId }, data: { totalMarks: total, paperStatus: 'DRAFT' } }),
    ]);
    await this.audit.log({ actor: u, action: 'paper.set', entity: 'exam', entityId: examId, meta: { questions: items.length, totalMarks: total }, ip });
    return { questions: items.length, totalMarks: total };
  }

  async submitPaper(u: AuthUser, examId: string, ip?: string) {
    const exam = await this.load(u, examId);
    await this.access.assertExam(u, exam);
    if (exam.status !== 'DRAFT' || !['DRAFT', 'REJECTED'].includes(exam.paperStatus)) throw conflict('BAD_STATE', 'Paper is not in a submittable state');
    if (exam._count.questions < 1) throw badRequest('The paper has no questions');
    await this.prisma.exam.update({ where: { id: examId }, data: { paperStatus: 'SUBMITTED', status: 'PAPER_PENDING', paperSubmittedBy: u.id } });
    await this.audit.log({ actor: u, action: 'paper.submit', entity: 'exam', entityId: examId, ip });
    await this.notifications.notifyRole('CCE', 'Question paper awaiting approval', `${exam.code} — ${exam.title}`, LINKS.exam(examId));
    return { status: 'PAPER_PENDING' };
  }

  /** Approval freezes an immutable snapshot of each question and the answer key onto the paper. */
  async reviewPaper(u: AuthUser, examId: string, decision: 'APPROVE' | 'REJECT', note: string | undefined, ip?: string) {
    const exam = await this.load(u, examId);
    if (exam.status !== 'PAPER_PENDING') throw conflict('BAD_STATE', 'Exam is not awaiting paper approval');
    if (exam.paperSubmittedBy === u.id) throw forbidden('You cannot approve a paper you submitted (four-eyes principle)');
    if (decision === 'REJECT') {
      if (!note) throw badRequest('A reason is required when rejecting');
      await this.prisma.exam.update({ where: { id: examId }, data: { status: 'DRAFT', paperStatus: 'REJECTED', paperReviewNote: note } });
      await this.audit.log({ actor: u, action: 'paper.reject', entity: 'exam', entityId: examId, meta: { note }, ip });
      return { status: 'DRAFT' };
    }
    await this.prisma.$transaction(async (tx) => {
      const eqs = await tx.examQuestion.findMany({ where: { examId }, include: { question: { include: { options: { orderBy: { label: 'asc' } } } } } });
      for (const eq of eqs) {
        const q = eq.question;
        if (q.status !== 'APPROVED') throw conflict('QUESTION_NOT_APPROVED', `Question ${eq.position} is no longer approved`);
        const correct = q.options.find((o) => o.isCorrect)!;
        await tx.examQuestion.update({
          where: { id: eq.id },
          data: { correctLabel: correct.label, snapshot: { type: q.type, vignette: q.vignette, stem: q.stem, options: q.options.map((o) => ({ label: o.label, text: o.text })) } },
        });
        await tx.question.update({ where: { id: q.id }, data: { usedCount: { increment: 1 } } });
      }
      await tx.exam.update({ where: { id: examId }, data: { status: 'APPROVED', paperStatus: 'APPROVED', paperApprovedBy: u.id, paperApprovedAt: new Date(), paperReviewNote: note } });
    });
    await this.audit.log({ actor: u, action: 'paper.approve', entity: 'exam', entityId: examId, ip });
    return { status: 'APPROVED' };
  }

  /** Builds the candidate roster from eligible enrolments at participating institutions and opens the exam for sitting. */
  async schedule(u: AuthUser, examId: string, ip?: string) {
    const exam = await this.load(u, examId);
    if (!['APPROVED', 'SCHEDULED'].includes(exam.status)) throw conflict('BAD_STATE', 'The paper must be approved before scheduling');
    if (exam.closesAt <= new Date()) throw badRequest('The exam window has already closed');
    const r = await this.refreshRoster(examId, u.id);
    await this.prisma.exam.update({ where: { id: examId }, data: { status: 'SCHEDULED' } });
    await this.audit.log({ actor: u, action: 'exam.schedule', entity: 'exam', entityId: examId, meta: r, ip });
    const studentUsers = await this.prisma.examCandidate.findMany({ where: { examId, status: 'ADMITTED' }, select: { student: { select: { userId: true } } } });
    await this.notifications.notify(studentUsers.map((c) => c.student.userId), `Exam scheduled: ${exam.title}`, `Opens ${exam.opensAt.toISOString()}. Duration ${exam.durationMin} minutes.`, LINKS.schedule);
    return { status: 'SCHEDULED', ...r };
  }

  /**
   * Builds/refreshes the candidate roster from authoritative local enrolment data and records an immutable,
   * hash-stamped roster version approved by the acting scheduler (`actorId`).
   * Candidates are never deleted: those who lose eligibility before starting are REVOKED (history kept).
   * Manual overrides (`decisionSource = OVERRIDE`) and candidates who already started are never touched.
   */
  async refreshRoster(examId: string, actorId: string) {
    const exam = await this.prisma.exam.findUniqueOrThrow({ where: { id: examId }, include: { institutions: true } });
    const enr = await this.prisma.enrollment.findMany({
      where: { courseId: exam.courseId, term: exam.term, status: 'ENROLLED', student: { institutionId: { in: exam.institutions.map((i) => i.institutionId) }, status: 'ACTIVE', selfDeclared: false } },
      select: { eligibility: true, student: { select: { id: true, institutionId: true } } },
    });
    const eligible = new Map(enr.filter((e) => e.eligibility !== 'INELIGIBLE').map((e) => [e.student.id, e.student.institutionId]));
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM exams WHERE id = ${examId} FOR UPDATE`;   // serialises roster builds/overrides for this exam
      const current = await tx.examCandidate.findMany({ where: { examId } });
      const started = new Set((await tx.attempt.findMany({ where: { examId }, select: { studentId: true } })).map((a) => a.studentId));
      const version = ((await tx.examRosterVersion.aggregate({ where: { examId }, _max: { version: true } }))._max.version ?? 0) + 1;
      const byStudent = new Map(current.map((c) => [c.studentId, c]));
      const now = new Date();
      const toAdd: { examId: string; studentId: string; institutionId: string; rosterVersion: number }[] = [];
      const toReadmit: string[] = [];
      for (const [sid, inst] of eligible) {
        const c = byStudent.get(sid);
        if (!c) toAdd.push({ examId, studentId: sid, institutionId: inst, rosterVersion: version });
        else if (c.status === 'REVOKED' && c.decisionSource === 'ENROLMENT' && !started.has(sid)) toReadmit.push(sid);
      }
      const toRevoke = current.filter((c) => !eligible.has(c.studentId) && c.status === 'ADMITTED' && c.decisionSource === 'ENROLMENT' && !started.has(c.studentId)).map((c) => c.studentId);
      if (toAdd.length) await tx.examCandidate.createMany({ data: toAdd, skipDuplicates: true });
      if (toReadmit.length) await tx.examCandidate.updateMany({ where: { examId, studentId: { in: toReadmit } }, data: { status: 'ADMITTED', statusReason: null, statusChangedAt: now, rosterVersion: version } });
      if (toRevoke.length) await tx.examCandidate.updateMany({ where: { examId, studentId: { in: toRevoke } }, data: { status: 'REVOKED', statusReason: 'Eligibility lost: no longer eligible per enrolment records', statusChangedAt: now, rosterVersion: version } });
      const finalRows = await tx.examCandidate.findMany({ where: { examId }, select: { studentId: true, status: true, decisionSource: true }, orderBy: { studentId: 'asc' } });
      const snapshot = finalRows.map((c) => [c.studentId, c.status, c.decisionSource]);
      const digest = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
      await tx.examRosterVersion.create({ data: { examId, version, createdById: actorId, approvedById: actorId, candidateCount: finalRows.filter((c) => c.status === 'ADMITTED').length, revokedCount: finalRows.filter((c) => c.status === 'REVOKED').length, digest, snapshot } });
      return { rosterVersion: version, rosterDigest: digest, candidatesAdded: toAdd.length, candidatesReadmitted: toReadmit.length, candidatesRevoked: toRevoke.length, ineligibleExcluded: enr.length - eligible.size };
    });
  }

  async rosterVersions(u: AuthUser, examId: string) {
    await this.load(u, examId);
    // Roster versions list student ids across campuses; campus-scoped users see counts and digests only.
    const rows = await this.prisma.examRosterVersion.findMany({ where: { examId }, orderBy: { version: 'desc' }, select: { version: true, createdById: true, approvedById: true, candidateCount: true, revokedCount: true, digest: true, createdAt: true } });
    return rows;
  }

  /**
   * Authorised manual eligibility decision. Records reason, approver, timestamp, old and new decision and the
   * affected attempt (append-only). An in-progress attempt is only touched when `forceSubmit` is explicit; the
   * attempt's frozen admission decision is never rewritten.
   */
  async overrideEligibility(u: AuthUser, examId: string, studentId: string, d: { decision: 'GRANT' | 'REVOKE'; reason: string; forceSubmit?: boolean }, ip?: string) {
    const exam = await this.load(u, examId);
    const student = await this.prisma.student.findUnique({ where: { id: studentId }, select: { institutionId: true } });
    if (!student || !scope.allows(u, student.institutionId)) throw notFound('Student');
    if (!exam.institutions.some((i) => i.institutionId === student.institutionId)) throw badRequest("The student's institution does not participate in this examination");
    if (!['SCHEDULED', 'ADMISSION_OPEN', 'LIVE', 'SUSPENDED'].includes(exam.status)) throw conflict('BAD_STATE', 'Eligibility can only be overridden for scheduled or live examinations');
    const reason = d.reason.trim();
    const newDecision = d.decision === 'GRANT' ? 'ADMITTED' : 'REVOKED';
    const out = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM exams WHERE id = ${examId} FOR UPDATE`;
      const cand = await tx.examCandidate.findUnique({ where: { examId_studentId: { examId, studentId } } });
      const attempt = await tx.attempt.findUnique({ where: { examId_studentId: { examId, studentId } }, select: { id: true, status: true } });
      const oldDecision = cand ? cand.status : 'NOT_ON_ROSTER';
      const retrySeal = d.decision === 'REVOKE' && attempt?.status === 'IN_PROGRESS' && d.forceSubmit === true;
      if (attempt) {
        if (d.decision === 'GRANT') throw conflict('ATTEMPT_EXISTS', 'An attempt already exists for this candidate; re-entry is not granted by roster override');
        if (attempt.status !== 'IN_PROGRESS') throw conflict('ATTEMPT_FINISHED', 'The attempt is already finished');
        if (!d.forceSubmit) throw conflict('ATTEMPT_IN_PROGRESS', 'The candidate has an attempt in progress; revoking requires forceSubmit=true, which seals the attempt');
      }
      const changed = oldDecision !== newDecision;
      if (!changed && !retrySeal) throw conflict('NO_CHANGE', `The candidate is already ${newDecision}`);
      let overrideId: string | null = null;
      if (changed) {
        const now = new Date();
        if (cand) await tx.examCandidate.update({ where: { id: cand.id }, data: { status: newDecision, decisionSource: 'OVERRIDE', statusReason: reason, statusChangedAt: now } });
        else await tx.examCandidate.create({ data: { examId, studentId, institutionId: student.institutionId, status: newDecision, decisionSource: 'OVERRIDE', statusReason: reason, statusChangedAt: now } });
        const o = await tx.eligibilityOverride.create({ data: { examId, studentId, attemptId: attempt?.id ?? null, oldDecision, newDecision, reason, approvedById: u.id } });
        overrideId = o.id;
      }
      return { overrideId, attemptId: attempt?.id ?? null, oldDecision, newDecision };
    });
    if (out.attemptId && d.forceSubmit) await this.delivery.finalize(out.attemptId, { mode: 'FORCED', actor: u, reason: `Eligibility revoked: ${reason}`, ip });
    await this.audit.log({ actor: u, action: 'eligibility.override', entity: 'exam', entityId: examId, institutionId: student.institutionId, meta: { studentId, ...out, reason }, ip });
    return out;
  }

  async overrides(u: AuthUser, examId: string) {
    await this.load(u, examId);
    const rows = await this.prisma.eligibilityOverride.findMany({ where: { examId, student: { institutionId: scope.filter(u) } }, orderBy: { createdAt: 'desc' }, include: { student: { select: { regNo: true } } } });
    return rows.map((r) => ({ id: r.id, regNo: r.student.regNo, studentId: r.studentId, attemptId: r.attemptId, oldDecision: r.oldDecision, newDecision: r.newDecision, reason: r.reason, approvedById: r.approvedById, createdAt: r.createdAt }));
  }

  async roster(u: AuthUser, examId: string) {
    await this.load(u, examId);
    const rows = await this.prisma.examCandidate.findMany({
      where: { examId, institutionId: scope.filter(u) },
      include: { student: { select: { regNo: true, user: { select: { fullName: true } } } }, institution: { select: { code: true } } },
      orderBy: { student: { regNo: 'asc' } },
    });
    const attempts = await this.prisma.attempt.findMany({ where: { examId, studentId: { in: rows.map((r) => r.studentId) } }, select: { studentId: true, status: true } });
    const m = new Map(attempts.map((a) => [a.studentId, a.status]));
    return rows.map((r) => ({ studentId: r.studentId, regNo: r.student.regNo, fullName: r.student.user.fullName, institution: r.institution.code, extraTimeMin: r.extraTimeMin, accommodation: r.accommodation, admission: r.status, decisionSource: r.decisionSource, statusReason: r.statusReason, attempt: m.get(r.studentId) ?? null }));
  }

  async setAccommodation(u: AuthUser, examId: string, studentId: string, d: { extraTimeMin: number; accommodation?: string }, ip?: string) {
    const c = await this.prisma.examCandidate.findUnique({ where: { examId_studentId: { examId, studentId } } });
    if (!c || !scope.allows(u, c.institutionId)) throw notFound('Candidate');
    if (await this.prisma.attempt.count({ where: { examId, studentId } })) throw conflict('ALREADY_STARTED', 'Candidate has already started; use invigilator time extension');
    await this.prisma.examCandidate.update({ where: { id: c.id }, data: d });
    await this.audit.log({ actor: u, action: 'candidate.accommodation', entity: 'exam', entityId: examId, institutionId: c.institutionId, meta: { studentId, ...d }, ip });
    return { ok: true };
  }

  async assignInvigilator(u: AuthUser, examId: string, d: { userId: string; institutionId: string }, ip?: string) {
    const exam = await this.load(u, examId);
    scope.assert(u, d.institutionId);
    if (!exam.institutions.some((i) => i.institutionId === d.institutionId)) throw badRequest('Institution does not participate in this exam');
    const inv = await this.prisma.user.findFirst({ where: { id: d.userId, role: 'INVIGILATOR', active: true, institutions: { some: { institutionId: d.institutionId } } } });
    if (!inv) throw badRequest('User is not an active invigilator of that institution');
    await this.prisma.examInvigilator.upsert({ where: { examId_userId_institutionId: { examId, userId: d.userId, institutionId: d.institutionId } }, create: { examId, userId: d.userId, institutionId: d.institutionId }, update: {} });
    await this.audit.log({ actor: u, action: 'invigilator.assign', entity: 'exam', entityId: examId, institutionId: d.institutionId, meta: { userId: d.userId }, ip });
    await this.notifications.notify([d.userId], 'Invigilation duty assigned', `${exam.code} — ${exam.title}`, LINKS.monitor);
    return { ok: true };
  }

  async cancel(u: AuthUser, examId: string, reason: string, ip?: string) {
    const exam = await this.load(u, examId);
    if (['ADMISSION_OPEN', 'LIVE', 'SUSPENDED', 'CLOSING', 'CLOSED', 'SCORING', 'RESULT_PENDING', 'PUBLISHED', 'CANCELLED'].includes(exam.status)) throw conflict('BAD_STATE', 'This exam can no longer be cancelled');
    await this.prisma.exam.update({ where: { id: examId }, data: { status: 'CANCELLED' } });
    await this.audit.log({ actor: u, action: 'exam.cancel', entity: 'exam', entityId: examId, meta: { reason }, ip });
    return { status: 'CANCELLED' };
  }
}
