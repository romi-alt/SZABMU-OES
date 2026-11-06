import { Injectable } from '@nestjs/common';
import { LINKS } from '@oes/shared';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infra/prisma.service';
import { KvService } from '../../infra/kv.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { dropUserSessions, scope, type AuthUser } from '../../common/auth';
import { badRequest, conflict, notFound } from '../../common/errors';
import { paginate } from '../../common/validate';
import { bankState } from './bank-status';

/**
 * Administrator side of teacher registration. Campus administrators see only the requests (and the teachers behind them) that name their own
 * institutions; super administrators see everything. Every decision is written to the audit trail in the same transaction as the change.
 */
@Injectable()
export class TeacherAdminService {
  constructor(private readonly prisma: PrismaService, private readonly kv: KvService, private readonly audit: AuditService, private readonly notifications: NotificationsService) {}

  /** Prisma filter: assignment rows this administrator may see. */
  private aWhere(u: AuthUser): Prisma.CourseAssignmentWhereInput { return { user: { role: 'TEACHER' }, institutionId: scope.filter(u) }; }

  /** The teacher exists and at least one of their requests/assignments is inside the administrator's scope; otherwise "not found" (no existence oracle). */
  private async load(u: AuthUser, userId: string) {
    const prof = await this.prisma.teacherProfile.findUnique({ where: { userId }, omit: { photo: false }, include: { user: { select: { id: true, fullName: true, email: true, phone: true, active: true, createdAt: true, lastLoginAt: true } } } });
    if (!prof) throw notFound('Teacher');
    if (u.institutionIds !== null && !(await this.prisma.courseAssignment.count({ where: { userId, ...this.aWhere(u) } }))) throw notFound('Teacher');
    return prof;
  }

  async list(u: AuthUser, f: { status?: string; search?: string; page: number; pageSize: number }) {
    const where: Prisma.TeacherProfileWhereInput = {
      ...(f.status ? { status: f.status as never } : {}),
      ...(u.institutionIds === null ? {} : { user: { courseAssignments: { some: this.aWhere(u) } } }),
      ...(f.search ? { OR: [{ employeeId: { contains: f.search } }, { department: { contains: f.search } }, { user: { fullName: { contains: f.search } } }, { user: { email: { contains: f.search } } }] } : {}),
    };
    const [rows, total, pending] = await Promise.all([
      this.prisma.teacherProfile.findMany({ where, orderBy: [{ status: 'asc' }, { submittedAt: 'desc' }], ...paginate(f), include: { user: { select: { id: true, fullName: true, email: true } } } }),
      this.prisma.teacherProfile.count({ where }),
      this.prisma.teacherProfile.count({ where: { status: 'PENDING', ...(u.institutionIds === null ? {} : { user: { courseAssignments: { some: this.aWhere(u) } } }) } }),
    ]);
    const assigns = await this.prisma.courseAssignment.groupBy({ by: ['userId', 'status'], where: { userId: { in: rows.map((r) => r.userId) }, revokedAt: null, ...this.aWhere(u) }, _count: true });
    const counts = (id: string) => Object.fromEntries(['PENDING', 'APPROVED', 'REJECTED'].map((s) => [s.toLowerCase(), assigns.find((a) => a.userId === id && a.status === s)?._count ?? 0]));
    return { total, pending, items: rows.map((r) => ({ userId: r.userId, fullName: r.user.fullName, email: r.user.email, employeeId: r.employeeId, department: r.department, designation: r.designation, status: r.status, submittedAt: r.submittedAt, assignments: counts(r.userId) })) };
  }

