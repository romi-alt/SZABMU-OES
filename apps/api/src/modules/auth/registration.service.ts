import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';
import { randomInt } from 'node:crypto';
import { checkPassword } from '@oes/shared';
import { PrismaService } from '../../infra/prisma.service';
import { idList } from '../../infra/sql';
import { KvService } from '../../infra/kv.service';
import { MailService } from '../../infra/mail.service';
import { AppError, badRequest, conflict } from '../../common/errors';
import { AuditService } from '../audit/audit.service';
import { scope, sha256, type AuthUser } from '../../common/auth';
import { Inject } from '@nestjs/common';
import { CONFIG, type Config } from '../../config';

const TTL_SEC = 15 * 60;
const MAX_ATTEMPTS = 5;
const ALREADY = 'An account already exists for this registration number. Sign in, or use "Forgot password" if you cannot remember it.';
const EMAIL_IN_USE = 'This email address is already used by another account. Use a different email address, or sign in.';

interface Pending { regNo: string; passwordHash: string; codeHash: string; attempts: number }
const REG_NO = /^[A-Za-z0-9][A-Za-z0-9._/-]{2,39}$/;

/**
 * Student sign-up: registration number + email + password, then an emailed 6-digit code. No matching against the official register.
 *  1. start(): failures are explicit (registration number or email already in use) so a student never waits for a code that was not sent; rate limits cap probing.
 *  2. verify(): the code proves control of the email; the account (role STUDENT) and a registration-number reservation are created in one transaction and the caller
 *     is signed in. The Student record, with its institution/programme/semester, is created later by the one-time profile form (OnboardingService) and is flagged
 *     `selfDeclared` until an administrator verifies it, so signing up grants no enrolment, admission or examination access.
 * The official register (roster) and its import remain available to administrators; sign-up no longer consumes it.
 */
@Injectable()
export class RegistrationService {
  constructor(private readonly prisma: PrismaService, private readonly kv: KvService, private readonly mail: MailService, private readonly audit: AuditService, @Inject(CONFIG) private readonly cfg: Config) {}

  async start(d: { regNo: string; email: string; password: string }, ip: string) {
    const email = d.email.trim().toLowerCase(); const regNo = d.regNo.trim();
    if ((await this.kv.hit(`rl:reg:ip:${ip}`, 3600)) > 20 || (await this.kv.hit(`rl:reg:no:${regNo.toLowerCase()}`, 3600)) > 5 || (await this.kv.hit(`rl:reg:em:${email}`, 3600)) > 5) throw new AppError(429, 'RATE_LIMITED', 'Too many attempts. Try again later.');
    if (!REG_NO.test(regNo)) throw badRequest('Enter your registration number using letters, digits and . _ / - only (3 to 40 characters).');
    const policy = checkPassword(d.password, [email.split('@')[0] ?? '']);
    if (!policy.ok) throw badRequest(policy.problems[0] ?? 'Choose a stronger password.');
    const passwordHash = await argon2.hash(d.password, { type: argon2.argon2id });     // always computed: response time must not reveal whether the email or number is taken
    const emailTaken = !!(await this.prisma.user.findUnique({ where: { email }, select: { id: true } }));
    const regTaken = !!(await this.prisma.student.findFirst({ where: { regNo: { equals: regNo } }, select: { id: true } })) || !!(await this.prisma.studentSignup.findFirst({ where: { regNo: { equals: regNo } }, select: { userId: true } }));
    // A student must be told why no code arrives, so these two outcomes are explicit (the per-IP, per-number and per-email rate limits cap probing).
    if (regTaken || emailTaken) {
      await this.audit.log({ actor: null, action: 'auth.register_unavailable', entity: 'student_signup', meta: { regNo, reason: regTaken ? 'reg_no_taken' : 'email_taken' }, ip });
      if (regTaken) throw conflict('ALREADY_REGISTERED', ALREADY);
      throw conflict('EMAIL_IN_USE', EMAIL_IN_USE);
    }
    let devCode: string | undefined;
    {
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      const pending: Pending = { regNo, passwordHash, codeHash: sha256(`${email}:${code}`), attempts: 0 };
      await this.kv.setText(`reg:${email}`, JSON.stringify(pending), TTL_SEC);
      const m = await this.mail.enqueue(email, 'SZABMU Examinations — confirm your registration', `Your 6-digit registration code is ${code}. It expires in ${TTL_SEC / 60} minutes.\nIf you did not try to register, ignore this message.`, 'student_registration');
      // The first delivery attempt is made here (time-limited) so registration does not depend on a queue worker staying alive; the outbox row remains the retry path.
      await Promise.race([this.mail.deliver(m.id), new Promise((r) => setTimeout(r, 8000))]).catch(() => undefined);
      if (this.cfg.DEV_EXPOSE_CODES === 'true') devCode = code;
      await this.audit.log({ actor: null, action: 'auth.register_requested', entity: 'student_signup', meta: { email, regNo }, ip });
    }
    return { ok: true, message: `We sent a 6-digit code to ${email}. It expires in ${TTL_SEC / 60} minutes. Not in your inbox? Check Spam or Junk.`, ...(devCode ? { devCode } : {}) };
  }

