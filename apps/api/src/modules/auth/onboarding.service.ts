import { Inject, Injectable } from '@nestjs/common';
import { isValidPhone, PHONE_HINT, LINKS } from '@oes/shared';
import { PrismaService } from '../../infra/prisma.service';
import { KvService } from '../../infra/kv.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { dropUserSessions, type AuthUser } from '../../common/auth';
import { AppError, badRequest, conflict } from '../../common/errors';
import { decodePhoto } from '../teachers/teacher-registration.service';
import { CONFIG, type Config } from '../../config';
import { assertEnrollmentAllowed, assertNotHiddenDemo, selectableWhere } from '../../directory/rules';

export interface ProfileInput { fullName: string; fatherName: string; gender: 'MALE' | 'FEMALE' | 'OTHER'; institutionId: string; programId: string; semester: number; batchYear: number; mobile: string; dateOfBirth?: string; photo?: string; shift?: string }

/**
 * One-time student profile. The Student record (institution, programme, semester) is created here, from the student's own choices, and flagged `selfDeclared`:
 * such a student is excluded from enrolment, rosters and admission until an administrator verifies the placement. Completing the profile therefore never
 * makes anyone eligible for an examination. After completion the academic fields cannot be changed by the student (they ask an administrator).
 */
@Injectable()
export class OnboardingService {
  constructor(private readonly prisma: PrismaService, private readonly kv: KvService, private readonly audit: AuditService, private readonly notifications: NotificationsService, @Inject(CONFIG) private readonly cfg: Config) {}

  /**
   * Options for the dependent dropdowns, from the institution directory: every selectable institution with the programmes it offers (a pair appears only
   * if it is an offering that is not delisted and is awarded by SZABMU), which of those are stopped for NEW students, and where an offering has separate
   * morning/evening allocations. Demo institutions appear only where DEMO_INSTITUTIONS_VISIBLE is set. A stopped programme is listed (existing cohort
   * members choose it) and the server decides at submission.
   */
  async catalog() {
    const demo = this.cfg.DEMO_INSTITUTIONS_VISIBLE === 'true';
    const [offerings, courses, years] = await Promise.all([
      this.prisma.institutionProgramOffering.findMany({ where: selectableWhere(demo), include: { institution: { select: { id: true, code: true, name: true, sector: true, city: true, region: true } }, program: { select: { id: true, code: true, name: true, durationYrs: true, durationMonths: true } }, allocations: { select: { shift: true } } } }),
      this.prisma.course.findMany({ where: demo ? {} : { isDemo: false }, select: { programId: true, semester: true } }),
      this.prisma.$queryRaw<{ y: number }[]>`SELECT "batchYear" AS y FROM students WHERE "selfDeclared" = false UNION SELECT "batchYear" FROM roster_entries`,
    ]);
    const institutions = new Map<string, (typeof offerings)[number]['institution']>(); const programs = new Map<string, { id: string; code: string; name: string; durationYrs: number; durationMonths: number | null }>();
    const programsByInstitution: Record<string, string[]> = {}; const stoppedByInstitution: Record<string, string[]> = {}; const shiftsByOffering: Record<string, string[]> = {};
    for (const o of offerings) {
      institutions.set(o.institutionId, o.institution); programs.set(o.programId, o.program);
      (programsByInstitution[o.institutionId] ??= []).push(o.programId);
      if (o.intakeStatus === 'STOPPED') (stoppedByInstitution[o.institutionId] ??= []).push(o.programId);
      const shifts = o.allocations.map((a) => a.shift).filter((x) => x !== 'UNSPECIFIED').sort((a, b) => (a === 'MORNING' ? -1 : b === 'MORNING' ? 1 : 0));
      if (shifts.length > 1) shiftsByOffering[`${o.institutionId}|${o.programId}`] = shifts;
    }
    const now = new Date().getFullYear(); const ys = new Set<number>(years.map((r) => Number(r.y))); for (let y = now - 6; y <= now; y++) ys.add(y);
    const semesters: Record<string, number[]> = {};
    for (const p of programs.values()) {
      const s = [...new Set(courses.filter((c) => c.programId === p.id).map((c) => c.semester))].sort((a, b) => a - b);
      // No curriculum entered: the student still states which semester they are in; the list follows the published duration, or 1-12 when no duration is established.
      semesters[p.id] = s.length ? s : Array.from({ length: Math.min(12, p.durationMonths ? Math.ceil(p.durationMonths / 6) : 12) }, (_, i) => i + 1);
    }
    return {
      institutions: [...institutions.values()].sort((a, b) => a.name.localeCompare(b.name)), programs: [...programs.values()].map((p) => ({ id: p.id, code: p.code, name: p.name })).sort((a, b) => a.name.localeCompare(b.name)),
      programsByInstitution, stoppedByInstitution, shiftsByOffering, semestersByProgram: semesters, batchYears: [...ys].filter((y) => y <= now + 1).sort((a, b) => b - a),
    };
  }

