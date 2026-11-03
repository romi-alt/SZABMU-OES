import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infra/prisma.service';
import { AuditService } from '../audit/audit.service';
import { scope, type AuthUser } from '../../common/auth';
import { badRequest, conflict, forbidden, notFound } from '../../common/errors';

export interface CoursePair { courseId: string; institutionId: string; term?: string | null }

/**
 * Lecturer ↔ course authorization. A LECTURER may author/manage questions, build papers and review grading only for
 * (course, institution) pairs with an ACTIVE assignment. Other roles keep their existing scope rules (returns null).
 */
@Injectable()
export class CourseAccessService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  /** null ⇒ the user is not course-restricted. */
  async pairs(u: AuthUser): Promise<CoursePair[] | null> {
    if (u.role === 'TEACHER') {
      // Deny by default, checked against the database on EVERY call (never the cached session): the teacher's identity must be APPROVED, the
      // account active, and the assignment APPROVED and not revoked. Suspending a teacher or revoking an assignment therefore takes effect at once.
      const p = await this.prisma.teacherProfile.findUnique({ where: { userId: u.id }, select: { status: true, user: { select: { active: true } } } });
      if (!p || p.status !== 'APPROVED' || !p.user.active) return [];
      return this.prisma.courseAssignment.findMany({ where: { userId: u.id, revokedAt: null, status: 'APPROVED' }, select: { courseId: true, institutionId: true, term: true } });
    }
    if (u.role !== 'LECTURER') return null;
    return this.prisma.courseAssignment.findMany({
      where: { userId: u.id, revokedAt: null, status: 'APPROVED', institutionId: scope.filter(u) },
      select: { courseId: true, institutionId: true },
    });
  }

  /** Prisma filter for questions. An empty assignment list matches nothing (deny by default). */
  async questionWhere(u: AuthUser): Promise<Prisma.QuestionWhereInput> {
    const p = await this.pairs(u);
    if (p === null) return {};
    // NB: an empty `OR: []` is NOT reliably "match nothing" in Prisma — be explicit so no assignments ⇒ no rows.
    if (p.length === 0) return { id: { in: [] } };
    return { OR: p.map((x) => ({ courseId: x.courseId, institutionId: x.institutionId })) };
  }

  async allows(u: AuthUser, courseId: string, institutionId?: string): Promise<boolean> {
    const p = await this.pairs(u);
    return p === null || p.some((x) => x.courseId === courseId && (!institutionId || x.institutionId === institutionId));
  }

  /** Course ids a lecturer may act on (any institution); null when unrestricted. */
  async courseIds(u: AuthUser): Promise<string[] | null> {
    const p = await this.pairs(u);
    return p === null ? null : [...new Set(p.map((x) => x.courseId))];
  }

  async assert(u: AuthUser, courseId: string, institutionId?: string) {
    if (!(await this.allows(u, courseId, institutionId))) throw forbidden('You are not assigned to this course');
  }

  /** For exam-level actions: the lecturer needs an active assignment to the exam's course at a participating institution. */
  async assertExam(u: AuthUser, exam: { courseId: string; institutions: { institutionId: string }[] }) {
    const p = await this.pairs(u);
    if (p === null) return;
    const parts = new Set(exam.institutions.map((i) => i.institutionId));
    if (!p.some((x) => x.courseId === exam.courseId && parts.has(x.institutionId))) throw forbidden('You are not assigned to this examination\'s course');
  }

  // ── administration ──
  async assign(u: AuthUser, d: { userId: string; courseId: string; institutionId: string }, ip?: string) {
    scope.assert(u, d.institutionId);
    const [target, course] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: d.userId }, select: { id: true, role: true, active: true, institutions: { select: { institutionId: true } } } }),
      this.prisma.course.findUnique({ where: { id: d.courseId }, select: { id: true } }),
    ]);
    if (!course) throw notFound('Course');
    if (!target || target.role !== 'LECTURER' || !target.active) throw badRequest('The user must be an active lecturer');
    if (!target.institutions.some((i) => i.institutionId === d.institutionId)) throw badRequest('The lecturer does not belong to that institution');
    try {
      const a = await this.prisma.courseAssignment.create({ data: { ...d, assignedById: u.id } });
      await this.audit.log({ actor: u, action: 'course.assign', entity: 'course_assignment', entityId: a.id, institutionId: d.institutionId, meta: { userId: d.userId, courseId: d.courseId }, ip });
      return a;
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw conflict('ALREADY_ASSIGNED', 'This lecturer is already assigned to the course at that institution');
      throw e;
    }
  }

  async revoke(u: AuthUser, id: string, ip?: string) {
    const a = await this.prisma.courseAssignment.findUnique({ where: { id } });
    if (!a || !scope.allows(u, a.institutionId)) throw notFound('Assignment');
    if (a.revokedAt) throw conflict('ALREADY_REVOKED', 'The assignment is already revoked');
    await this.prisma.courseAssignment.update({ where: { id }, data: { revokedAt: new Date(), revokedById: u.id } });
    await this.audit.log({ actor: u, action: 'course.unassign', entity: 'course_assignment', entityId: id, institutionId: a.institutionId, meta: { userId: a.userId, courseId: a.courseId }, ip });
    return { ok: true };
  }

  list(u: AuthUser, f: { userId?: string; courseId?: string; institutionId?: string; includeRevoked?: boolean }) {
    if (f.institutionId) scope.assert(u, f.institutionId);
    return this.prisma.courseAssignment.findMany({
      where: { institutionId: f.institutionId ?? scope.filter(u), userId: f.userId, courseId: f.courseId, user: { role: 'LECTURER' }, ...(f.includeRevoked ? {} : { revokedAt: null, status: 'APPROVED' }) },
      include: { user: { select: { fullName: true, email: true } }, course: { select: { code: true, title: true } }, institution: { select: { code: true } } },
      orderBy: { createdAt: 'desc' }, take: 500,
    });
  }

  mine(u: AuthUser) {
    return this.prisma.courseAssignment.findMany({
      where: { userId: u.id, revokedAt: null, status: 'APPROVED', institutionId: scope.filter(u) },
      include: { course: { select: { id: true, code: true, title: true, semester: true } }, institution: { select: { id: true, code: true } } },
    });
  }
}
