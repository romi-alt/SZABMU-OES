import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import type { Role } from '@oes/shared';
import { PrismaService } from '../../infra/prisma.service';
import { KvService } from '../../infra/kv.service';
import { AuditService } from '../audit/audit.service';
import { dropUserSessions, scope, type AuthUser } from '../../common/auth';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../common/errors';
import { assertEnrollmentAllowed, outsideSzabmuPairs } from '../../directory/rules';
import type { Prisma } from '../../generated/prisma/client';

/** Roles a campus administrator may provision, and only within their own institutions. */
const CAMPUS_ADMIN_MAY_CREATE: Role[] = ['STUDENT', 'LECTURER', 'INVIGILATOR'];
export const ATTENDANCE_THRESHOLD = 75; // policy P-06

export const tempPassword = () => `Tmp-${randomBytes(9).toString('base64url')}-9a`;

/** Institution fields the directory import writes; an administrator's edit to one of them is locked against re-import. */
const IMPORT_OWNED = ['name', 'abbreviation', 'sector', 'affiliation', 'type', 'kind', 'city', 'region', 'campusLabel', 'listingStatus'];

@Injectable()
export class OrgService {
  constructor(private readonly prisma: PrismaService, private readonly kv: KvService, private readonly audit: AuditService) {}

  // ── institutions ──
  listInstitutions(u: AuthUser) {
    return this.prisma.institution.findMany({ where: { id: scope.filter(u) }, orderBy: { name: 'asc' }, include: { _count: { select: { students: true, departments: true } } } });
  }
  async createInstitution(u: AuthUser, d: Prisma.InstitutionCreateInput, ip?: string) {
    const i = await this.prisma.institution.create({ data: d });
    await this.audit.log({ actor: u, action: 'institution.create', entity: 'institution', entityId: i.id, institutionId: i.id, meta: { code: i.code }, ip });
    return i;
  }
  /**
   * Partial update. Only fields that were sent AND differ from the stored value are written; an empty or no-op PATCH changes nothing and
   * writes no audit entry. The audit trail records the real before/after of each changed field.
   */
  async updateInstitution(u: AuthUser, id: string, d: { code?: string; name?: string; type?: string; affiliation?: string; city?: string; active?: boolean; abbreviation?: string | null; sector?: string | null; region?: string | null; campusLabel?: string | null; listingStatus?: string; operationalStatus?: string }, ip?: string) {
    const current = await this.prisma.institution.findUnique({ where: { id } });
    if (!current) throw notFound('Institution');
    const changes: Record<string, { from: unknown; to: unknown }> = {}; const data: Record<string, unknown> = {};
    for (const key of ['code', 'name', 'type', 'affiliation', 'city', 'active', 'abbreviation', 'sector', 'region', 'campusLabel', 'listingStatus', 'operationalStatus'] as const) {
      const next = d[key]; if (next === undefined) continue;
      const prev = (current as Record<string, unknown>)[key];
      if (prev !== next) { changes[key] = { from: prev, to: next }; data[key] = next; }
    }
    if (!Object.keys(changes).length) return current;
    // A field an administrator edits is locked against the directory import: a re-run reports it but never overwrites it.
    const owned = Object.keys(changes).filter((k) => IMPORT_OWNED.includes(k));           // `active` and `code` belong to the system, not to the import
    const lockedFields = [...new Set([...(Array.isArray(current.lockedFields) ? (current.lockedFields as string[]) : []), ...owned])];
    const i = await this.prisma.institution.update({ where: { id }, data: { ...(data as Prisma.InstitutionUpdateInput), ...(owned.length ? { lockedFields } : {}) } });
    await this.audit.log({ actor: u, action: 'institution.update', entity: 'institution', entityId: id, institutionId: id, meta: { changes } as never, ip });
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
  /**
   * Bulk entry of a programme's subjects from its curriculum. Nothing is invented: a supplied code and credit value are kept; a missing code gets an
   * internal reference (PROGRAMME-S<semester>-<nn>, not an official subject code) and missing credits are stored as 0 = not recorded. Rows that already
   * exist (same semester and title), repeat inside the list, or use a taken code are skipped and reported. `dryRun` writes nothing.
   */
  async bulkCreateCourses(u: AuthUser, programId: string, d: { rows: { semester: number; title: string; code?: string; credits?: number }[]; dryRun: boolean }, ip?: string) {
    const program = await this.prisma.program.findUnique({ where: { id: programId }, select: { id: true, code: true } }); if (!program) throw notFound('Programme');
    const key = (sem: number, title: string) => `${sem}|${title.trim().replace(/\s+/g, ' ').toLowerCase()}`;
    const existing = await this.prisma.course.findMany({ where: { programId }, select: { semester: true, title: true, code: true } });
    const have = new Set(existing.map((c) => key(c.semester, c.title)));
    const takenCodes = new Set((await this.prisma.course.findMany({ where: { code: { in: d.rows.map((r) => r.code).filter((c): c is string => !!c) } }, select: { code: true } })).map((c) => c.code.toLowerCase()));
    const refCount = new Map<number, number>(); for (const c of existing) if (new RegExp(`^${program.code}-S${c.semester}-\\d+$`).test(c.code)) refCount.set(c.semester, (refCount.get(c.semester) ?? 0) + 1);
    const skipped: { row: number; title: string; reason: 'ALREADY_EXISTS' | 'REPEATED_IN_LIST' | 'CODE_TAKEN' }[] = []; const plan: { semester: number; title: string; code: string; credits: number }[] = []; const seenCodes = new Set<string>();
    d.rows.forEach((r, i) => {
      const title = r.title.trim().replace(/\s+/g, ' '); const k = key(r.semester, title);
      if (have.has(k)) { skipped.push({ row: i + 1, title, reason: plan.some((p) => key(p.semester, p.title) === k) ? 'REPEATED_IN_LIST' : 'ALREADY_EXISTS' }); return; }
      const code = r.code?.trim();
      if (code && (takenCodes.has(code.toLowerCase()) || seenCodes.has(code.toLowerCase()))) { skipped.push({ row: i + 1, title, reason: 'CODE_TAKEN' }); return; }
      let assigned = code;
      if (!assigned) { let n = (refCount.get(r.semester) ?? 0) + 1; do assigned = `${program.code}-S${r.semester}-${String(n++).padStart(2, '0')}`; while (takenCodes.has(assigned.toLowerCase()) || seenCodes.has(assigned.toLowerCase())); refCount.set(r.semester, n - 1); }
      seenCodes.add(assigned.toLowerCase()); have.add(k); plan.push({ semester: r.semester, title, code: assigned, credits: r.credits ?? 0 });
    });
    if (d.dryRun) return { dryRun: true, created: 0, wouldCreate: plan.length, skipped, preview: plan };
    if (plan.length) await this.prisma.$transaction(async (tx) => {
      await tx.course.createMany({ data: plan.map((p) => ({ ...p, programId })) });
      await this.audit.append(tx, { actor: u, action: 'course.bulk_create', entity: 'program', entityId: programId, meta: { programId, count: plan.length, skipped: skipped.length } as never, ip });
    });
    return { dryRun: false, created: plan.length, wouldCreate: plan.length, skipped, preview: plan };
  }

  listCourses(programId?: string, semester?: number) {
    return this.prisma.course.findMany({ where: { programId, semester }, orderBy: [{ semester: 'asc' }, { code: 'asc' }], include: { program: { select: { code: true } } } });
  }

  // ── users ──
  async listUsers(u: AuthUser, q: { role?: Role; staffOnly?: boolean; institutionId?: string; search?: string; page: number; pageSize: number }) {
    const where: Prisma.UserWhereInput = {
      role: q.role,
      ...(q.search ? { OR: [{ fullName: { contains: q.search } }, { email: { contains: q.search.toLowerCase() } }] } : {}),
    };
    if (u.institutionIds !== null) {
      where.institutions = { some: { institutionId: q.institutionId && scope.allows(u, q.institutionId) ? q.institutionId : { in: u.institutionIds } } };
      where.role = q.role && CAMPUS_ADMIN_MAY_CREATE.includes(q.role) ? q.role : { in: q.staffOnly ? CAMPUS_ADMIN_MAY_CREATE.filter((r) => r !== 'STUDENT') : CAMPUS_ADMIN_MAY_CREATE };
    } else if (q.institutionId) where.institutions = { some: { institutionId: q.institutionId } };
    if (q.staffOnly && !q.role && u.institutionIds === null) where.role = { not: 'STUDENT' };   // additive: the account list defaults to staff; students are managed from the Students page
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
    await dropUserSessions(this.kv, id);
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
    await dropUserSessions(this.kv, id);
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
      ...(q.search ? { OR: [{ regNo: { contains: q.search } }, { user: { fullName: { contains: q.search } } }] } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.student.findMany({ where, orderBy: { regNo: 'asc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { user: { select: { fullName: true, email: true, active: true } }, program: { select: { code: true } }, institution: { select: { code: true, name: true } } } }),
      this.prisma.student.count({ where }),
    ]);
    return { items, total };
  }

  /**
   * Read-only student record for people who manage a campus (UI-034): identity, placement, enrolments with attendance, and the admission
   * decision for each examination. No marks, answers, contact address, date of birth or photograph. Scoped like the list: another
   * campus's student is "not found".
   */
  async studentRecord(u: AuthUser, id: string) {
    const s = await this.prisma.student.findFirst({
      where: { id, institutionId: scope.filter(u) },
      include: {
        user: { select: { fullName: true, email: true, active: true } }, institution: { select: { id: true, code: true, name: true } }, program: { select: { id: true, code: true, name: true } },
        enrollments: { orderBy: [{ term: 'desc' }, { createdAt: 'asc' }], include: { course: { select: { code: true, title: true, semester: true } } } },
        candidacies: { orderBy: { createdAt: 'desc' }, include: { exam: { select: { id: true, code: true, title: true, status: true, opensAt: true } } } },
      },
    });
    if (!s) throw notFound('Student');
    return {
      id: s.id, regNo: s.regNo, fullName: s.user.fullName, email: s.user.email, accountActive: s.user.active, status: s.status,
      institution: s.institution, program: s.program, semester: s.semester, batchYear: s.batchYear, shift: s.shift,
      verification: s.selfDeclared ? 'SELF_DECLARED' : 'VERIFIED', profileCompletedAt: s.profileCompletedAt, createdAt: s.createdAt,
      enrolments: s.enrollments.map((e) => ({ id: e.id, course: e.course, term: e.term, status: e.status, eligibility: e.eligibility, attendancePct: e.attendancePct, note: e.eligibilityNote })),
      exams: s.candidacies.map((c) => ({ id: c.id, exam: c.exam, admission: c.status, reason: c.statusReason })),
    };
  }

  async createStudent(u: AuthUser, d: { email: string; fullName: string; institutionId: string; programId: string; regNo: string; semester: number; batchYear: number; dateOfBirth?: string; shift?: 'MORNING' | 'EVENING' }, ip?: string) {
    scope.assert(u, d.institutionId);
    // An administrator records a student the institution already has (a register-backed, existing cohort): a stopped intake does not bar that unless a source dates the stop from this batch.
    const placement = await assertEnrollmentAllowed(this.prisma, { institutionId: d.institutionId, programId: d.programId, batchYear: d.batchYear, shift: d.shift, trusted: true });
    const pw = tempPassword();
    const s = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { email: d.email.toLowerCase(), fullName: d.fullName, role: 'STUDENT', passwordHash: await argon2.hash(pw, { type: argon2.argon2id }), mustChangePw: true, institutions: { create: [{ institutionId: d.institutionId }] } } });
      return tx.student.create({ data: { userId: user.id, institutionId: d.institutionId, programId: d.programId, regNo: d.regNo, semester: d.semester, batchYear: d.batchYear, shift: placement.shift, dateOfBirth: d.dateOfBirth ? new Date(d.dateOfBirth) : undefined } });
    });
    await this.audit.log({ actor: u, action: 'student.create', entity: 'student', entityId: s.id, institutionId: d.institutionId, ip });
    return { id: s.id, regNo: s.regNo, temporaryPassword: pw };
  }

  /** Bulk import. All-or-nothing per row batch; duplicates are reported rather than silently skipped. */
  async importStudents(u: AuthUser, institutionId: string, rows: { email: string; fullName: string; programId: string; regNo: string; semester: number; batchYear: number; shift?: 'MORNING' | 'EVENING' }[], ip?: string) {
    scope.assert(u, institutionId);
    const placements = new Map<string, Awaited<ReturnType<typeof assertEnrollmentAllowed>>>();
    for (const [i, r] of rows.entries()) {                                  // every row's pair must be an offering, checked once per distinct combination
      const k = `${r.programId}|${r.batchYear}|${r.shift ?? ''}`;
      if (!placements.has(k)) { try { placements.set(k, await assertEnrollmentAllowed(this.prisma, { institutionId, programId: r.programId, batchYear: r.batchYear, shift: r.shift, trusted: true })); } catch (e) { if (e instanceof AppError) throw new AppError(e.getStatus(), e.code, `Row ${i + 1}: ${e.message}`, e.extra); throw e; } }
    }
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
        await tx.student.create({ data: { userId: user.id, institutionId, programId: r.programId, regNo: r.regNo, semester: r.semester, batchYear: r.batchYear, shift: placements.get(`${r.programId}|${r.batchYear}|${r.shift ?? ''}`)!.shift } });
        n++;
      }
      return n;
    }, { timeout: 60_000 });
    await this.audit.log({ actor: u, action: 'student.import', entity: 'student', institutionId, meta: { count: created }, ip });
    return { created, note: 'Accounts are created with a random password; issue credentials via "Reset password" or the forgot-password flow.' };
  }

  async updateStudent(u: AuthUser, id: string, d: { semester?: number; status?: string; address?: string; guardianPhone?: string; verify?: boolean; programId?: string; batchYear?: number }, ip?: string) {
    const s = await this.prisma.student.findUnique({ where: { id } });
    if (!s || !scope.allows(u, s.institutionId)) throw notFound('Student');
    if (d.programId && !(await this.prisma.program.findUnique({ where: { id: d.programId }, select: { id: true } }))) throw badRequest('Unknown programme');
    if (d.programId && d.programId !== s.programId) await assertEnrollmentAllowed(this.prisma, { institutionId: s.institutionId, programId: d.programId, batchYear: d.batchYear ?? s.batchYear, shift: s.shift, trusted: true });   // moving to another programme is a new placement
    const { verify, ...rest } = d;
    await this.prisma.student.update({ where: { id }, data: { ...rest, ...(verify ? { selfDeclared: false } : {}) } });
    await this.audit.log({ actor: u, action: verify ? 'student.verified' : 'student.update', entity: 'student', entityId: id, institutionId: s.institutionId, meta: { ...d, from: { programId: s.programId, semester: s.semester, batchYear: s.batchYear, selfDeclared: s.selfDeclared } } as never, ip });
    return { ok: true };
  }

  // ── enrolment & eligibility ──
  async enrol(u: AuthUser, d: { courseId: string; term: string; institutionId: string; studentIds?: string[] }, ip?: string) {
    scope.assert(u, d.institutionId);
    const course = await this.prisma.course.findUnique({ where: { id: d.courseId } });
    if (!course) throw notFound('Course');
    // Students whose offering is awarded by someone other than SZABMU are outside SZABMU cohorts and examinations.
    if ((await outsideSzabmuPairs(this.prisma)).has(`${d.institutionId}|${course.programId}`)) return { eligibleCohort: 0, newlyEnrolled: 0 };
    const students = await this.prisma.student.findMany({
      where: { institutionId: d.institutionId, programId: course.programId, semester: course.semester, ...(d.studentIds ? { id: { in: d.studentIds } } : {}), status: 'ACTIVE', selfDeclared: false },   // students who chose their own placement are enrolled only after an administrator verifies them
      select: { id: true },
    });
    const r = await this.prisma.enrollment.createMany({ data: students.map((s) => ({ studentId: s.id, courseId: d.courseId, term: d.term })), skipDuplicates: true });
    await this.audit.log({ actor: u, action: 'enrollment.bulk', entity: 'course', entityId: d.courseId, institutionId: d.institutionId, meta: { term: d.term, enrolled: r.count }, ip });
    return { eligibleCohort: students.length, newlyEnrolled: r.count };
  }

  /**
   * Terms already in use for a course (from its examinations and from enrolments in the caller's scope), so staff choose an existing term
   * instead of typing one (a typo silently creates an unrelated term — audit A-11). Counts are scoped like the enrolment list.
   */
  async courseTerms(u: AuthUser, courseId: string) {
    const [exams, enr] = await Promise.all([
      this.prisma.exam.groupBy({ by: ['term'], where: { courseId }, _count: { _all: true } }),
      this.prisma.enrollment.groupBy({ by: ['term'], where: { courseId, student: { institutionId: scope.filter(u) } }, _count: { _all: true } }),
    ]);
    const terms = new Map<string, { term: string; exams: number; enrolled: number }>();
    for (const e of exams) terms.set(e.term, { term: e.term, exams: e._count._all, enrolled: 0 });
    for (const e of enr) terms.set(e.term, { ...(terms.get(e.term) ?? { term: e.term, exams: 0 }), enrolled: e._count._all });
    return [...terms.values()].sort((a, b) => b.term.localeCompare(a.term));
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