  async detail(u: AuthUser, userId: string) {
    const p = await this.load(u, userId);
    const assignments = await this.prisma.courseAssignment.findMany({
      where: { userId, ...this.aWhere(u) }, orderBy: [{ status: 'asc' }, { requestedAt: 'desc' }],
      include: { course: { select: { code: true, title: true, semester: true, program: { select: { code: true, name: true } } } }, institution: { select: { code: true, name: true } } },
    });
    return {
      userId, fullName: p.user.fullName, email: p.user.email, phone: p.user.phone, employeeId: p.employeeId, department: p.department, designation: p.designation,
      status: p.status, reviewNote: p.reviewNote, submittedAt: p.submittedAt, reviewedAt: p.reviewedAt, suspendedAt: p.suspendedAt, lastLoginAt: p.user.lastLoginAt,
      photo: p.photo && p.photoMime ? `data:${p.photoMime};base64,${Buffer.from(p.photo).toString('base64')}` : null,
      assignments: assignments.map((a) => ({ id: a.id, status: a.status, term: a.term, requestedAt: a.requestedAt, decidedAt: a.decidedAt, decisionNote: a.decisionNote, course: a.course, institution: a.institution })),
    };
  }

  /** Identity decision. It grants nothing by itself: access needs an APPROVED assignment as well. */
  async decide(u: AuthUser, userId: string, decision: 'APPROVE' | 'REJECT', note: string | undefined, ip?: string) {
    const p = await this.load(u, userId);
    if (decision === 'REJECT' && !(note ?? '').trim()) throw badRequest('A reason is required when rejecting a registration');
    if (p.status === 'SUSPENDED') throw conflict('BAD_STATE', 'This teacher is suspended. Reinstate the teacher first.');
    const status = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    if (p.status === status) throw conflict('NO_CHANGE', `The registration is already ${status.toLowerCase()}`);
    await this.prisma.$transaction(async (tx) => {
      await tx.teacherProfile.update({ where: { userId }, data: { status, reviewedById: u.id, reviewedAt: new Date(), reviewNote: note?.trim() || null } });
      await this.audit.append(tx, { actor: u, action: `teacher.${decision.toLowerCase()}`, entity: 'teacher', entityId: userId, meta: { from: p.status, note: note?.trim() || null }, ip });
    });
    await dropUserSessions(this.kv, userId);
    await this.notifications.notify([userId], status === 'APPROVED' ? 'Registration approved' : 'Registration not approved', status === 'APPROVED' ? 'Your teacher registration was approved. Access to each class and subject starts when it is approved.' : (note ?? 'Your teacher registration was not approved.'), LINKS.classes);
    return { status };
  }

  async suspend(u: AuthUser, userId: string, note: string, ip?: string) {
    const p = await this.load(u, userId);
    if (p.status !== 'APPROVED') throw conflict('BAD_STATE', 'Only an approved teacher can be suspended');
    await this.prisma.$transaction(async (tx) => {
      await tx.teacherProfile.update({ where: { userId }, data: { status: 'SUSPENDED', suspendedAt: new Date(), reviewedById: u.id, reviewedAt: new Date(), reviewNote: note.trim() } });
      await this.audit.append(tx, { actor: u, action: 'teacher.suspend', entity: 'teacher', entityId: userId, meta: { note: note.trim() }, ip });
    });
    await this.revokeSessionsNow(userId);
    await this.notifications.notify([userId], 'Access suspended', 'Your teacher access was suspended. Contact your campus administrator.', undefined);
    return { status: 'SUSPENDED' };
  }

  async reinstate(u: AuthUser, userId: string, note: string | undefined, ip?: string) {
    const p = await this.load(u, userId);
    if (p.status !== 'SUSPENDED') throw conflict('BAD_STATE', 'Only a suspended teacher can be reinstated');
    await this.prisma.$transaction(async (tx) => {
      await tx.teacherProfile.update({ where: { userId }, data: { status: 'APPROVED', suspendedAt: null, reviewedById: u.id, reviewedAt: new Date(), reviewNote: note?.trim() || null } });
      await this.audit.append(tx, { actor: u, action: 'teacher.reinstate', entity: 'teacher', entityId: userId, meta: { note: note?.trim() || null }, ip });
    });
    await dropUserSessions(this.kv, userId);
    return { status: 'APPROVED' };
  }

