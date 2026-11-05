import { Inject, Injectable } from '@nestjs/common';
import argon2 from 'argon2';
import { randomInt } from 'node:crypto';
import { checkPassword, isValidPhone, PHONE_HINT, LINKS } from '@oes/shared';
import { PrismaService } from '../../infra/prisma.service';
import { KvService } from '../../infra/kv.service';
import { MailService } from '../../infra/mail.service';
import { AppError, badRequest, conflict } from '../../common/errors';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { sha256 } from '../../common/auth';
import { CONFIG, type Config } from '../../config';

const TTL_SEC = 30 * 60;
const MAX_ATTEMPTS = 5;
export const MAX_PHOTO_BYTES = 200_000;
export const MAX_REQUESTED = 30;
const GENERIC = 'If this email can be registered, a 6-digit code has been sent to it. Enter the code to confirm your email and submit your registration for approval.';

export interface RequestedAssignment { institutionId: string; programId: string; semester: number; term: string; courseId: string }
export interface TeacherRegistration {
  fullName: string; email: string; password: string; employeeId: string; department: string; designation: string; phone: string;
  photo?: string; assignments: RequestedAssignment[];
}
interface Pending { fullName: string; passwordHash: string; employeeId: string; department: string; designation: string; phone: string; photo?: { mime: string; b64: string }; assignments: RequestedAssignment[]; codeHash: string; attempts: number }

