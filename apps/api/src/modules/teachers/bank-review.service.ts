import { Injectable } from '@nestjs/common';
import { LINKS } from '@oes/shared';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infra/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { scope, type AuthUser } from '../../common/auth';
import { AppError, badRequest, forbidden, notFound } from '../../common/errors';
import { paginate } from '../../common/validate';
import { refreshBankStatus } from './bank-status';

export type BankDecision = 'APPROVE' | 'REJECT';
export interface BankReview { decision?: BankDecision; note?: string; items?: { questionId: string; decision: BankDecision; note?: string }[] }

/**
 * Examiner / administrator side of teacher question banks (permission question.approve). A reviewer sees a bank only once the teacher has
 * submitted it, inspects every question with its answer key, and decides the whole bank or each submitted question. A rejection always carries a
 * comment the teacher can read. Drafts stay private to their author. The four-eyes rule applies (nobody reviews their own bank).
 */
@Injectable()
export class BankReviewService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly notifications: NotificationsService) {}

  private where(u: AuthUser, extra: Prisma.QuestionPoolWhereInput = {}): Prisma.QuestionPoolWhereInput {
    return { archivedAt: null, institutionId: scope.filter(u), status: { in: ['SUBMITTED', 'APPROVED', 'REJECTED'] }, ...extra };
  }

  async list(u: AuthUser, f: { status?: 'SUBMITTED' | 'APPROVED' | 'REJECTED'; search?: string; page: number; pageSize: number }) {
    const status = f.status ?? 'SUBMITTED';
    const byOwner = f.search ? (await this.prisma.user.findMany({ where: { role: 'TEACHER', fullName: { contains: f.search } }, select: { id: true }, take: 200 })).map((x) => x.id) : [];
    const where = this.where(u, { status, ...(f.search ? { OR: [{ name: { contains: f.search } }, { ownerId: { in: byOwner } }] } : {}) });
    const [rows, total, waiting] = await Promise.all([
      this.prisma.questionPool.findMany({ where, orderBy: status === 'SUBMITTED' ? { submittedAt: 'asc' } : { reviewedAt: 'desc' }, ...paginate(f), include: { questions: { where: { status: { not: 'RETIRED' } }, select: { status: true } } } }),
      this.prisma.questionPool.count({ where }),
      this.prisma.questionPool.count({ where: this.where(u, { status: 'SUBMITTED' }) }),
    ]);
    const owners = await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.ownerId))] } }, select: { id: true, fullName: true, teacherProfile: { select: { employeeId: true, department: true } } } });
    const courses = await this.prisma.course.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.courseId))] } }, select: { id: true, code: true, title: true } });
    const insts = await this.prisma.institution.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.institutionId))] } }, select: { id: true, code: true, name: true } });
    return {
      total, waiting,
      items: rows.map((r) => {
        const o = owners.find((x) => x.id === r.ownerId);
        const n = (s: string) => r.questions.filter((q) => q.status === s).length;
        return { id: r.id, name: r.name, status: r.status, term: r.term, submittedAt: r.submittedAt, reviewedAt: r.reviewedAt, reviewNote: r.reviewNote,
          owner: { id: r.ownerId, fullName: o?.fullName ?? '—', employeeId: o?.teacherProfile?.employeeId ?? null, department: o?.teacherProfile?.department ?? null },
          course: courses.find((c) => c.id === r.courseId) ?? null, institution: insts.find((i) => i.id === r.institutionId) ?? null,
          counts: { total: r.questions.length, submitted: n('SUBMITTED'), approved: n('APPROVED'), rejected: n('REJECTED'), draft: n('DRAFT') } };
      }),
    };
  }

  private async load(u: AuthUser, id: string) {
    const p = await this.prisma.questionPool.findFirst({ where: this.where(u, { id }) });
    if (!p) throw notFound('Question bank');                                   // drafts, other campuses and unknown ids look the same
    return p;
  }

  /** The bank with its reviewable questions (answer keys included — this is the reviewer's view) and its recent history. */
  async detail(u: AuthUser, id: string) {
    const p = await this.load(u, id);
    const [owner, course, institution, questions] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: p.ownerId }, select: { id: true, fullName: true, teacherProfile: { select: { employeeId: true, department: true, designation: true } } } }),
      this.prisma.course.findUnique({ where: { id: p.courseId }, select: { code: true, title: true } }),
      this.prisma.institution.findUnique({ where: { id: p.institutionId }, select: { code: true, name: true } }),
      this.prisma.question.findMany({ where: { poolId: id, status: { in: ['SUBMITTED', 'APPROVED', 'REJECTED'] } }, include: { options: true }, orderBy: { createdAt: 'asc' } }),
    ]);
    const ids = [id, ...questions.map((q) => q.id)];
    const log = await this.prisma.auditLog.findMany({ where: { entityId: { in: ids } }, orderBy: { seq: 'desc' }, take: 60, select: { seq: true, at: true, action: true, actorId: true, actorRole: true, entity: true, entityId: true, meta: true } });
    const actors = await this.prisma.user.findMany({ where: { id: { in: [...new Set(log.map((l) => l.actorId).filter(Boolean) as string[])] } }, select: { id: true, fullName: true } });
    return {
      id: p.id, name: p.name, description: p.description, status: p.status, term: p.term, submittedAt: p.submittedAt, reviewedAt: p.reviewedAt, reviewNote: p.reviewNote,
      owner: { id: owner?.id, fullName: owner?.fullName ?? '—', employeeId: owner?.teacherProfile?.employeeId ?? null, department: owner?.teacherProfile?.department ?? null, designation: owner?.teacherProfile?.designation ?? null },
      course, institution,
      questions: questions.map((q) => ({ id: q.id, stem: q.stem, vignette: q.vignette, explanation: q.explanation, difficulty: q.difficulty, topic: q.topic, subtopic: q.subtopic, bloom: q.bloom, imageId: q.imageId, marks: q.defaultMarks, status: q.status, version: q.version, reviewNote: q.reviewNote, reviewedAt: q.reviewedAt,
        options: [...q.options].sort((a, b) => a.label.localeCompare(b.label)).map((o) => ({ label: o.label, text: o.text, isCorrect: o.isCorrect })) })),
      activity: log.map((l) => ({ at: l.at, action: l.action, entity: l.entity, actor: actors.find((a) => a.id === l.actorId)?.fullName ?? 'System', actorRole: l.actorRole, note: (l.meta as { note?: string } | null)?.note ?? null })),
    };
  }

  /** The reviewer's view of one image attached to a question in a bank they can see. */
  async image(u: AuthUser, bankId: string, imageId: string) {
    await this.load(u, bankId);
    const attached = await this.prisma.question.count({ where: { poolId: bankId, imageId, status: { in: ['SUBMITTED', 'APPROVED', 'REJECTED'] } } });
    const img = attached ? await this.prisma.questionImage.findUnique({ where: { id: imageId } }) : null;
    if (!img) throw notFound('Image');
    return { id: img.id, mime: img.mime, data: `data:${img.mime};base64,${Buffer.from(img.data).toString('base64')}` };
  }

  async review(u: AuthUser, id: string, d: BankReview, ip?: string) {
    const p = await this.load(u, id);
    if (p.ownerId === u.id) throw forbidden('You cannot review your own question bank (four-eyes principle)');
    if (p.status !== 'SUBMITTED') throw new AppError(409, 'BAD_STATE', `Only a submitted question bank can be reviewed (this one is ${p.status.toLowerCase()})`);
    const waiting = await this.prisma.question.findMany({ where: { poolId: id, status: 'SUBMITTED' }, select: { id: true, authorId: true } });
    if (!waiting.length) throw new AppError(409, 'BAD_STATE', 'There are no submitted questions in this bank');
    const bankNote = (d.note ?? '').trim();
    // one decision (with its comment) per submitted question
    const plan = new Map<string, { decision: BankDecision; note: string }>();
    if (d.items?.length) {
      const wanted = new Set(waiting.map((q) => q.id));
      for (const it of d.items) {
        if (!wanted.has(it.questionId)) throw badRequest('One of the questions is not waiting for review in this bank');
        if (plan.has(it.questionId)) throw badRequest('A question was decided twice');
        const note = (it.note ?? '').trim() || bankNote;
        if (it.decision === 'REJECT' && !note) throw badRequest('Every rejected question needs a comment (or add one comment for the whole bank)');
        plan.set(it.questionId, { decision: it.decision, note });
      }
      if (plan.size !== wanted.size) throw badRequest('Decide every question that is waiting for review (or approve or reject the whole bank)');
    } else {
      if (!d.decision) throw badRequest('Choose approve or reject');
      if (d.decision === 'REJECT' && !bankNote) throw badRequest('A comment is required when rejecting a question bank');
      for (const q of waiting) plan.set(q.id, { decision: d.decision, note: bankNote });
    }
    const now = new Date();
    const status = await this.prisma.$transaction(async (tx) => {
      for (const [qid, x] of plan) {
        const st = x.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
        const r = await tx.question.updateMany({ where: { id: qid, status: 'SUBMITTED' }, data: { status: st, reviewNote: x.note || null, reviewedBy: u.id, reviewedAt: now } });
        if (r.count !== 1) throw new AppError(409, 'BAD_STATE', 'A question was decided by someone else a moment ago');
        await this.audit.append(tx, { actor: u, action: `question.${x.decision.toLowerCase()}`, entity: 'question', entityId: qid, institutionId: p.institutionId, meta: { note: x.note || null, bank: id }, ip });
      }
      const s = await refreshBankStatus(tx, id, { by: u.id, note: bankNote || null });
      await this.audit.append(tx, { actor: u, action: 'question_pool.review', entity: 'question_pool', entityId: id, institutionId: p.institutionId, meta: { approved: [...plan.values()].filter((x) => x.decision === 'APPROVE').length, rejected: [...plan.values()].filter((x) => x.decision === 'REJECT').length, note: bankNote || null }, ip });
      return s;
    }, { timeout: 30_000 });
    const approved = [...plan.values()].filter((x) => x.decision === 'APPROVE').length; const rejected = plan.size - approved;
    await this.notifications.notify([p.ownerId], status === 'APPROVED' ? 'Question bank approved' : 'Question bank returned for changes',
      status === 'APPROVED' ? `${p.name}: ${approved} question${approved === 1 ? '' : 's'} approved.` : `${p.name}: ${rejected} question${rejected === 1 ? '' : 's'} returned for changes${bankNote ? ` — ${bankNote}` : ''}.`, LINKS.pools).catch(() => undefined);
    return { status, approved, rejected };
  }
}
