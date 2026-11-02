import { LINKS } from '@oes/shared';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma.service';
import { AuditService } from '../audit/audit.service';
import { scope, type AuthUser } from '../../common/auth';
import { badRequest, conflict, forbidden, notFound } from '../../common/errors';
import type { Prisma } from '../../generated/prisma/client';
import { CourseAccessService } from '../org/course-access.service';
import { NotificationsService } from '../notifications/notifications.service';

export interface QuestionInput {
  courseId: string;
  institutionId?: string;
  type: 'MCQ' | 'CLINICAL_MCQ';
  vignette?: string;
  stem: string;
  explanation?: string;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  tags?: string[];
  poolId?: string;
  topic?: string;
  defaultMarks?: number;
  options: { label: string; text: string; isCorrect: boolean }[];
}

/** Roles that may only touch questions they wrote themselves. */
export const authorOnly = (u: AuthUser) => u.role === 'LECTURER' || u.role === 'TEACHER';

export function validateQuestion(q: QuestionInput) {
  const labels = q.options.map((o) => o.label);
  const expected = ['A', 'B', 'C', 'D', 'E'].slice(0, q.options.length);
  if (q.options.length < 4 || q.options.length > 5) throw badRequest('A question needs four or five options');
  if (labels.join('') !== expected.join('')) throw badRequest('Option labels must be consecutive from A');
  if (q.options.filter((o) => o.isCorrect).length !== 1) throw badRequest('Exactly one option must be marked correct (single best answer)');
  if (new Set(q.options.map((o) => o.text.trim().toLowerCase())).size !== q.options.length) throw badRequest('Options must be distinct');
  if (q.type === 'CLINICAL_MCQ' && (q.vignette ?? '').trim().length < 40) throw badRequest('A clinical MCQ requires a clinical vignette of at least 40 characters');
}