  async decideAssignment(u: AuthUser, id: string, decision: 'APPROVE' | 'REJECT', note: string | undefined, ip?: string) {
    const a = await this.assignment(u, id);
    if (a.status !== 'PENDING') throw conflict('BAD_STATE', `Only a pending request can be decided (this one is ${a.status.toLowerCase()})`);
    if (decision === 'REJECT' && !(note ?? '').trim()) throw badRequest('A reason is required when rejecting a request');
    const status = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    await this.prisma.$transaction(async (tx) => {
      const r = await tx.courseAssignment.updateMany({ where: { id, status: 'PENDING' }, data: { status, decidedById: u.id, decidedAt: new Date(), decisionNote: note?.trim() || null } });
      if (r.count !== 1) throw conflict('BAD_STATE', 'This request was decided by someone else a moment ago');
      if (status === 'APPROVED') await tx.userInstitution.upsert({ where: { userId_institutionId: { userId: a.userId, institutionId: a.institutionId } }, create: { userId: a.userId, institutionId: a.institutionId }, update: {} });
      await this.audit.append(tx, { actor: u, action: `teacher.assignment_${decision.toLowerCase()}`, entity: 'course_assignment', entityId: id, institutionId: a.institutionId, meta: { teacherId: a.userId, courseId: a.courseId, term: a.term, note: note?.trim() || null }, ip });
    });
    await dropUserSessions(this.kv, a.userId);
    await this.notifications.notify([a.userId], status === 'APPROVED' ? 'Class and subject approved' : 'Class and subject not approved', `${a.course.code} (${a.term ?? 'session'}): ${status === 'APPROVED' ? 'approved. You can now work with this subject.' : note ?? 'not approved.'}`, LINKS.classes);
    return { status };
  }

  /** Immediately removes access to the class-subject; questions the teacher wrote stay in the bank, hidden from them. */
  async revokeAssignment(u: AuthUser, id: string, note: string, ip?: string) {
    const a = await this.assignment(u, id);
    if (a.status !== 'APPROVED') throw conflict('BAD_STATE', 'Only an approved assignment can be revoked');
    await this.prisma.$transaction(async (tx) => {
      await tx.courseAssignment.update({ where: { id }, data: { status: 'REVOKED', revokedAt: new Date(), revokedById: u.id, decisionNote: note.trim() } });
      const stillThere = await tx.courseAssignment.count({ where: { userId: a.userId, institutionId: a.institutionId, status: 'APPROVED', revokedAt: null, id: { not: id } } });
      if (!stillThere) await tx.userInstitution.deleteMany({ where: { userId: a.userId, institutionId: a.institutionId } });
      await this.audit.append(tx, { actor: u, action: 'teacher.assignment_revoke', entity: 'course_assignment', entityId: id, institutionId: a.institutionId, meta: { teacherId: a.userId, courseId: a.courseId, term: a.term, note: note.trim() }, ip });
    });
    await dropUserSessions(this.kv, a.userId);
    await this.notifications.notify([a.userId], 'Class and subject removed', `${a.course.code} (${a.term ?? 'session'}) was removed from your assignments. ${note.trim()}`, LINKS.classes);
    return { status: 'REVOKED' };
  }

  private async assignment(u: AuthUser, id: string) {
    const a = await this.prisma.courseAssignment.findFirst({ where: { id, ...this.aWhere(u) }, include: { course: { select: { code: true } } } });
    if (!a) throw notFound('Assignment');
    return a;
  }