  /** Verifies the emailed code and creates the account. Returns the new user's id so the caller can sign them in. */
  async verify(emailRaw: string, code: string, ip: string) {
    const email = emailRaw.trim().toLowerCase(); const bad = new AppError(400, 'INVALID_CODE', 'The code is incorrect or has expired. Start again to get a new one.');
    if ((await this.kv.hit(`rl:reg:verify:${ip}`, 3600)) > 30) throw new AppError(429, 'RATE_LIMITED', 'Too many attempts. Try again later.');
    const raw = await this.kv.getText(`reg:${email}`); if (!raw) throw bad;
    const p = JSON.parse(raw) as Pending;
    if (p.attempts >= MAX_ATTEMPTS) { await this.kv.del(`reg:${email}`); throw bad; }
    if (p.codeHash !== sha256(`${email}:${code}`)) { p.attempts++; const ttl = await this.kv.ttl(`reg:${email}`); if (ttl > 0) await this.kv.setText(`reg:${email}`, JSON.stringify(p), ttl); throw bad; }
    let userId: string;
    try {
      userId = await this.prisma.$transaction(async (tx) => {
        if (await tx.user.findUnique({ where: { email }, select: { id: true } })) throw conflict('EMAIL_TAKEN', 'This email already has an account');
        if (await tx.student.findFirst({ where: { regNo: { equals: p.regNo } }, select: { id: true } })) throw conflict('REG_NO_TAKEN', 'This registration number is already in use. Contact your campus examination office.');
        // The name is a placeholder until the student completes the profile (the Student record is created only then).
        const user = await tx.user.create({ data: { email, fullName: email.split('@')[0]!, role: 'STUDENT', passwordHash: p.passwordHash, mustChangePw: false } });
        await tx.studentSignup.create({ data: { userId: user.id, regNo: p.regNo } });
        await this.audit.append(tx, { actor: { id: user.id, role: 'STUDENT' }, action: 'student.signed_up', entity: 'student_signup', entityId: user.id, meta: { regNo: p.regNo }, ip });
        return user.id;
      });
    } catch (e) { if ((e as { code?: string }).code === 'P2002') throw conflict('REG_NO_TAKEN', 'This registration number is already in use. Contact your campus examination office.'); throw e; }
    await this.kv.del(`reg:${email}`);
    return { ok: true, userId };
  }

  /** Registrar / campus admin supplies the official register. All-or-nothing; duplicates are reported, never skipped silently. */
  async importRoster(u: AuthUser, institutionId: string, rows: { regNo: string; fullName: string; dateOfBirth: string; programCode: string; semester: number; batchYear: number }[], ip?: string) {
    scope.assert(u, institutionId);
    const regs = rows.map((r) => r.regNo.trim().toLowerCase());
    if (new Set(regs).size !== regs.length) throw badRequest('Duplicate registration number within the file');
    const codes = [...new Set(rows.map((r) => r.programCode.trim()))];
    const programs = await this.prisma.program.findMany({ where: { code: { in: codes } }, select: { id: true, code: true } });
    const byCode = new Map(programs.map((p) => [p.code, p.id])); const unknown = codes.filter((c) => !byCode.has(c));
    if (unknown.length) throw badRequest(`Unknown programme code(s): ${unknown.join(', ')}`);
    const existing = await this.prisma.$queryRaw<{ regNo: string }[]>`SELECT "regNo" FROM roster_entries WHERE "regNo" IN ${idList(regs)} UNION SELECT "regNo" FROM students WHERE "regNo" IN ${idList(regs)}`;   // the _ci collation compares case-insensitively
    if (existing.length) throw conflict('ROSTER_DUPLICATES', 'Some registration numbers are already registered', { regNos: existing.map((e) => e.regNo) });
    await this.prisma.rosterEntry.createMany({ data: rows.map((r) => ({ institutionId, programId: byCode.get(r.programCode.trim())!, regNo: r.regNo.trim(), fullName: r.fullName.trim(), dateOfBirth: new Date(r.dateOfBirth), semester: r.semester, batchYear: r.batchYear, importedBy: u.id })) });
    await this.audit.log({ actor: u, action: 'roster.import', entity: 'institution', entityId: institutionId, institutionId, meta: { count: rows.length }, ip });
    return { imported: rows.length };
  }

  /** Register status for admins (no dates of birth are returned). */
  async listRoster(u: AuthUser, q: { institutionId?: string; status?: 'claimed' | 'unclaimed'; search?: string; page: number; pageSize: number }) {
    const sf = scope.filter(u);
    const inst = sf ? (q.institutionId && scope.allows(u, q.institutionId) ? q.institutionId : sf) : q.institutionId;
    const where = {
      ...(inst ? { institutionId: inst } : {}),
      ...(q.status === 'claimed' ? { claimedAt: { not: null } } : q.status === 'unclaimed' ? { claimedAt: null } : {}),
      ...(q.search ? { OR: [{ regNo: { contains: q.search } }, { fullName: { contains: q.search } }] } : {}),
    };
    const [items, total, claimed] = await Promise.all([
      this.prisma.rosterEntry.findMany({ where, orderBy: { regNo: 'asc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, select: { id: true, regNo: true, fullName: true, semester: true, batchYear: true, claimedAt: true, institution: { select: { code: true } }, program: { select: { code: true } } } }),
      this.prisma.rosterEntry.count({ where }), this.prisma.rosterEntry.count({ where: { ...where, claimedAt: { not: null } } }),
    ]);
    return { items, total, claimed };
  }
}