/** Decodes a `data:image/…;base64,…` URL and checks type, size and magic bytes. Anything else is refused (the photo is optional). */
export function decodePhoto(dataUrl: string): { mime: string; b64: string } {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw badRequest('The photo must be a JPEG, PNG or WebP image.');
  const buf = Buffer.from(m[2]!, 'base64');
  if (buf.length > MAX_PHOTO_BYTES) throw badRequest('The photo is too large. Choose a smaller image (under 200 KB).');
  const ok = (m[1] === 'image/jpeg' && buf[0] === 0xff && buf[1] === 0xd8) || (m[1] === 'image/png' && buf.subarray(1, 4).toString() === 'PNG') || (m[1] === 'image/webp' && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP');
  if (!ok) throw badRequest('The photo file is not a valid image.');
  return { mime: m[1]!, b64: m[2]! };
}

/**
 * Teacher self-registration. Nothing here grants access:
 *  - the account is created only after the emailed 6-digit code proves control of the address;
 *  - the profile starts PENDING and every selected class/subject becomes a PENDING request that an administrator decides one by one;
 *  - account, profile and requested assignments are written in ONE transaction, together with the audit entry.
 * The academic options come from the real database (institutions, programmes, courses, academic sessions with enrolments).
 */
@Injectable()
export class TeacherRegistrationService {
  constructor(private readonly prisma: PrismaService, private readonly kv: KvService, private readonly mail: MailService, private readonly audit: AuditService,
    private readonly notifications: NotificationsService, @Inject(CONFIG) private readonly cfg: Config) {}

  /** Public, read-only options for step 2. Names and codes of academic structure only — no people, no counts. */
  async catalog() {
    const [institutions, programs, courses, tuples, examTerms] = await Promise.all([
      this.prisma.institution.findMany({ where: { active: true }, select: { id: true, code: true, name: true }, orderBy: { name: 'asc' } }),
      this.prisma.program.findMany({ where: { active: true }, select: { id: true, code: true, name: true }, orderBy: { name: 'asc' } }),
      this.prisma.course.findMany({ select: { id: true, programId: true, code: true, title: true, semester: true }, orderBy: [{ semester: 'asc' }, { title: 'asc' }] }),
      this.prisma.$queryRaw<{ term: string; institutionId: string; programId: string; semester: number }[]>`
        SELECT DISTINCT e."term", s."institutionId", s."programId", c."semester"
        FROM enrollments e JOIN students s ON s."id" = e."studentId" JOIN courses c ON c."id" = e."courseId"`,
      this.prisma.exam.findMany({ distinct: ['term'], select: { term: true } }),
    ]);
    const terms = [...new Set([...tuples.map((t) => t.term), ...examTerms.map((t) => t.term)])].sort().reverse();
    return { institutions, programs, courses, terms, termsByClass: tuples };
  }

  /** Public catalog, rate-limited per address (it is unauthenticated). */
  async catalogFor(ip: string) {
    if ((await this.kv.hit(`rl:treg:cat:${ip}`, 600)) > 60) throw new AppError(429, 'RATE_LIMITED', 'Too many requests. Try again in a few minutes.');
    return this.catalog();
  }

  /** The set of values a request may use, built from the database (never trusted from the client). */
  private async validateAssignments(list: RequestedAssignment[]) {
    if (!list.length) throw badRequest('Select at least one class and subject.');
    if (list.length > MAX_REQUESTED) throw badRequest(`Select at most ${MAX_REQUESTED} class-subject combinations.`);
    const keys = new Set<string>();
    for (const a of list) { const k = `${a.institutionId}|${a.courseId}|${a.term}`; if (keys.has(k)) throw badRequest('The same class and subject was selected twice.'); keys.add(k); }
    const [courses, institutions, cat] = await Promise.all([
      this.prisma.course.findMany({ where: { id: { in: list.map((a) => a.courseId) } }, select: { id: true, programId: true, semester: true } }),
      this.prisma.institution.findMany({ where: { id: { in: list.map((a) => a.institutionId) }, active: true }, select: { id: true } }),
      this.catalog(),
    ]);
    const cById = new Map(courses.map((c) => [c.id, c])); const iIds = new Set(institutions.map((i) => i.id));
    for (const a of list) {
      const c = cById.get(a.courseId);
      if (!c || c.programId !== a.programId || c.semester !== a.semester) throw badRequest('One of the selected subjects does not belong to the selected programme and semester.');
      if (!iIds.has(a.institutionId)) throw badRequest('One of the selected institutions is not available.');
      if (cat.terms.length && !cat.terms.includes(a.term)) throw badRequest('Choose one of the listed academic sessions.');
    }
  }

  async start(d: TeacherRegistration, ip: string) {
    const email = d.email.trim().toLowerCase();
    if ((await this.kv.hit(`rl:treg:ip:${ip}`, 3600)) > 30 || (await this.kv.hit(`rl:treg:em:${email}`, 3600)) > 5) throw new AppError(429, 'RATE_LIMITED', 'Too many attempts. Try again later.');
    const policy = checkPassword(d.password, [email.split('@')[0] ?? '', d.fullName]);
    if (!policy.ok) throw badRequest(policy.problems[0] ?? 'Choose a stronger password.');
    if (!isValidPhone(d.phone)) throw badRequest(PHONE_HINT);
    await this.validateAssignments(d.assignments);
    const photo = d.photo ? decodePhoto(d.photo) : undefined;
    const employeeId = d.employeeId.trim();
    if (await this.prisma.teacherProfile.findFirst({ where: { employeeId: { equals: employeeId } }, select: { userId: true } })) throw conflict('EMPLOYEE_ID_TAKEN', 'This faculty / employee ID is already registered. Contact your campus administrator.');
    const passwordHash = await argon2.hash(d.password, { type: argon2.argon2id });     // always computed, so timing does not reveal whether the email is taken
    const taken = !!(await this.prisma.user.findUnique({ where: { email }, select: { id: true } }));
    let devCode: string | undefined;
    if (!taken) {
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      const pending: Pending = { fullName: d.fullName.trim(), passwordHash, employeeId, department: d.department.trim(), designation: d.designation.trim(), phone: d.phone.trim(), photo, assignments: d.assignments, codeHash: sha256(`${email}:${code}`), attempts: 0 };
      await this.kv.setText(`treg:${email}`, JSON.stringify(pending), TTL_SEC);
      const msg = await this.mail.enqueue(email, 'SZABMU Examinations — confirm your teacher registration', `Your 6-digit registration code is ${code}. It expires in ${TTL_SEC / 60} minutes.\nAfter you enter it, your registration is sent to the university for approval. You cannot use the system until it is approved.\nIf you did not try to register, ignore this message.`, 'teacher_registration');
      // Managed Node.js hosting cannot be relied on to keep a queue worker alive, so the first delivery attempt is made here, within a time limit;
      // the outbox row and the queued job remain as the retry path (deliver() is idempotent once the message is SENT).
      await Promise.race([this.mail.deliver(msg.id), new Promise((r) => setTimeout(r, 8000))]).catch(() => undefined);
      if (this.cfg.DEV_EXPOSE_CODES === 'true') devCode = code;
    }
    await this.audit.log({ actor: null, action: taken ? 'teacher.register_email_taken' : 'teacher.register_requested', entity: 'teacher', meta: { email, requested: d.assignments.length }, ip });
    return { ok: true, message: GENERIC, ...(devCode ? { devCode } : {}) };
  }

  async verify(emailRaw: string, code: string, ip: string) {
    const email = emailRaw.trim().toLowerCase(); const bad = new AppError(400, 'INVALID_CODE', 'The code is incorrect or has expired. Submit your registration again to get a new code.');
    if ((await this.kv.hit(`rl:treg:verify:${ip}`, 3600)) > 30) throw new AppError(429, 'RATE_LIMITED', 'Too many attempts. Try again later.');
    const raw = await this.kv.getText(`treg:${email}`); if (!raw) throw bad;
    const p = JSON.parse(raw) as Pending;
    if (p.attempts >= MAX_ATTEMPTS) { await this.kv.del(`treg:${email}`); throw bad; }
    if (p.codeHash !== sha256(`${email}:${code}`)) { p.attempts++; const ttl = await this.kv.ttl(`treg:${email}`); if (ttl > 0) await this.kv.setText(`treg:${email}`, JSON.stringify(p), ttl); throw bad; }
    await this.validateAssignments(p.assignments);                                         // the academic data may have changed while the code was pending
    const userId = await this.prisma.$transaction(async (tx) => {
      if (await tx.user.findUnique({ where: { email }, select: { id: true } })) throw conflict('EMAIL_TAKEN', 'This email already has an account');
      const user = await tx.user.create({ data: { email, fullName: p.fullName, role: 'TEACHER', passwordHash: p.passwordHash, phone: p.phone, mustChangePw: false } });
      await tx.teacherProfile.create({ data: { userId: user.id, employeeId: p.employeeId, department: p.department, designation: p.designation, photo: p.photo ? Buffer.from(p.photo.b64, 'base64') : undefined, photoMime: p.photo?.mime } });
      const now = new Date();
      await tx.courseAssignment.createMany({ data: p.assignments.map((a) => ({ userId: user.id, courseId: a.courseId, institutionId: a.institutionId, term: a.term, assignedById: user.id, status: 'PENDING' as const, requestedAt: now })) });
      await this.audit.append(tx, { actor: { id: user.id, role: 'TEACHER' }, action: 'teacher.registered', entity: 'teacher', entityId: user.id, meta: { employeeId: p.employeeId, requested: p.assignments.length }, ip });
      return user.id;
    });
    await this.kv.del(`treg:${email}`);
    await this.notifyAdmins(userId, p.fullName, [...new Set(p.assignments.map((a) => a.institutionId))]);
    return { ok: true };
  }

  /** Campus administrators of the requested institutions, and super administrators, are told there is a registration to review. */
  private async notifyAdmins(teacherId: string, name: string, institutionIds: string[]) {
    const admins = await this.prisma.user.findMany({ where: { active: true, OR: [{ role: 'SUPER_ADMIN' }, { role: 'CAMPUS_ADMIN', institutions: { some: { institutionId: { in: institutionIds } } } }] }, select: { id: true } });
    await this.notifications.notify(admins.map((a) => a.id), 'Teacher registration awaiting approval', `${name} has registered as a teacher and requested classes and subjects at your institution.`, LINKS.teachers).catch(() => undefined);
    void teacherId;
  }
}
