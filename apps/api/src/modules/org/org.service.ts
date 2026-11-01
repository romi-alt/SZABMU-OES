import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import type { Role } from '@oes/shared';
import { PrismaService } from '../../infra/prisma.service';
import { RedisService } from '../../infra/redis.service';
import { AuditService } from '../audit/audit.service';
import { dropUserSessions, scope, type AuthUser } from '../../common/auth';
import { badRequest, conflict, forbidden, notFound } from '../../common/errors';
import type { Prisma } from '../../generated/prisma/client';

/** Roles a campus administrator may provision, and only within their own institutions. */
const CAMPUS_ADMIN_MAY_CREATE: Role[] = ['STUDENT', 'LECTURER', 'INVIGILATOR'];
export const ATTENDANCE_THRESHOLD = 75; // policy P-06

export const tempPassword = () => `Tmp-${randomBytes(9).toString('base64url')}-9a`;

@Injectable()
export class OrgService {
  constructor(private readonly prisma: PrismaService, private readonly redis: RedisService, private readonly audit: AuditService) {}

  // ── institutions ──
  listInstitutions(u: AuthUser) {
    return this.prisma.institution.findMany({ where: { id: scope.filter(u) }, orderBy: { name: 'asc' }, include: { _count: { select: { students: true, departments: true } } } });
  }
  async createInstitution(u: AuthUser, d: Prisma.InstitutionCreateInput, ip?: string) {
    const i = await this.prisma.institution.create({ data: d });
    await this.audit.log({ actor: u, action: 'institution.create', entity: 'institution', entityId: i.id, institutionId: i.id, meta: { code: i.code }, ip });
    return i;
  }
  async updateInstitution(u: AuthUser, id: string, d: Prisma.InstitutionUpdateInput, ip?: string) {
    const i = await this.prisma.institution.update({ where: { id }, data: d });
    await this.audit.log({ actor: u, action: 'institution.update', entity: 'institution', entityId: id, institutionId: id, meta: d as never, ip });
    return i;
  }
  listDepartments(u: AuthUser, institutionId: string) {
    scope.assert(u, institutionId);
    return this.prisma.department.findMany({ where: { institutionId }, orderBy: { name: 'asc' } });
  }
  async createDepartment(u: AuthUser, institutionId: string, d: { code: string; name: string }, ip?: string) {
    scope.assert(u, institutionId);
    const dep = await this.prisma.department.create({ data: { ...d, institutionId } });
    await this.audit.log({ actor: u, action: 'department.create', entity: 'department', entityId: dep.id, institutionId, ip });
    return dep;
  }

  // ── programs & courses ──
  listPrograms() {
    return this.prisma.program.findMany({ orderBy: { code: 'asc' }, include: { courses: { orderBy: [{ semester: 'asc' }, { code: 'asc' }] } } });
  }
  async createProgram(u: AuthUser, d: { code: string; name: string; durationYrs: number; level?: string }, ip?: string) {
    const p = await this.prisma.program.create({ data: d });
    await this.audit.log({ actor: u, action: 'program.create', entity: 'program', entityId: p.id, ip });
    return p;
  }
  async createCourse(u: AuthUser, programId: string, d: { code: string; title: string; semester: number; credits?: number }, ip?: string) {
    const c = await this.prisma.course.create({ data: { ...d, programId } });
    await this.audit.log({ actor: u, action: 'course.create', entity: 'course', entityId: c.id, ip });
    return c;
  }
  listCourses(programId?: string, semester?: number) {
    return this.prisma.course.findMany({ where: { programId, semester }, orderBy: [{ semester: 'asc' }, { code: 'asc' }], include: { program: { select: { code: true } } } });
  }

