import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma.service';
import { AuditService } from '../audit/audit.service';
import { scope, type AuthUser } from '../../common/auth';
import { badRequest, conflict, forbidden, notFound } from '../../common/errors';
import type { Prisma } from '../../generated/prisma/client';
import { NotificationsService } from '../notifications/notifications.service';

export interface ExamInput {
  code: string; title: string; courseId: string; term: string;
  opensAt: Date; closesAt: Date; durationMin: number; passPercent: number; negativeMarking: number;
  shuffleQuestions: boolean; instructions?: string; institutionIds: string[];
}

@Injectable()
export class ExamsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly notifications: NotificationsService) {}

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

  async list(u: AuthUser, q: { status?: string; courseId?: string; page: number; pageSize: number }) {
    const where: Prisma.ExamWhereInput = { ...this.examScope(u), status: q.status as never, courseId: q.courseId };
    const [items, total] = await Promise.all([
      this.prisma.exam.findMany({ where, orderBy: { opensAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { course: { select: { code: true, title: true } }, institutions: { select: { institutionId: true } }, _count: { select: { questions: true, candidates: true, attempts: true } } } }),
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
      data: { code: d.code, title: d.title, courseId: d.courseId, term: d.term, createdBy: u.id, opensAt: d.opensAt, closesAt: d.closesAt, durationMin: d.durationMin, passPercent: d.passPercent, negativeMarking: d.negativeMarking, shuffleQuestions: d.shuffleQuestions, instructions: d.instructions, institutions: { create: d.institutionIds.map((institutionId) => ({ institutionId })) } },
    });
    await this.audit.log({ actor: u, action: 'exam.create', entity: 'exam', entityId: e.id, meta: { code: e.code, institutions: d.institutionIds.length }, ip });
    return e;
  }

  async paper(u: AuthUser, examId: string, includeKey: boolean) {
    await this.load(u, examId);
    const qs = await this.prisma.examQuestion.findMany({ where: { examId }, orderBy: { position: 'asc' }, include: { question: { select: { id: true, stem: true, vignette: true, type: true, difficulty: true, status: true, options: { select: { label: true, text: true, isCorrect: true }, orderBy: { label: 'asc' } } } } } });
    return qs.map((x) => ({ id: x.id, position: x.position, marks: x.marks, questionId: x.questionId, frozen: !!x.snapshot, question: { ...x.question, options: x.question.options.map((o) => ({ label: o.label, text: o.text, ...(includeKey ? { isCorrect: o.isCorrect } : {}) })) } }));
  }

  /** Replace the paper's question list. Only APPROVED, in-scope questions of the exam's course may be used. */
  async setPaper(u: AuthUser, examId: string, items: { questionId: string; marks: number }[], ip?: string) {
    const exam = await this.load(u, examId);
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
    if (exam.status !== 'DRAFT' || !['DRAFT', 'REJECTED'].includes(exam.paperStatus)) throw conflict('BAD_STATE', 'Paper is not in a submittable state');
    if (exam._count.questions < 1) throw badRequest('The paper has no questions');
    await this.prisma.exam.update({ where: { id: examId }, data: { paperStatus: 'SUBMITTED', status: 'PAPER_PENDING', paperSubmittedBy: u.id } });
    await this.audit.log({ actor: u, action: 'paper.submit', entity: 'exam', entityId: examId, ip });
    await this.notifications.notifyRole('CCE', 'Question paper awaiting approval', `${exam.code} — ${exam.title}`, `/cce/exams/${examId}`);
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
    const r = await this.refreshRoster(examId);
    await this.prisma.exam.update({ where: { id: examId }, data: { status: 'SCHEDULED' } });
    await this.audit.log({ actor: u, action: 'exam.schedule', entity: 'exam', entityId: examId, meta: r, ip });
    const studentUsers = await this.prisma.examCandidate.findMany({ where: { examId }, select: { student: { select: { userId: true } } } });
    await this.notifications.notify(studentUsers.map((c) => c.student.userId), `Exam scheduled: ${exam.title}`, `Opens ${exam.opensAt.toISOString()}. Duration ${exam.durationMin} minutes.`, '/student/schedule');
    return { status: 'SCHEDULED', ...r };
  }

  async refreshRoster(examId: string) {
    const exam = await this.prisma.exam.findUniqueOrThrow({ where: { id: examId }, include: { institutions: true } });
    const enr = await this.prisma.enrollment.findMany({
      where: { courseId: exam.courseId, term: exam.term, status: 'ENROLLED', student: { institutionId: { in: exam.institutions.map((i) => i.institutionId) }, status: 'ACTIVE' } },
      select: { eligibility: true, student: { select: { id: true, institutionId: true } } },
    });
    const eligible = enr.filter((e) => e.eligibility !== 'INELIGIBLE');
    const created = await this.prisma.examCandidate.createMany({ data: eligible.map((e) => ({ examId, studentId: e.student.id, institutionId: e.student.institutionId })), skipDuplicates: true });
    // withdraw candidates who lost eligibility, provided they have not started
    const keep = new Set(eligible.map((e) => e.student.id));
    const current = await this.prisma.examCandidate.findMany({ where: { examId }, select: { studentId: true } });
    const started = new Set((await this.prisma.attempt.findMany({ where: { examId }, select: { studentId: true } })).map((a) => a.studentId));
    const drop = current.filter((c) => !keep.has(c.studentId) && !started.has(c.studentId)).map((c) => c.studentId);
    if (drop.length) await this.prisma.examCandidate.deleteMany({ where: { examId, studentId: { in: drop } } });
    return { candidatesAdded: created.count, candidatesRemoved: drop.length, ineligibleExcluded: enr.length - eligible.length };
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
    return rows.map((r) => ({ studentId: r.studentId, regNo: r.student.regNo, fullName: r.student.user.fullName, institution: r.institution.code, extraTimeMin: r.extraTimeMin, accommodation: r.accommodation, attempt: m.get(r.studentId) ?? null }));
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
    await this.notifications.notify([d.userId], 'Invigilation duty assigned', `${exam.code} — ${exam.title}`, '/invigilator');
    return { ok: true };
  }

  async cancel(u: AuthUser, examId: string, reason: string, ip?: string) {
    const exam = await this.load(u, examId);
    if (['LIVE', 'CLOSED', 'RESULT_PENDING', 'PUBLISHED', 'CANCELLED'].includes(exam.status)) throw conflict('BAD_STATE', 'This exam can no longer be cancelled');
    await this.prisma.exam.update({ where: { id: examId }, data: { status: 'CANCELLED' } });
    await this.audit.log({ actor: u, action: 'exam.cancel', entity: 'exam', entityId: examId, meta: { reason }, ip });
    return { status: 'CANCELLED' };
  }
}