  /**
   * What a teacher has done with their question banks, and what reviewers decided, newest first (up to 100 entries), with a summary of where
   * their banks and questions stand. Names, actions, comments and counts only: no addresses, answer keys or log hashes. Campus administrators
   * see only entries recorded for their own institutions.
   */
  async activity(u: AuthUser, userId: string) {
    await this.load(u, userId);
    const pools = await this.prisma.questionPool.findMany({ where: { ownerId: userId, archivedAt: null, institutionId: scope.filter(u) }, select: { id: true, name: true } });
    const ids = pools.map((p) => p.id);
    const qStatus = ids.length ? await this.prisma.question.groupBy({ by: ['status', 'poolId'], where: { poolId: { in: ids }, status: { not: 'RETIRED' } }, _count: true }) : [];
    const questions = { draft: 0, submitted: 0, approved: 0, rejected: 0 };
    for (const g of qStatus) { const k = g.status.toLowerCase() as keyof typeof questions; if (k in questions) questions[k] += g._count; }
    const banks = { total: ids.length, empty: 0, draft: 0, submitted: 0, approved: 0, rejected: 0 };
    for (const p of pools) {
      const st = bankState(qStatus.filter((g) => g.poolId === p.id).flatMap((g) => Array<string>(g._count).fill(g.status)));
      banks[st.toLowerCase() as keyof typeof banks]++;
    }
    const MINE = ['pool.create', 'pool.update', 'pool.delete', 'pool.export', 'question.create', 'question.update', 'question.submit', 'question.retire', 'question_image.upload'];
    const logs = await this.prisma.auditLog.findMany({
      where: { institutionId: scope.filter(u), OR: [{ actorId: userId, action: { in: MINE } }, { entity: 'question_pool', action: 'question_pool.review', entityId: { in: ids } }] },
      orderBy: { seq: 'desc' }, take: 100, select: { at: true, action: true, entity: true, entityId: true, actorId: true, actorRole: true, meta: true },
    });
    const qIds = logs.filter((l) => l.entity === 'question' && l.entityId).map((l) => l.entityId!);
    const qPool = qIds.length ? await this.prisma.question.findMany({ where: { id: { in: qIds } }, select: { id: true, poolId: true } }) : [];
    const actors = await this.prisma.user.findMany({ where: { id: { in: [...new Set(logs.map((l) => l.actorId).filter(Boolean) as string[])] } }, select: { id: true, fullName: true } });
    const items = logs.map((l) => {
      const m = (l.meta ?? {}) as { note?: string | null; approved?: number; rejected?: number; rows?: number; pool?: string };
      const poolId = l.entity === 'question_pool' ? l.entityId : l.entity === 'question' ? qPool.find((q) => q.id === l.entityId)?.poolId ?? m.pool ?? null : null;
      const bank = poolId ? pools.find((p) => p.id === poolId) : undefined;
      return { at: l.at, action: l.action, actor: { name: actors.find((a) => a.id === l.actorId)?.fullName ?? 'System', role: l.actorRole }, bank: bank ? { id: bank.id, name: bank.name } : null,
        note: m.note ?? null, ...(typeof m.approved === 'number' ? { approved: m.approved } : {}), ...(typeof m.rejected === 'number' ? { rejected: m.rejected } : {}), ...(typeof m.rows === 'number' ? { rows: m.rows } : {}) };
    });
    return { summary: { banks, questions }, items };
  }

  /** What the teacher has written, for review: counts and question statements. Correct answers are not shown here. */
  async pools(u: AuthUser, userId: string) {
    await this.load(u, userId);
    const pools = await this.prisma.questionPool.findMany({
      where: { ownerId: userId, archivedAt: null, institutionId: scope.filter(u) }, orderBy: { createdAt: 'desc' },
      include: { questions: { where: { status: { not: 'RETIRED' } }, select: { id: true, stem: true, status: true, difficulty: true, topic: true }, orderBy: { createdAt: 'asc' } } },
    });
    const courses = await this.prisma.course.findMany({ where: { id: { in: [...new Set(pools.map((p) => p.courseId))] } }, select: { id: true, code: true, title: true } });
    return pools.map((p) => ({ id: p.id, name: p.name, term: p.term, submittedAt: p.submittedAt, course: courses.find((c) => c.id === p.courseId), questions: p.questions.map((q) => ({ ...q, stem: q.stem.slice(0, 240) })) }));
  }

  /** Sign-in sessions end now (the cached profile is dropped as well), so a suspended teacher is signed out on the next request. */
  private async revokeSessionsNow(userId: string) {
    await this.prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await dropUserSessions(this.kv, userId);
  }
}