@Injectable()
export class QuestionsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly notifications: NotificationsService, private readonly access: CourseAccessService) {}

  private async load(u: AuthUser, id: string) {
    const q = await this.prisma.question.findUnique({ where: { id }, include: { options: { orderBy: { label: 'asc' } }, course: { select: { code: true, title: true } } } });
    if (!q || !scope.allows(u, q.institutionId) || !(await this.access.allows(u, q.courseId, q.institutionId))) throw notFound('Question'); // unassigned lecturer ⇒ indistinguishable from absent
    return q;
  }

  async list(u: AuthUser, f: { courseId?: string; status?: string; difficulty?: string; type?: string; search?: string; institutionId?: string; page: number; pageSize: number }) {
    if (f.institutionId) scope.assert(u, f.institutionId);
    const where: Prisma.QuestionWhereInput = {
      AND: [await this.access.questionWhere(u)],
      institutionId: f.institutionId ?? scope.filter(u),
      courseId: f.courseId, status: f.status as never, difficulty: f.difficulty as never, type: f.type as never,
      ...(f.search ? { OR: [{ stem: { contains: f.search, mode: 'insensitive' } }, { vignette: { contains: f.search, mode: 'insensitive' } }] } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.question.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (f.page - 1) * f.pageSize, take: f.pageSize, include: { course: { select: { code: true, title: true } }, options: { select: { label: true, isCorrect: true }, orderBy: { label: 'asc' } } } }),
      this.prisma.question.count({ where }),
    ]);
    return { total, items: items.map((q) => ({ ...q, correct: q.options.find((o) => o.isCorrect)?.label ?? null, options: undefined })) };
  }

  get(u: AuthUser, id: string) { return this.load(u, id); }

  async create(u: AuthUser, d: QuestionInput, ip?: string) {
    validateQuestion(d);
    const institutionId = d.institutionId ?? u.institutionIds?.[0];
    if (!institutionId) throw badRequest('institutionId is required');
    scope.assert(u, institutionId);
    if (!(await this.prisma.course.findUnique({ where: { id: d.courseId }, select: { id: true } }))) throw badRequest('Unknown course');
    await this.access.assert(u, d.courseId, institutionId);
    const q = await this.prisma.question.create({
      data: { courseId: d.courseId, institutionId, authorId: u.id, type: d.type, vignette: d.vignette, stem: d.stem, explanation: d.explanation, difficulty: d.difficulty, tags: d.tags ?? [], poolId: d.poolId, topic: d.topic, defaultMarks: d.defaultMarks ?? 1, options: { create: d.options } },
    });
    await this.audit.log({ actor: u, action: 'question.create', entity: 'question', entityId: q.id, institutionId, ip });
    return this.load(u, q.id);
  }

  async update(u: AuthUser, id: string, d: QuestionInput, ip?: string) {
    const q = await this.load(u, id);
    if (authorOnly(u) && q.authorId !== u.id) throw forbidden('Only the author may edit this question');
    if (['SUBMITTED'].includes(q.status)) throw conflict('LOCKED', 'A question under review cannot be edited; ask the reviewer to reject it first');
    validateQuestion(d);
    await this.prisma.$transaction([
      this.prisma.questionOption.deleteMany({ where: { questionId: id } }),
      this.prisma.question.update({
        where: { id },
        data: { type: d.type, vignette: d.vignette ?? null, stem: d.stem, explanation: d.explanation ?? null, difficulty: d.difficulty, tags: d.tags ?? [], topic: d.topic ?? null, defaultMarks: d.defaultMarks ?? q.defaultMarks, // editing approved content returns it to draft; approved papers keep their frozen snapshot
          status: 'DRAFT', version: { increment: 1 }, options: { create: d.options } },
      }),
    ]);
    await this.audit.log({ actor: u, action: 'question.update', entity: 'question', entityId: id, institutionId: q.institutionId, meta: { fromStatus: q.status }, ip });
    return this.load(u, id);
  }

  async submit(u: AuthUser, id: string, ip?: string) {
    const q = await this.load(u, id);
    if (authorOnly(u) && q.authorId !== u.id) throw forbidden('Only the author may submit this question');
    if (!['DRAFT', 'REJECTED'].includes(q.status)) throw conflict('BAD_STATE', `Cannot submit a ${q.status} question`);
    await this.prisma.question.update({ where: { id }, data: { status: 'SUBMITTED', reviewNote: null } });
    await this.audit.log({ actor: u, action: 'question.submit', entity: 'question', entityId: id, institutionId: q.institutionId, ip });
    await this.notifications.notifyRole('EXAMINER', 'Question awaiting review', `${q.course.code}: a new question was submitted for approval.`, LINKS.questions);
    return { status: 'SUBMITTED' };
  }

  async review(u: AuthUser, id: string, decision: 'APPROVE' | 'REJECT', note: string | undefined, ip?: string) {
    const q = await this.load(u, id);
    if (q.status !== 'SUBMITTED') throw conflict('BAD_STATE', 'Only submitted questions can be reviewed');
    if (q.authorId === u.id) throw forbidden('You cannot review your own question (four-eyes principle)');
    if (decision === 'REJECT' && !note) throw badRequest('A reason is required when rejecting');
    const status = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    await this.prisma.question.update({ where: { id }, data: { status, reviewNote: note, reviewedBy: u.id, reviewedAt: new Date() } });
    await this.audit.log({ actor: u, action: `question.${decision.toLowerCase()}`, entity: 'question', entityId: id, institutionId: q.institutionId, meta: { note }, ip });
    await this.notifications.notify([q.authorId], `Question ${status.toLowerCase()}`, note ?? `Your ${q.course.code} question was ${status.toLowerCase()}.`, LINKS.questions);
    return { status };
  }

  async retire(u: AuthUser, id: string, ip?: string) {
    const q = await this.load(u, id);
    if (authorOnly(u) && q.authorId !== u.id) throw forbidden();
    await this.prisma.question.update({ where: { id }, data: { status: 'RETIRED' } });
    await this.audit.log({ actor: u, action: 'question.retire', entity: 'question', entityId: id, institutionId: q.institutionId, ip });
    return { status: 'RETIRED' };
  }
}
