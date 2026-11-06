import { Injectable } from '@nestjs/common';
import { isValidPhone, PHONE_HINT, LINKS } from '@oes/shared';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infra/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CourseAccessService, type CoursePair } from '../org/course-access.service';
import { QuestionsService, validateQuestion, type QuestionInput } from '../exams/questions.service';
import type { AuthUser } from '../../common/auth';
import { AppError, badRequest, forbidden, notFound } from '../../common/errors';
import { paginate } from '../../common/validate';
import { decodePhoto } from './teacher-registration.service';
import { createHash } from 'node:crypto';
import { versionSnapshot } from '../exams/questions.service';

export const BLOOM = ['REMEMBER', 'UNDERSTAND', 'APPLY', 'ANALYZE', 'EVALUATE', 'CREATE'] as const;
export type Bloom = (typeof BLOOM)[number];
export const MAX_IMAGE_BYTES = 1_000_000;
export interface McqInput { stem: string; options: string[]; correctIndex: number; explanation?: string; difficulty: 'EASY' | 'MEDIUM' | 'HARD'; topic?: string; subtopic?: string | null; bloom?: Bloom | null; imageId?: string | null; marks: number }

/** Decodes a `data:image/…;base64,…` URL for a question image: PNG, JPEG or WebP only (never SVG), size-capped, and the real bytes must match the declared type. */
export function decodeQuestionImage(dataUrl: string): { mime: string; bytes: Buffer } {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw badRequest('The image must be a PNG, JPEG or WebP file.');
  const buf = Buffer.from(m[2]!, 'base64');
  if (!buf.length) throw badRequest('The image file is empty.');
  if (buf.length > MAX_IMAGE_BYTES) throw badRequest('The image is too large. Choose one under 1 MB.');
  const ok = (m[1] === 'image/jpeg' && buf[0] === 0xff && buf[1] === 0xd8) || (m[1] === 'image/png' && buf.subarray(1, 4).toString() === 'PNG') || (m[1] === 'image/webp' && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP');
  if (!ok) throw badRequest('The image file is not a valid image of the declared type.');
  return { mime: m[1]!, bytes: buf };
}
export type AssignmentEffect = 'ACTIVE' | 'WAITS_FOR_ACCOUNT' | 'ACCOUNT_NOT_APPROVED' | 'PENDING_REVIEW' | 'REJECTED' | 'REVOKED';
export type BankState = 'EMPTY' | 'DRAFT' | 'SUBMITTED' | 'REJECTED' | 'APPROVED';
/** A bank has no status of its own yet; its state is derived from its questions: anything under review → SUBMITTED, else anything returned → REJECTED, else any draft → DRAFT, else all APPROVED. */
export function bankState(statuses: string[]): BankState {
  if (!statuses.length) return 'EMPTY'; if (statuses.includes('SUBMITTED')) return 'SUBMITTED'; if (statuses.includes('REJECTED')) return 'REJECTED'; if (statuses.includes('DRAFT')) return 'DRAFT'; return 'APPROVED';
}
const LABELS = ['A', 'B', 'C', 'D', 'E'];
/** Spreadsheet formula injection: a cell that starts with one of these is read as a formula by Excel/Sheets, so it is prefixed with an apostrophe. */
const safeCell = (v: unknown) => { const s = String(v ?? ''); const t = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };

/**
 * Teacher workspace. Deny by default: every method except status/profile first requires an APPROVED teacher (checked against the database on
 * every call), and every record is reached only through an APPROVED, non-revoked assignment owned by the caller. Not found, never "forbidden",
 * when the record exists but is somebody else's, so ids cannot be probed.
 */
@Injectable()
export class TeacherService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly notifications: NotificationsService,
    private readonly access: CourseAccessService, private readonly questions: QuestionsService) {}

  // ── identity & approval status (allowed while pending) ──
  async status(u: AuthUser) {
    const p = await this.prisma.teacherProfile.findUnique({ where: { userId: u.id }, include: { user: { select: { active: true } } } });
    if (!p) throw forbidden('This account has no teacher registration');
    const rows = await this.prisma.courseAssignment.findMany({ where: { userId: u.id }, orderBy: { requestedAt: 'asc' }, include: this.aInclude });
    const counts: Record<string, number> = {}; for (const r of rows) counts[r.status.toLowerCase()] = (counts[r.status.toLowerCase()] ?? 0) + 1;
    // Two separate decisions: the ACCOUNT (identity) and each class-subject. Access needs both, so an approved subject on a not-yet-approved account is
    // reported as waiting for the account, never as usable. The same rule is enforced on every working route (CourseAccessService.pairs).
    const accountOk = p.status === 'APPROVED' && p.user.active;
    const effective = (a: (typeof rows)[number]): AssignmentEffect => a.status === 'APPROVED' && !a.revokedAt ? (accountOk ? 'ACTIVE' : p.status === 'PENDING' ? 'WAITS_FOR_ACCOUNT' : 'ACCOUNT_NOT_APPROVED')
      : a.status === 'PENDING' ? 'PENDING_REVIEW' : a.status === 'REJECTED' ? 'REJECTED' : 'REVOKED';
    const requested = rows.map((a) => ({ id: a.id, status: a.status, effective: effective(a), term: a.term, semester: a.course.semester, decisionNote: a.status === 'REJECTED' || a.status === 'REVOKED' ? a.decisionNote : null, course: { code: a.course.code, title: a.course.title }, program: a.course.program.code, institution: a.institution.code }));
    // The teacher's own requests, so a pending teacher can see exactly what was submitted. Nothing here grants access.
    return { status: p.status, accountStatus: p.status, access: { accountApproved: accountOk, activeAssignments: requested.filter((r) => r.effective === 'ACTIVE').length },
      reviewNote: p.reviewNote, submittedAt: p.submittedAt, reviewedAt: p.reviewedAt, requests: counts, requested };
  }

  async profile(u: AuthUser) {
    const p = await this.prisma.teacherProfile.findUnique({ where: { userId: u.id }, omit: { photo: false }, include: { user: { select: { fullName: true, email: true, phone: true, lastLoginAt: true } } } });
    if (!p) throw forbidden('This account has no teacher registration');
    return { fullName: p.user.fullName, email: p.user.email, phone: p.user.phone, employeeId: p.employeeId, department: p.department, designation: p.designation, status: p.status, lastLoginAt: p.user.lastLoginAt,
      photo: p.photo && p.photoMime ? `data:${p.photoMime};base64,${Buffer.from(p.photo).toString('base64')}` : null };
  }

  /** Name, email, faculty ID and every assignment are administrator-managed; the teacher may change contact and role details only. */
  async updateProfile(u: AuthUser, d: { phone?: string; department?: string; designation?: string; photo?: string | null }, ip?: string) {
    if (d.phone !== undefined && !isValidPhone(d.phone)) throw badRequest(PHONE_HINT);
    const photo = d.photo ? decodePhoto(d.photo) : undefined;
    await this.prisma.$transaction(async (tx) => {
      if (d.phone !== undefined) await tx.user.update({ where: { id: u.id }, data: { phone: d.phone.trim() } });
      await tx.teacherProfile.update({ where: { userId: u.id }, data: {
        ...(d.department !== undefined ? { department: d.department.trim() } : {}), ...(d.designation !== undefined ? { designation: d.designation.trim() } : {}),
        ...(d.photo === null ? { photo: null, photoMime: null } : photo ? { photo: Buffer.from(photo.b64, 'base64'), photoMime: photo.mime } : {}) } });
      await this.audit.append(tx, { actor: u, action: 'teacher.profile_updated', entity: 'teacher', entityId: u.id, meta: { fields: Object.keys(d) }, ip });
    });
    return this.profile(u);
  }

  // ── everything below needs an approved teacher ──
  private async pairs(u: AuthUser): Promise<CoursePair[]> {
    const p = (await this.access.pairs(u)) ?? [];
    if (!p.length) {
      const prof = await this.prisma.teacherProfile.findUnique({ where: { userId: u.id }, select: { status: true } });
      if (prof?.status !== 'APPROVED') throw new AppError(403, 'TEACHER_NOT_APPROVED', prof?.status === 'SUSPENDED' ? 'Your access is suspended. Contact your campus administrator.' : 'Your registration has not been approved yet.');
    }
    return p;
  }
  private pairOk = (pairs: CoursePair[], courseId: string, institutionId: string, term?: string | null) => pairs.some((x) => x.courseId === courseId && x.institutionId === institutionId && (!term || x.term === term));

  /** The teacher's own approved assignment, or "not found". */
  private async myAssignment(u: AuthUser, id: string) {
    await this.pairs(u);
    const a = await this.prisma.courseAssignment.findFirst({ where: { id, userId: u.id, status: 'APPROVED', revokedAt: null }, include: this.aInclude });
    if (!a) throw notFound('Assignment');
    return a;
  }
  private aInclude = { course: { select: { id: true, code: true, title: true, semester: true, program: { select: { id: true, code: true, name: true } } } }, institution: { select: { id: true, code: true, name: true } } } satisfies Prisma.CourseAssignmentInclude;

  async assignments(u: AuthUser) {
    await this.pairs(u);
    const rows = await this.prisma.courseAssignment.findMany({ where: { userId: u.id, revokedAt: null, status: { in: ['APPROVED', 'PENDING', 'REJECTED'] } }, include: this.aInclude, orderBy: [{ status: 'asc' }, { requestedAt: 'desc' }] });
    return Promise.all(rows.map(async (a) => ({
      id: a.id, status: a.status, term: a.term, semester: a.course.semester, decisionNote: a.status === 'REJECTED' ? a.decisionNote : null, requestedAt: a.requestedAt,
      course: { code: a.course.code, title: a.course.title }, program: a.course.program, institution: { code: a.institution.code, name: a.institution.name },
      studentCount: a.status === 'APPROVED' ? await this.countStudents([{ courseId: a.courseId, institutionId: a.institutionId, term: a.term }]) : null,
    })));
  }

  async overview(u: AuthUser) {
    const pairs = await this.pairs(u);
    const rows = await this.prisma.courseAssignment.findMany({ where: { userId: u.id, revokedAt: null, status: 'APPROVED' }, include: { course: { select: { programId: true, semester: true } } } });
    const classes = new Set(rows.map((r) => `${r.institutionId}|${r.course.programId}|${r.course.semester}|${r.term}`)).size;
    const subjects = new Set(rows.map((r) => r.courseId)).size;
    const mcqs = pairs.length ? await this.prisma.question.count({ where: { authorId: u.id, status: { not: 'RETIRED' }, poolId: { not: null }, OR: pairs.map((p) => ({ courseId: p.courseId, institutionId: p.institutionId })) } }) : 0;
    // Question and bank figures come from the teacher's own banks inside their approved assignments (never anyone else's).
    const banks = pairs.length ? (await this.prisma.questionPool.findMany({
      where: { ownerId: u.id, archivedAt: null, OR: pairs.map((p) => ({ courseId: p.courseId, institutionId: p.institutionId })) },
      select: { id: true, name: true, term: true, courseId: true, institutionId: true, createdAt: true, submittedAt: true, questions: { where: { status: { not: 'RETIRED' }, authorId: u.id }, select: { status: true, reviewedAt: true } } },
    })).filter((p) => this.pairOk(pairs, p.courseId, p.institutionId, p.term)) : [];
    const questions = { draft: 0, submitted: 0, approved: 0, rejected: 0 };
    for (const b of banks) for (const q of b.questions) { const k = q.status.toLowerCase() as keyof typeof questions; if (k in questions) questions[k]++; }
    const states = banks.map((b) => bankState(b.questions.map((q) => q.status)));
    const count = (st: BankState) => states.filter((x) => x === st).length;
    const events: { kind: 'CREATED' | 'SUBMITTED' | 'REVIEWED'; at: Date; bank: { id: string; name: string }; decision?: 'APPROVED' | 'REJECTED'; count?: number }[] = [];
    for (const b of banks) {
      const bank = { id: b.id, name: b.name }; events.push({ kind: 'CREATED', at: b.createdAt, bank });
      const waiting = b.questions.filter((q) => q.status === 'SUBMITTED').length; if (waiting && b.submittedAt) events.push({ kind: 'SUBMITTED', at: b.submittedAt, bank, count: waiting });
      for (const decision of ['APPROVED', 'REJECTED'] as const) {
        const reviewed = b.questions.filter((q) => q.status === decision && q.reviewedAt); if (!reviewed.length) continue;
        events.push({ kind: 'REVIEWED', at: new Date(Math.max(...reviewed.map((q) => q.reviewedAt!.getTime()))), bank, decision, count: reviewed.length });
      }
    }
    events.sort((x, y) => y.at.getTime() - x.at.getTime());
    return { classes, subjects, mcqs, students: await this.countStudents(pairs), questions,
      banks: { total: banks.length, empty: count('EMPTY'), draft: count('DRAFT'), submitted: count('SUBMITTED'), rejected: count('REJECTED'), approved: count('APPROVED') }, recent: events.slice(0, 8) };
  }

  /** Question Submissions: the teacher's own questions that have left DRAFT, with the reviewer's feedback. No options or answer key are returned here. */
  async submissions(u: AuthUser, f: { status?: 'SUBMITTED' | 'APPROVED' | 'REJECTED'; page: number; pageSize: number }) {
    const pairs = await this.pairs(u);
    const counts = { SUBMITTED: 0, APPROVED: 0, REJECTED: 0 };
    if (!pairs.length) return { total: 0, counts, items: [] };
    const scope: Prisma.QuestionWhereInput = { authorId: u.id, poolId: { not: null }, OR: pairs.map((p) => ({ courseId: p.courseId, institutionId: p.institutionId })) };
    const [grouped, total, rows] = await Promise.all([
      this.prisma.question.groupBy({ by: ['status'], where: { ...scope, status: { in: ['SUBMITTED', 'APPROVED', 'REJECTED'] } }, _count: true }),
      this.prisma.question.count({ where: { ...scope, status: f.status ?? { in: ['SUBMITTED', 'APPROVED', 'REJECTED'] } } }),
      this.prisma.question.findMany({ where: { ...scope, status: f.status ?? { in: ['SUBMITTED', 'APPROVED', 'REJECTED'] } }, orderBy: { updatedAt: 'desc' }, ...paginate(f),
        select: { id: true, stem: true, status: true, reviewNote: true, reviewedAt: true, version: true, topic: true, difficulty: true, updatedAt: true, pool: { select: { id: true, name: true } }, course: { select: { code: true } } } }),
    ]);
    for (const g of grouped) counts[g.status as keyof typeof counts] = g._count;
    return { total, counts, items: rows.map((q) => ({ id: q.id, stem: q.stem.length > 200 ? `${q.stem.slice(0, 200)}…` : q.stem, status: q.status, reviewNote: q.status === 'REJECTED' ? q.reviewNote : null, reviewedAt: q.reviewedAt, version: q.version, topic: q.topic, difficulty: q.difficulty, updatedAt: q.updatedAt, pool: q.pool, course: q.course.code })) };
  }

  // ── students: names only ──
  private studentWhere(pairs: CoursePair[]): Prisma.StudentWhereInput {
    const usable = pairs.filter((p) => !!p.term);
    if (!usable.length) return { id: { in: [] } };
    return { status: 'ACTIVE', OR: usable.map((p) => ({ institutionId: p.institutionId, enrollments: { some: { courseId: p.courseId, term: p.term!, status: 'ENROLLED' as const } } })) };
  }
  private countStudents(pairs: CoursePair[]) { return pairs.length ? this.prisma.student.count({ where: this.studentWhere(pairs) }) : Promise.resolve(0); }

  /** Only the student's name. No id, email, phone, registration number, attendance, marks or any other column is selected, so none can leak. */
  async students(u: AuthUser, f: { assignmentId?: string; search?: string; page: number; pageSize: number }) {
    let pairs = await this.pairs(u);
    if (f.assignmentId) { const a = await this.myAssignment(u, f.assignmentId); pairs = [{ courseId: a.courseId, institutionId: a.institutionId, term: a.term }]; }
    const where: Prisma.StudentWhereInput = { AND: [this.studentWhere(pairs), f.search ? { user: { fullName: { contains: f.search } } } : {}] };
    const [rows, total] = await Promise.all([
      this.prisma.student.findMany({ where, select: { user: { select: { fullName: true } } }, orderBy: { user: { fullName: 'asc' } }, ...paginate(f) }),
      this.prisma.student.count({ where }),
    ]);
    return { total, items: rows.map((r) => ({ name: r.user.fullName })) };
  }

  // ── pools ──
  private async ownPool(u: AuthUser, id: string) {
    const pairs = await this.pairs(u);
    const p = await this.prisma.questionPool.findFirst({ where: { id, ownerId: u.id, archivedAt: null } });
    if (!p || !this.pairOk(pairs, p.courseId, p.institutionId, p.term)) throw notFound('Question pool');
    return p;
  }

  async pools(u: AuthUser, f: { assignmentId?: string }) {
    const pairs = await this.pairs(u);
    if (!pairs.length) return [];
    let courseId: string | undefined; let institutionId: string | undefined; let term: string | undefined;
    if (f.assignmentId) { const a = await this.myAssignment(u, f.assignmentId); courseId = a.courseId; institutionId = a.institutionId; term = a.term ?? undefined; }
    const pools = await this.prisma.questionPool.findMany({
      where: { ownerId: u.id, archivedAt: null, courseId, institutionId, term, OR: pairs.map((p) => ({ courseId: p.courseId, institutionId: p.institutionId })) },
      orderBy: { createdAt: 'desc' }, include: { questions: { where: { status: { not: 'RETIRED' } }, select: { status: true } } },
    });
    const courses = await this.prisma.course.findMany({ where: { id: { in: [...new Set(pools.map((p) => p.courseId))] } }, select: { id: true, code: true, title: true } });
    return pools.filter((p) => this.pairOk(pairs, p.courseId, p.institutionId, p.term)).map((p) => ({
      id: p.id, name: p.name, description: p.description, term: p.term, submittedAt: p.submittedAt, state: bankState(p.questions.map((q) => q.status)), course: courses.find((c) => c.id === p.courseId),
      counts: { total: p.questions.length, draft: p.questions.filter((q) => q.status === 'DRAFT' || q.status === 'REJECTED').length, submitted: p.questions.filter((q) => q.status === 'SUBMITTED').length, approved: p.questions.filter((q) => q.status === 'APPROVED').length },
    }));
  }

  async createPool(u: AuthUser, d: { assignmentId: string; name: string; description?: string }, ip?: string) {
    const a = await this.myAssignment(u, d.assignmentId);
    const pool = await this.prisma.$transaction(async (tx) => {
      const p = await tx.questionPool.create({ data: { ownerId: u.id, courseId: a.courseId, institutionId: a.institutionId, term: a.term, name: d.name.trim(), description: d.description?.trim() || null } });
      await this.audit.append(tx, { actor: u, action: 'pool.create', entity: 'question_pool', entityId: p.id, institutionId: a.institutionId, meta: { name: p.name, courseId: a.courseId }, ip });
      return p;
    });
    return { id: pool.id };
  }

  async updatePool(u: AuthUser, id: string, d: { name?: string; description?: string | null }, ip?: string) {
    const p = await this.ownPool(u, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.questionPool.update({ where: { id }, data: { ...(d.name !== undefined ? { name: d.name.trim() } : {}), ...(d.description !== undefined ? { description: d.description?.trim() || null } : {}) } });
      await this.audit.append(tx, { actor: u, action: 'pool.update', entity: 'question_pool', entityId: id, institutionId: p.institutionId, meta: { fields: Object.keys(d) }, ip });
    });
    return { ok: true };
  }

  /** Archives the pool. Drafts are retired with it; anything submitted or approved is kept (it may already be in an examination). */
  async deletePool(u: AuthUser, id: string, ip?: string) {
    const p = await this.ownPool(u, id);
    const blocked = await this.prisma.question.count({ where: { poolId: id, status: { in: ['SUBMITTED', 'APPROVED'] } } });
    if (blocked) throw new AppError(409, 'POOL_IN_USE', 'This pool has submitted or approved questions and cannot be deleted. Delete or retire its questions first, or ask an administrator.');
    await this.prisma.$transaction(async (tx) => {
      await tx.question.updateMany({ where: { poolId: id, status: { in: ['DRAFT', 'REJECTED'] } }, data: { status: 'RETIRED' } });
      await tx.questionPool.update({ where: { id }, data: { archivedAt: new Date() } });
      await this.audit.append(tx, { actor: u, action: 'pool.delete', entity: 'question_pool', entityId: id, institutionId: p.institutionId, ip });
    });
    return { ok: true };
  }

  /** Sends every draft/rejected question of the pool to the examiners in one step (one audit entry per question, one notification). */
  async submitPool(u: AuthUser, id: string, ip?: string) {
    const p = await this.ownPool(u, id);
    const qs = await this.prisma.question.findMany({ where: { poolId: id, authorId: u.id, status: { in: ['DRAFT', 'REJECTED'] } }, select: { id: true } });
    if (!qs.length) throw new AppError(409, 'NOTHING_TO_SUBMIT', 'There are no draft questions in this pool to submit.');
    await this.prisma.$transaction(async (tx) => {
      await tx.question.updateMany({ where: { id: { in: qs.map((q) => q.id) } }, data: { status: 'SUBMITTED', reviewNote: null } });
      await tx.questionPool.update({ where: { id }, data: { submittedAt: new Date() } });
      for (const q of qs) await this.audit.append(tx, { actor: u, action: 'question.submit', entity: 'question', entityId: q.id, institutionId: p.institutionId, meta: { pool: id }, ip });
    });
    await this.notifications.notifyRole('EXAMINER', 'Question pool awaiting review', `${p.name}: ${qs.length} question${qs.length === 1 ? '' : 's'} submitted for approval.`, LINKS.questions).catch(() => undefined);
    return { submitted: qs.length };
  }

  // ── questions ──
  private toInput(poolId: string, p: { courseId: string; institutionId: string }, d: McqInput): QuestionInput {
    if (d.options.length < 4 || d.options.length > 5) throw badRequest('A question needs four or five options');
    if (d.correctIndex < 0 || d.correctIndex >= d.options.length) throw badRequest('Select the correct answer');
    return { courseId: p.courseId, institutionId: p.institutionId, type: 'MCQ', stem: d.stem.trim(), explanation: d.explanation?.trim() || undefined, difficulty: d.difficulty, topic: d.topic?.trim() || undefined, subtopic: d.subtopic === undefined ? undefined : d.subtopic?.trim() || null, bloom: d.bloom === undefined ? undefined : d.bloom ?? null, imageId: d.imageId === undefined ? undefined : d.imageId ?? null, defaultMarks: d.marks, poolId,
      options: d.options.map((text, i) => ({ label: LABELS[i]!, text: text.trim(), isCorrect: i === d.correctIndex })) };
  }
  private view(q: { id: string; poolId: string | null; stem: string; explanation: string | null; difficulty: string; topic: string | null; subtopic: string | null; bloom: string | null; imageId: string | null; defaultMarks: number; status: string; version: number; reviewNote: string | null; updatedAt: Date; options: { label: string; text: string; isCorrect: boolean }[] }) {
    return { id: q.id, poolId: q.poolId, stem: q.stem, explanation: q.explanation, difficulty: q.difficulty, topic: q.topic, subtopic: q.subtopic, bloom: q.bloom, imageId: q.imageId, marks: q.defaultMarks, status: q.status, version: q.version, reviewNote: q.reviewNote, updatedAt: q.updatedAt,
      options: [...q.options].sort((a, b) => a.label.localeCompare(b.label)).map((o) => ({ label: o.label, text: o.text, isCorrect: o.isCorrect })) };
  }
  private async ownQuestion(u: AuthUser, id: string) {
    const pairs = await this.pairs(u);
    const q = await this.prisma.question.findFirst({ where: { id, authorId: u.id, poolId: { not: null } }, include: { options: true } });
    if (!q || !this.pairOk(pairs, q.courseId, q.institutionId)) throw notFound('Question');
    return q;
  }

  async listQuestions(u: AuthUser, f: { poolId?: string; assignmentId?: string; topic?: string; difficulty?: string; status?: string; search?: string; page: number; pageSize: number }) {
    const pairs = await this.pairs(u);
    if (!pairs.length) return { total: 0, items: [], topics: [] };
    const and: Prisma.QuestionWhereInput[] = [{ authorId: u.id, status: f.status ? (f.status as never) : { not: 'RETIRED' }, poolId: { not: null }, OR: pairs.map((p) => ({ courseId: p.courseId, institutionId: p.institutionId })) }];
    if (f.poolId) { await this.ownPool(u, f.poolId); and.push({ poolId: f.poolId }); }
    if (f.assignmentId) { const a = await this.myAssignment(u, f.assignmentId); and.push({ courseId: a.courseId, institutionId: a.institutionId }); }
    if (f.topic) and.push({ topic: { equals: f.topic } });
    if (f.difficulty) and.push({ difficulty: f.difficulty as never });
    if (f.search) and.push({ OR: [{ stem: { contains: f.search } }, { topic: { contains: f.search } }, { subtopic: { contains: f.search } }] });
    const where = { AND: and };
    const [rows, total, topics] = await Promise.all([
      this.prisma.question.findMany({ where, include: { options: true, course: { select: { code: true } } }, orderBy: { createdAt: 'desc' }, ...paginate(f) }),
      this.prisma.question.count({ where }),
      this.prisma.question.findMany({ where: { authorId: u.id, topic: { not: null }, poolId: { not: null }, OR: pairs.map((p) => ({ courseId: p.courseId, institutionId: p.institutionId })) }, distinct: ['topic'], select: { topic: true }, orderBy: { topic: 'asc' } }),
    ]);
    return { total, topics: topics.map((t) => t.topic), items: rows.map((q) => ({ ...this.view(q), course: q.course.code })) };
  }

  async getQuestion(u: AuthUser, id: string) { return this.view(await this.ownQuestion(u, id)); }

  async createQuestion(u: AuthUser, poolId: string, d: McqInput, ip?: string) {
    const p = await this.ownPool(u, poolId);
    await this.imageOwned(u, d.imageId);
    const input = this.toInput(poolId, p, d); validateQuestion(input);
    const q = await this.questions.create(u, input, ip);
    return this.view(q);
  }

  async updateQuestion(u: AuthUser, id: string, d: McqInput, ip?: string) {
    const q = await this.ownQuestion(u, id);
    await this.imageOwned(u, d.imageId);
    const input = this.toInput(q.poolId!, q, d);
    return this.view(await this.questions.update(u, id, input, ip));
  }

  /** The image must be one this teacher uploaded; anything else reads as "not found" so ids cannot be probed. */
  private async imageOwned(u: AuthUser, imageId?: string | null) {
    if (!imageId) return;
    if (!(await this.prisma.questionImage.findFirst({ where: { id: imageId, uploadedById: u.id }, select: { id: true } }))) throw badRequest('That image was not found. Upload it again.');
  }

  async uploadImage(u: AuthUser, dataUrl: string, ip?: string) {
    await this.pairs(u);
    const { mime, bytes } = decodeQuestionImage(dataUrl);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const same = await this.prisma.questionImage.findFirst({ where: { uploadedById: u.id, sha256 }, select: { id: true } });   // the same file is stored once per teacher
    if (same) return { id: same.id };
    const img = await this.prisma.$transaction(async (tx) => {
      const made = await tx.questionImage.create({ data: { uploadedById: u.id, mime, sizeBytes: bytes.length, sha256, data: new Uint8Array(bytes) } });
      await this.audit.append(tx, { actor: u, action: 'question_image.upload', entity: 'question_image', entityId: made.id, meta: { mime, bytes: bytes.length }, ip });
      return made;
    });
    return { id: img.id };
  }

  async getImage(u: AuthUser, id: string) {
    await this.pairs(u);
    const img = await this.prisma.questionImage.findFirst({ where: { id, uploadedById: u.id } });
    if (!img) throw notFound('Image');
    return { id: img.id, mime: img.mime, data: `data:${img.mime};base64,${Buffer.from(img.data).toString('base64')}` };
  }

  async duplicateQuestion(u: AuthUser, id: string, ip?: string) {
    const q = await this.ownQuestion(u, id);
    const sorted = [...q.options].sort((a, b) => a.label.localeCompare(b.label));
    const copy = await this.questions.create(u, this.toInput(q.poolId!, q, { stem: q.stem, options: sorted.map((o) => o.text), correctIndex: sorted.findIndex((o) => o.isCorrect), explanation: q.explanation ?? undefined, difficulty: q.difficulty, topic: q.topic ?? undefined, subtopic: q.subtopic, bloom: q.bloom, imageId: q.imageId, marks: q.defaultMarks }), ip);
    return this.view(copy);
  }

  async deleteQuestion(u: AuthUser, id: string, ip?: string) {
    await this.ownQuestion(u, id);
    return this.questions.retire(u, id, ip);                // retired, not erased: a question already used in an examination keeps its frozen paper content
  }

  async submitQuestion(u: AuthUser, id: string, ip?: string) { await this.ownQuestion(u, id); return this.questions.submit(u, id, ip); }

  /** All-or-nothing import. Rows are validated with exactly the rules used for manual entry; the first problem is reported with its row number. */
  async importQuestions(u: AuthUser, poolId: string, rows: { statement: string; options: string[]; correct: string; explanation?: string; difficulty?: string; topic?: string; subtopic?: string; bloom?: string; marks?: number }[], ip?: string) {
    const p = await this.ownPool(u, poolId);
    const prepared = rows.map((r, i) => {
      const where = `Row ${i + 2}`;
      const idx = LABELS.indexOf(String(r.correct ?? '').trim().toUpperCase());
      const difficulty = (String(r.difficulty ?? 'MEDIUM').trim().toUpperCase() || 'MEDIUM') as 'EASY' | 'MEDIUM' | 'HARD';
      if (!['EASY', 'MEDIUM', 'HARD'].includes(difficulty)) throw badRequest(`${where}: difficulty must be Easy, Medium or Hard`);
      const bloomRaw = String(r.bloom ?? '').trim().toUpperCase(); if (bloomRaw && !(BLOOM as readonly string[]).includes(bloomRaw)) throw badRequest(`${where}: Bloom level must be one of Remember, Understand, Apply, Analyze, Evaluate or Create`);
      if ((r.subtopic ?? '').length > 120) throw badRequest(`${where}: the subtopic is too long (120 characters at most)`);
      const opts = r.options.map((o) => (o ?? '').trim()).filter(Boolean);
      if ((r.statement ?? '').trim().length < 3) throw badRequest(`${where}: the question statement is missing`);
      if (idx < 0 || idx >= opts.length) throw badRequest(`${where}: the correct answer must be a letter that matches one of the options`);
      const marks = r.marks === undefined || Number.isNaN(r.marks) ? 1 : r.marks; if (!(marks > 0 && marks <= 100)) throw badRequest(`${where}: marks must be between 0 and 100`);
      try { const input = this.toInput(poolId, p, { stem: r.statement, options: opts, correctIndex: idx, explanation: r.explanation, difficulty, topic: r.topic, subtopic: r.subtopic, bloom: (bloomRaw || null) as Bloom | null, marks }); validateQuestion(input); return input; }
      catch (e) { throw badRequest(`${where}: ${(e as Error).message}`); }
    });
    await this.prisma.$transaction(async (tx) => {
      for (const input of prepared) {
        const q = await tx.question.create({ data: { courseId: input.courseId, institutionId: input.institutionId!, authorId: u.id, type: 'MCQ', tags: [], stem: input.stem, explanation: input.explanation, difficulty: input.difficulty, poolId, topic: input.topic, subtopic: input.subtopic ?? null, bloom: input.bloom ?? null, defaultMarks: input.defaultMarks ?? 1, options: { create: input.options } }, include: { options: true } });
        await tx.questionVersion.create({ data: { questionId: q.id, version: q.version, changedById: u.id, snapshot: versionSnapshot(q) } });
        await this.audit.append(tx, { actor: u, action: 'question.create', entity: 'question', entityId: q.id, institutionId: p.institutionId, meta: { import: true, pool: poolId }, ip });
      }
    }, { timeout: 60_000 });
    return { created: prepared.length };
  }

  /** CSV of the teacher's own, authorized pool, including the correct answer (this is the author's own bank; no student API serves it). */
  async exportPool(u: AuthUser, poolId: string, ip?: string) {
    const p = await this.ownPool(u, poolId);
    const qs = await this.prisma.question.findMany({ where: { poolId, authorId: u.id, status: { not: 'RETIRED' } }, include: { options: true }, orderBy: { createdAt: 'asc' } });
    const head = ['statement', 'option_a', 'option_b', 'option_c', 'option_d', 'option_e', 'correct', 'explanation', 'difficulty', 'topic', 'subtopic', 'bloom', 'marks', 'status'];
    const rows = qs.map((q) => { const o = [...q.options].sort((a, b) => a.label.localeCompare(b.label)); return [q.stem, ...LABELS.map((_, i) => o[i]?.text ?? ''), o.find((x) => x.isCorrect)?.label ?? '', q.explanation ?? '', q.difficulty.toLowerCase(), q.topic ?? '', q.subtopic ?? '', q.bloom?.toLowerCase() ?? '', q.defaultMarks, q.status.toLowerCase()]; });
    const lines = rows.map((r) => r.map(safeCell).join(','));
    await this.audit.log({ actor: u, action: 'pool.export', entity: 'question_pool', entityId: poolId, institutionId: p.institutionId, meta: { rows: qs.length }, ip });
    return { filename: `${p.name.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 60) || 'pool'}.csv`, csv: [head.join(','), ...lines].join('\r\n') + '\r\n', table: { head, rows }, rows: qs.length };
  }
}
