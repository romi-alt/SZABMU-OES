import { Injectable } from '@nestjs/common';
import { isValidPhone, PHONE_HINT, LINKS } from '@oes/shared';
import { PrismaService } from '../../infra/prisma.service';
import { KvService } from '../../infra/kv.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { dropUserSessions, type AuthUser } from '../../common/auth';
import { AppError, badRequest, conflict } from '../../common/errors';
import { decodePhoto } from '../teachers/teacher-registration.service';

export interface ProfileInput { fullName: string; fatherName: string; gender: 'MALE' | 'FEMALE' | 'OTHER'; institutionId: string; programId: string; semester: number; batchYear: number; mobile: string; dateOfBirth?: string; photo?: string }

/**
 * One-time student profile. The Student record (institution, programme, semester) is created here, from the student's own choices, and flagged `selfDeclared`:
 * such a student is excluded from enrolment, rosters and admission until an administrator verifies the placement. Completing the profile therefore never
 * makes anyone eligible for an examination. After completion the academic fields cannot be changed by the student (they ask an administrator).
 */
@Injectable()
export class OnboardingService {
  constructor(private readonly prisma: PrismaService, private readonly kv: KvService, private readonly audit: AuditService, private readonly notifications: NotificationsService) {}

  /** Options for the dependent dropdowns, taken from existing records. Programmes per institution come from students and the official register; an institution with no record yet offers every programme. */
  async catalog() {
    const [institutions, programs, courses, pairs, years] = await Promise.all([
      this.prisma.institution.findMany({ where: { active: true }, select: { id: true, code: true, name: true }, orderBy: { name: 'asc' } }),
      this.prisma.program.findMany({ where: { active: true }, select: { id: true, code: true, name: true, durationYrs: true }, orderBy: { name: 'asc' } }),
      this.prisma.course.findMany({ select: { programId: true, semester: true } }),
      this.prisma.$queryRaw<{ institutionId: string; programId: string }[]>`SELECT "institutionId", "programId" FROM students WHERE "selfDeclared" = false UNION SELECT "institutionId", "programId" FROM roster_entries`,
      this.prisma.$queryRaw<{ y: number }[]>`SELECT "batchYear" AS y FROM students WHERE "selfDeclared" = false UNION SELECT "batchYear" FROM roster_entries`,
    ]);
    const byInstitution: Record<string, string[]> = {};
    for (const p of pairs) (byInstitution[p.institutionId] ??= []).push(p.programId);
    const now = new Date().getFullYear(); const ys = new Set<number>(years.map((r) => Number(r.y))); for (let y = now - 6; y <= now; y++) ys.add(y);
    const semesters: Record<string, number[]> = {};
    for (const p of programs) { const s = [...new Set(courses.filter((c) => c.programId === p.id).map((c) => c.semester))].sort((a, b) => a - b); semesters[p.id] = s.length ? s : Array.from({ length: Math.min(12, p.durationYrs * 2) }, (_, i) => i + 1); }
    return { institutions, programs: programs.map((p) => ({ id: p.id, code: p.code, name: p.name })), programsByInstitution: byInstitution, semestersByProgram: semesters, batchYears: [...ys].filter((y) => y <= now + 1).sort((a, b) => b - a) };
  }

  async complete(u: AuthUser, d: ProfileInput, ip?: string) {
    if (!isValidPhone(d.mobile)) throw badRequest(PHONE_HINT);
    const photo = d.photo ? decodePhoto(d.photo) : undefined;
    const cat = await this.catalog();
    if (!cat.institutions.some((i) => i.id === d.institutionId)) throw badRequest('Choose your college from the list.');
    if (!cat.programs.some((p) => p.id === d.programId)) throw badRequest('Choose your degree programme from the list.');
    const allowed = cat.programsByInstitution[d.institutionId];
    if (allowed?.length && !allowed.includes(d.programId)) throw badRequest('That programme is not offered at the selected college.');
    if (!cat.semestersByProgram[d.programId]?.includes(d.semester)) throw badRequest('Choose a semester that belongs to the selected programme.');
    if (!cat.batchYears.includes(d.batchYear)) throw badRequest('Choose a valid academic year.');
    if (d.dateOfBirth) { const t = new Date(d.dateOfBirth); if (Number.isNaN(t.getTime()) || t.getFullYear() < 1940 || t > new Date(Date.now() - 10 * 365 * 86400000)) throw badRequest('Enter a valid date of birth.'); }
    await this.prisma.$transaction(async (tx) => {
      const signup = await tx.studentSignup.findUnique({ where: { userId: u.id } });
      if (!signup) throw new AppError(403, 'NO_SIGNUP', 'This account is not a pending student sign-up.');
      if (signup.completedAt || (await tx.student.findUnique({ where: { userId: u.id }, select: { id: true } }))) throw conflict('PROFILE_ALREADY_COMPLETE', 'Your profile is already complete. To change academic details, contact your campus examination office.');
      const now = new Date();
      await tx.user.update({ where: { id: u.id }, data: { fullName: d.fullName.trim(), phone: d.mobile.trim() } });
      await tx.student.create({ data: { userId: u.id, institutionId: d.institutionId, programId: d.programId, regNo: signup.regNo, semester: d.semester, batchYear: d.batchYear,
        dateOfBirth: d.dateOfBirth ? new Date(d.dateOfBirth) : null, fatherName: d.fatherName.trim(), gender: d.gender, photo: photo ? Buffer.from(photo.b64, 'base64') : undefined, photoMime: photo?.mime, profileCompletedAt: now, selfDeclared: true } });
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