  // ── users ──
  async listUsers(u: AuthUser, q: { role?: Role; institutionId?: string; search?: string; page: number; pageSize: number }) {
    const where: Prisma.UserWhereInput = {
      role: q.role,
      ...(q.search ? { OR: [{ fullName: { contains: q.search, mode: 'insensitive' } }, { email: { contains: q.search.toLowerCase() } }] } : {}),
    };
    if (u.institutionIds !== null) {
      where.institutions = { some: { institutionId: q.institutionId && scope.allows(u, q.institutionId) ? q.institutionId : { in: u.institutionIds } } };
      where.role = q.role && CAMPUS_ADMIN_MAY_CREATE.includes(q.role) ? q.role : { in: CAMPUS_ADMIN_MAY_CREATE };
    } else if (q.institutionId) where.institutions = { some: { institutionId: q.institutionId } };
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({ where, orderBy: { fullName: 'asc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, select: { id: true, email: true, fullName: true, role: true, active: true, lastLoginAt: true, institutions: { select: { institution: { select: { id: true, code: true, name: true } } } } } }),
      this.prisma.user.count({ where }),
    ]);
    return { items: items.map((x) => ({ ...x, institutions: x.institutions.map((i) => i.institution) })), total };
  }

  async createUser(u: AuthUser, d: { email: string; fullName: string; role: Role; institutionIds: string[]; phone?: string }, ip?: string) {
    this.assertMayProvision(u, d.role, d.institutionIds);
    const pw = tempPassword();
    const user = await this.prisma.user.create({
      data: { email: d.email.toLowerCase(), fullName: d.fullName, role: d.role, phone: d.phone, passwordHash: await argon2.hash(pw, { type: argon2.argon2id }), mustChangePw: true, institutions: { create: d.institutionIds.map((institutionId) => ({ institutionId })) } },
    });
    await this.audit.log({ actor: u, action: 'user.create', entity: 'user', entityId: user.id, institutionId: d.institutionIds[0], meta: { role: d.role }, ip });
    return { id: user.id, email: user.email, role: user.role, temporaryPassword: pw };
  }

  private assertMayProvision(u: AuthUser, role: Role, institutionIds: string[]) {
    if (u.role === 'SUPER_ADMIN') return;
    if (u.role !== 'CAMPUS_ADMIN') throw forbidden();
    if (!CAMPUS_ADMIN_MAY_CREATE.includes(role)) throw forbidden('Campus administrators may only provision students, lecturers and invigilators');
    if (!institutionIds.length || !institutionIds.every((i) => scope.allows(u, i))) throw forbidden('You may only assign users to your own institutions');
  }

  async updateUser(u: AuthUser, id: string, d: { active?: boolean; institutionIds?: string[]; fullName?: string }, ip?: string) {
    const target = await this.prisma.user.findUnique({ where: { id }, include: { institutions: true } });
    if (!target) throw notFound('User');
    if (u.role !== 'SUPER_ADMIN') {
      if (!CAMPUS_ADMIN_MAY_CREATE.includes(target.role) || !target.institutions.some((i) => scope.allows(u, i.institutionId))) throw notFound('User');
      if (d.institutionIds && !d.institutionIds.every((i) => scope.allows(u, i))) throw forbidden();
    }
    if (target.id === u.id && d.active === false) throw badRequest('You cannot deactivate your own account');
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { active: d.active, fullName: d.fullName } });
      if (d.institutionIds) {
        await tx.userInstitution.deleteMany({ where: { userId: id } });
        await tx.userInstitution.createMany({ data: d.institutionIds.map((institutionId) => ({ userId: id, institutionId })) });
      }
      if (d.active === false) await tx.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    });
    await dropUserSessions(this.redis, id);
    await this.audit.log({ actor: u, action: 'user.update', entity: 'user', entityId: id, meta: d as never, ip });
    return { ok: true };
  }

  async resetUserPassword(u: AuthUser, id: string, ip?: string) {
    const target = await this.prisma.user.findUnique({ where: { id }, include: { institutions: true } });
    if (!target) throw notFound('User');
    if (u.role !== 'SUPER_ADMIN' && (!CAMPUS_ADMIN_MAY_CREATE.includes(target.role) || !target.institutions.some((i) => scope.allows(u, i.institutionId)))) throw notFound('User');
    const pw = tempPassword();
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id }, data: { passwordHash: await argon2.hash(pw, { type: argon2.argon2id }), mustChangePw: true, failedLogins: 0, lockedUntil: null } }),
      this.prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await dropUserSessions(this.redis, id);
    await this.audit.log({ actor: u, action: 'user.password_reset_by_admin', entity: 'user', entityId: id, ip });
    return { temporaryPassword: pw };
  }

  // ── students ──
  async listStudents(u: AuthUser, q: { institutionId?: string; programId?: string; semester?: number; search?: string; page: number; pageSize: number }) {
    if (q.institutionId) scope.assert(u, q.institutionId);
    const where: Prisma.StudentWhereInput = {
      institutionId: q.institutionId ?? scope.filter(u),
      programId: q.programId,
      semester: q.semester,
      ...(q.search ? { OR: [{ regNo: { contains: q.search, mode: 'insensitive' } }, { user: { fullName: { contains: q.search, mode: 'insensitive' } } }] } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.student.findMany({ where, orderBy: { regNo: 'asc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { user: { select: { fullName: true, email: true, active: true } }, program: { select: { code: true } }, institution: { select: { code: true, name: true } } } }),
      this.prisma.student.count({ where }),
    ]);
    return { items, total };
  }

  async createStudent(u: AuthUser, d: { email: string; fullName: string; institutionId: string; programId: string; regNo: string; semester: number; batchYear: number; dateOfBirth?: string }, ip?: string) {
    scope.assert(u, d.institutionId);
    const pw = tempPassword();
    const s = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { email: d.email.toLowerCase(), fullName: d.fullName, role: 'STUDENT', passwordHash: await argon2.hash(pw, { type: argon2.argon2id }), mustChangePw: true, institutions: { create: [{ institutionId: d.institutionId }] } } });
      return tx.student.create({ data: { userId: user.id, institutionId: d.institutionId, programId: d.programId, regNo: d.regNo, semester: d.semester, batchYear: d.batchYear, dateOfBirth: d.dateOfBirth ? new Date(d.dateOfBirth) : undefined } });
    });
    await this.audit.log({ actor: u, action: 'student.create', entity: 'student', entityId: s.id, institutionId: d.institutionId, ip });
    return { id: s.id, regNo: s.regNo, temporaryPassword: pw };
  }

  /** Bulk import. All-or-nothing per row batch; duplicates are reported rather than silently skipped. */
  async importStudents(u: AuthUser, institutionId: string, rows: { email: string; fullName: string; programId: string; regNo: string; semester: number; batchYear: number }[], ip?: string) {
    scope.assert(u, institutionId);
    const emails = rows.map((r) => r.email.toLowerCase());
    const regs = rows.map((r) => r.regNo);
    if (new Set(emails).size !== emails.length || new Set(regs).size !== regs.length) throw badRequest('Duplicate email or registration number within the import file');
    const existing = await this.prisma.user.findMany({ where: { email: { in: emails } }, select: { email: true } });
    const existingReg = await this.prisma.student.findMany({ where: { regNo: { in: regs } }, select: { regNo: true } });
    if (existing.length || existingReg.length) throw conflict('IMPORT_DUPLICATES', 'Some records already exist', { emails: existing.map((e) => e.email), regNos: existingReg.map((r) => r.regNo) });
    const hash = await argon2.hash(tempPassword(), { type: argon2.argon2id });
    const created = await this.prisma.$transaction(async (tx) => {
      let n = 0;
      for (const r of rows) {
        const user = await tx.user.create({ data: { email: r.email.toLowerCase(), fullName: r.fullName, role: 'STUDENT', passwordHash: hash, mustChangePw: true, institutions: { create: [{ institutionId }] } } });
        await tx.student.create({ data: { userId: user.id, institutionId, programId: r.programId, regNo: r.regNo, semester: r.semester, batchYear: r.batchYear } });
        n++;
      }
      return n;
    }, { timeout: 60_000 });
    await this.audit.log({ actor: u, action: 'student.import', entity: 'student', institutionId, meta: { count: created }, ip });
    return { created, note: 'Accounts are created with a random password; issue credentials via "Reset password" or the forgot-password flow.' };
  }

  async updateStudent(u: AuthUser, id: string, d: { semester?: number; status?: string; address?: string; guardianPhone?: string }, ip?: string) {
    const s = await this.prisma.student.findUnique({ where: { id } });
    if (!s || !scope.allows(u, s.institutionId)) throw notFound('Student');
    await this.prisma.student.update({ where: { id }, data: d });
    await this.audit.log({ actor: u, action: 'student.update', entity: 'student', entityId: id, institutionId: s.institutionId, meta: d as never, ip });
    return { ok: true };
  }

  // ── enrolment & eligibility ──
  async enrol(u: AuthUser, d: { courseId: string; term: string; institutionId: string; studentIds?: string[] }, ip?: string) {
    scope.assert(u, d.institutionId);
    const course = await this.prisma.course.findUnique({ where: { id: d.courseId } });
    if (!course) throw notFound('Course');
    const students = await this.prisma.student.findMany({
      where: { institutionId: d.institutionId, programId: course.programId, semester: course.semester, ...(d.studentIds ? { id: { in: d.studentIds } } : {}), status: 'ACTIVE' },
      select: { id: true },
    });
    const r = await this.prisma.enrollment.createMany({ data: students.map((s) => ({ studentId: s.id, courseId: d.courseId, term: d.term })), skipDuplicates: true });
    await this.audit.log({ actor: u, action: 'enrollment.bulk', entity: 'course', entityId: d.courseId, institutionId: d.institutionId, meta: { term: d.term, enrolled: r.count }, ip });
    return { eligibleCohort: students.length, newlyEnrolled: r.count };
  }

  listEnrollments(u: AuthUser, q: { courseId: string; term: string; institutionId?: string }) {
    if (q.institutionId) scope.assert(u, q.institutionId);
    return this.prisma.enrollment.findMany({
      where: { courseId: q.courseId, term: q.term, student: { institutionId: q.institutionId ?? scope.filter(u) } },
      include: { student: { select: { id: true, regNo: true, user: { select: { fullName: true } } } } },
      orderBy: { student: { regNo: 'asc' } },
    });
  }

  /** Attendance-based eligibility (P-06). Campus admins record attendance; CCE alone may condone. */
  async setAttendance(u: AuthUser, enrollmentId: string, attendancePct: number, ip?: string) {
    const e = await this.prisma.enrollment.findUnique({ where: { id: enrollmentId }, include: { student: true } });
    if (!e || !scope.allows(u, e.student.institutionId)) throw notFound('Enrollment');
    const eligibility = e.eligibility === 'CONDONED' ? 'CONDONED' : attendancePct >= ATTENDANCE_THRESHOLD ? 'ELIGIBLE' : 'INELIGIBLE';
    await this.prisma.enrollment.update({ where: { id: enrollmentId }, data: { attendancePct, eligibility, decidedBy: u.id } });
    await this.audit.log({ actor: u, action: 'eligibility.attendance', entity: 'enrollment', entityId: enrollmentId, institutionId: e.student.institutionId, meta: { attendancePct, eligibility }, ip });
    return { eligibility };
  }

  async condone(u: AuthUser, enrollmentId: string, note: string, ip?: string) {
    const e = await this.prisma.enrollment.findUnique({ where: { id: enrollmentId }, include: { student: true } });
    if (!e) throw notFound('Enrollment');
    await this.prisma.enrollment.update({ where: { id: enrollmentId }, data: { eligibility: 'CONDONED', eligibilityNote: note, decidedBy: u.id } });
    await this.audit.log({ actor: u, action: 'eligibility.condone', entity: 'enrollment', entityId: enrollmentId, institutionId: e.student.institutionId, meta: { note }, ip });
    return { eligibility: 'CONDONED' };
  }
}
