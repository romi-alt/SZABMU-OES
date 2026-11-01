import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';
import { randomInt } from 'node:crypto';
import { checkPassword } from '@oes/shared';
import { PrismaService } from '../../infra/prisma.service';
import { RedisService } from '../../infra/redis.service';
import { MailService } from '../../infra/mail.service';
import { AppError, badRequest, conflict } from '../../common/errors';
import { AuditService } from '../audit/audit.service';
import { scope, sha256, type AuthUser } from '../../common/auth';
import { Inject } from '@nestjs/common';
import { CONFIG, type Config } from '../../config';

const TTL_SEC = 15 * 60;
const MAX_ATTEMPTS = 5;
const GENERIC = 'If your details match the official student register, a 6-digit code has been sent to that email address. Enter it to finish creating your account.';

interface Pending { rosterId: string; passwordHash: string; codeHash: string; attempts: number }

/**
 * Student self-registration against the official register (roster).
 *  1. start(): registration no. + date of birth must match an UNCLAIMED roster entry, and the email must be free. The answer is always the same
 *     generic message, so the endpoint cannot be used to discover who is on the register or which emails have accounts.
 *  2. verify(): the 6-digit code mailed to that address proves control of it; only then is the account created (role STUDENT, the roster's
 *     institution/programme/semester), and the roster entry is claimed exactly once.
 * No exam access follows from registering: enrolment, eligibility and admission rules are unchanged.
 */
@Injectable()
export class RegistrationService {
  constructor(private readonly prisma: PrismaService, private readonly redis: RedisService, private readonly mail: MailService, private readonly audit: AuditService, @Inject(CONFIG) private readonly cfg: Config) {}

  async start(d: { regNo: string; dateOfBirth: string; email: string; password: string }, ip: string) {
    const email = d.email.trim().toLowerCase(); const regNo = d.regNo.trim();
    if ((await this.redis.hit(`rl:reg:ip:${ip}`, 3600)) > 10 || (await this.redis.hit(`rl:reg:no:${regNo.toLowerCase()}`, 3600)) > 5) throw new AppError(429, 'RATE_LIMITED', 'Too many attempts. Try again later.');
    const policy = checkPassword(d.password, [email.split('@')[0] ?? '']);
    if (!policy.ok) throw badRequest(policy.problems[0] ?? 'Choose a stronger password.');
    const passwordHash = await argon2.hash(d.password, { type: argon2.argon2id });     // always computed: response time must not reveal a match
    const entry = await this.prisma.rosterEntry.findFirst({ where: { regNo: { equals: regNo, mode: 'insensitive' } } });
    const emailTaken = !!(await this.prisma.user.findUnique({ where: { email }, select: { id: true } }));
    const matches = !!entry && !entry.claimedAt && entry.dateOfBirth.toISOString().slice(0, 10) === d.dateOfBirth;
    let devCode: string | undefined;
    if (matches && !emailTaken) {
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      const pending: Pending = { rosterId: entry.id, passwordHash, codeHash: sha256(`${email}:${code}`), attempts: 0 };
      await this.redis.client.set(`reg:${email}`, JSON.stringify(pending), 'EX', TTL_SEC);
      await this.mail.enqueue(email, 'SZABMU Examinations — confirm your registration', `Your 6-digit registration code is ${code}. It expires in ${TTL_SEC / 60} minutes.\nIf you did not try to register, ignore this message.`, 'REGISTRATION');
      if (this.cfg.DEV_EXPOSE_CODES === 'true') devCode = code;
      await this.audit.log({ actor: null, action: 'auth.register_requested', entity: 'roster', entityId: entry.id, institutionId: entry.institutionId, meta: { email }, ip });
    } else {
      await this.audit.log({ actor: null, action: 'auth.register_unmatched', entity: 'roster', meta: { regNo, reason: !entry ? 'unknown' : entry.claimedAt ? 'claimed' : !matches ? 'dob' : 'email_taken' }, ip });
    }
    return { ok: true, message: GENERIC, ...(devCode ? { devCode } : {}) };
  }

  async verify(emailRaw: string, code: string, ip: string) {
    const email = emailRaw.trim().toLowerCase(); const bad = new AppError(400, 'INVALID_CODE', 'The code is incorrect or has expired. Start again to get a new one.');
    if ((await this.redis.hit(`rl:reg:verify:${ip}`, 3600)) > 30) throw new AppError(429, 'RATE_LIMITED', 'Too many attempts. Try again later.');
    const raw = await this.redis.client.get(`reg:${email}`); if (!raw) throw bad;
    const p = JSON.parse(raw) as Pending;
    if (p.attempts >= MAX_ATTEMPTS) { await this.redis.client.del(`reg:${email}`); throw bad; }
    if (p.codeHash !== sha256(`${email}:${code}`)) { p.attempts++; const ttl = await this.redis.client.ttl(`reg:${email}`); if (ttl > 0) await this.redis.client.set(`reg:${email}`, JSON.stringify(p), 'EX', ttl); throw bad; }
    const entry = await this.prisma.rosterEntry.findUnique({ where: { id: p.rosterId } });
    if (!entry || entry.claimedAt) { await this.redis.client.del(`reg:${email}`); throw bad; }
    const userId = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.rosterEntry.updateMany({ where: { id: entry.id, claimedAt: null }, data: { claimedAt: new Date() } });
      if (claimed.count !== 1) throw bad;                                                // someone else claimed it first
      if (await tx.user.findUnique({ where: { email }, select: { id: true } })) throw conflict('EMAIL_TAKEN', 'This email already has an account');
      const user = await tx.user.create({ data: { email, fullName: entry.fullName, role: 'STUDENT', passwordHash: p.passwordHash, mustChangePw: false, institutions: { create: [{ institutionId: entry.institutionId }] } } });
      await tx.student.create({ data: { userId: user.id, institutionId: entry.institutionId, programId: entry.programId, regNo: entry.regNo, semester: entry.semester, batchYear: entry.batchYear, dateOfBirth: entry.dateOfBirth } });
      await tx.rosterEntry.update({ where: { id: entry.id }, data: { claimedByUserId: user.id } });
      return user.id;
    });
    await this.redis.client.del(`reg:${email}`);
    await this.audit.log({ actor: { id: userId, role: 'STUDENT' }, action: 'student.self_registered', entity: 'student', entityId: userId, institutionId: entry.institutionId, meta: { regNo: entry.regNo }, ip });
    return { ok: true };
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
    const existing = await this.prisma.$queryRaw<{ regNo: string }[]>`SELECT "regNo" FROM roster_entries WHERE lower("regNo") = ANY(${regs}) UNION SELECT "regNo" FROM students WHERE lower("regNo") = ANY(${regs})`;
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
      ...(q.search ? { OR: [{ regNo: { contains: q.search, mode: 'insensitive' as const } }, { fullName: { contains: q.search, mode: 'insensitive' as const } }] } : {}),
    };
    const [items, total, claimed] = await Promise.all([
      this.prisma.rosterEntry.findMany({ where, orderBy: { regNo: 'asc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, select: { id: true, regNo: true, fullName: true, semester: true, batchYear: true, claimedAt: true, institution: { select: { code: true } }, program: { select: { code: true } } } }),
      this.prisma.rosterEntry.count({ where }), this.prisma.rosterEntry.count({ where: { ...where, claimedAt: { not: null } } }),
    ]);
    return { items, total, claimed };
  }
}