  async complete(u: AuthUser, d: ProfileInput, ip?: string) {
    if (!isValidPhone(d.mobile)) throw badRequest(PHONE_HINT);
    const photo = d.photo ? decodePhoto(d.photo) : undefined;
    const cat = await this.catalog();
    if (!cat.semestersByProgram[d.programId]?.includes(d.semester)) throw badRequest('Choose a semester that belongs to the selected programme.');
    if (!cat.batchYears.includes(d.batchYear)) throw badRequest('Choose a valid academic year.');
    if (d.dateOfBirth) { const t = new Date(d.dateOfBirth); if (Number.isNaN(t.getTime()) || t.getFullYear() < 1940 || t > new Date(Date.now() - 10 * 365 * 86400000)) throw badRequest('Enter a valid date of birth.'); }
    // A student on the institution's official register is an existing cohort member, not a new applicant (see assertEnrollmentAllowed).
    const regNo = (await this.prisma.studentSignup.findUnique({ where: { userId: u.id }, select: { regNo: true } }))?.regNo;
    const trusted = !!regNo && !!(await this.prisma.rosterEntry.findFirst({ where: { regNo, institutionId: d.institutionId, programId: d.programId }, select: { id: true } }));
    await assertNotHiddenDemo(this.prisma, d.institutionId, this.cfg.DEMO_INSTITUTIONS_VISIBLE === 'true');
    const placement = await assertEnrollmentAllowed(this.prisma, { institutionId: d.institutionId, programId: d.programId, batchYear: d.batchYear, shift: d.shift, trusted });
    await this.prisma.$transaction(async (tx) => {
      const signup = await tx.studentSignup.findUnique({ where: { userId: u.id } });
      if (!signup) throw new AppError(403, 'NO_SIGNUP', 'This account is not a pending student sign-up.');
      if (signup.completedAt || (await tx.student.findUnique({ where: { userId: u.id }, select: { id: true } }))) throw conflict('PROFILE_ALREADY_COMPLETE', 'Your profile is already complete. To change academic details, contact your campus examination office.');
      const now = new Date();
      await tx.user.update({ where: { id: u.id }, data: { fullName: d.fullName.trim(), phone: d.mobile.trim() } });
      await tx.student.create({ data: { userId: u.id, institutionId: d.institutionId, programId: d.programId, regNo: signup.regNo, semester: d.semester, batchYear: d.batchYear,
        dateOfBirth: d.dateOfBirth ? new Date(d.dateOfBirth) : null, fatherName: d.fatherName.trim(), gender: d.gender, photo: photo ? Buffer.from(photo.b64, 'base64') : undefined, photoMime: photo?.mime, profileCompletedAt: now, selfDeclared: true, shift: placement.shift } });
      await tx.userInstitution.create({ data: { userId: u.id, institutionId: d.institutionId } });
      await tx.studentSignup.update({ where: { userId: u.id }, data: { completedAt: now } });
      await this.audit.append(tx, { actor: u, action: 'student.profile_completed', entity: 'student', entityId: u.id, institutionId: d.institutionId, meta: { regNo: signup.regNo, programId: d.programId, semester: d.semester, selfDeclared: true }, ip });
    });
    await dropUserSessions(this.kv, u.id);                       // the cached session must pick up the new student id and campus scope
    const admins = await this.prisma.user.findMany({ where: { active: true, OR: [{ role: 'SUPER_ADMIN' }, { role: 'CAMPUS_ADMIN', institutions: { some: { institutionId: d.institutionId } } }] }, select: { id: true } });
    await this.notifications.notify(admins.map((a) => a.id), 'New student awaiting verification', `${d.fullName.trim()}  completed the student profile. Verify the academic details before enrolment.`, LINKS.students).catch(() => undefined);
    return { ok: true };
  }

  /** The student cannot edit academic identity; this tells the administrators what they want changed, which is recorded and audited. */
  async requestChange(u: AuthUser, note: string, ip?: string) {
    const s = await this.prisma.student.findUnique({ where: { userId: u.id }, select: { id: true, institutionId: true, regNo: true } });
    if (!s) throw new AppError(403, 'PROFILE_INCOMPLETE', 'Complete your profile first.');
    if ((await this.kv.hit(`rl:chg:${u.id}`, 3600)) > 5) throw new AppError(429, 'RATE_LIMITED', 'Too many requests. Try again later.');
    const admins = await this.prisma.user.findMany({ where: { active: true, OR: [{ role: 'SUPER_ADMIN' }, { role: 'CAMPUS_ADMIN', institutions: { some: { institutionId: s.institutionId } } }] }, select: { id: true } });
    await this.notifications.notify(admins.map((a) => a.id), 'Student requests an academic change', `${s.regNo}: ${note.trim().slice(0, 400)}`, LINKS.students);
    await this.audit.log({ actor: u, action: 'student.change_requested', entity: 'student', entityId: s.id, institutionId: s.institutionId, meta: { note: note.trim().slice(0, 400) }, ip });
    return { ok: true };
  }
}
