import { Inject, Injectable } from '@nestjs/common';
import argon2 from 'argon2';
import { randomBytes, randomInt } from 'node:crypto';
import { checkPassword, permissionsFor, roleAllowedOnPortal, type Portal } from '@oes/shared';
import { PrismaService } from '../../infra/prisma.service';
import { RedisService } from '../../infra/redis.service';
import { MailService } from '../../infra/mail.service';
import { AppError, badRequest } from '../../common/errors';
import { AuditService } from '../audit/audit.service';
import { MetricsService } from '../../infra/metrics.service';
import { MFA_ROLES, dropUserSessions, sha256, type AuthUser } from '../../common/auth';
import { CONFIG, type Config } from '../../config';

const MAX_FAILED = 5;
const LOCK_MIN = 15;
const RESET_TTL_MIN = 10;
const HISTORY_DEPTH = 5;
// Pre-computed hash so unknown-user logins cost the same as real ones (timing equalisation).
let DUMMY: string | undefined;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    @Inject(CONFIG) private readonly cfg: Config,
    private readonly metrics: MetricsService,
  ) {}

  private async dummy() {
    return (DUMMY ??= await argon2.hash('not-a-real-password', { type: argon2.argon2id }));
  }

  async login(emailRaw: string, password: string, ip: string, ua?: string, portal: Portal | null = null) {
    const email = emailRaw.trim().toLowerCase();
    const ipHits = await this.redis.hit(`rl:login:ip:${ip}`, 900);
    const idHits = await this.redis.hit(`rl:login:id:${email}`, 900);
    if (ipHits > this.cfg.LOGIN_RATE_IP_MAX || idHits > this.cfg.LOGIN_RATE_ID_MAX) { this.metrics.authFailures.inc({ kind: 'login_rate_limited' }); throw new AppError(429, 'RATE_LIMITED', 'Too many sign-in attempts. Try again later.'); }

    const user = await this.prisma.user.findUnique({ where: { email }, include: { institutions: true, student: { select: { id: true } } } });
    const now = new Date();
    if (user?.lockedUntil && user.lockedUntil > now) {
      await argon2.verify(await this.dummy(), password).catch(() => false);
      this.metrics.authFailures.inc({ kind: 'login_locked' });
      throw new AppError(423, 'ACCOUNT_LOCKED', 'Account temporarily locked after repeated failures. Try again later or contact the helpdesk.');
    }
    const ok = user ? await argon2.verify(user.passwordHash, password).catch(() => false) : await argon2.verify(await this.dummy(), password).catch(() => false) && false;
    if (!user || !ok || !user.active) {
      if (user) {
        const failed = user.failedLogins + 1;
        await this.prisma.user.update({ where: { id: user.id }, data: { failedLogins: failed, lockedUntil: failed >= MAX_FAILED ? new Date(now.getTime() + LOCK_MIN * 60000) : null } });
      }
      await this.audit.log({ actor: user ? { id: user.id, role: user.role } : null, action: 'auth.login_failed', entity: 'user', entityId: user?.id, meta: { email }, ip });
      this.metrics.authFailures.inc({ kind: 'login_invalid' });
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password');
    }
    // Two-portal deployment: correct credentials are still refused on the wrong portal, with the SAME message as a bad password
    // (nothing tells the caller that the account exists or which portal it belongs to). The attempt is audited and counted.
    if (this.cfg.PORTAL_ENFORCE === 'true' && (!portal || !roleAllowedOnPortal(user.role, portal))) {
      await this.audit.log({ actor: { id: user.id, role: user.role }, action: 'auth.login_wrong_portal', entity: 'user', entityId: user.id, meta: { portal }, ip });
      this.metrics.authFailures.inc({ kind: 'login_wrong_portal' });
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password');
    }

    const token = randomBytes(32).toString('base64url');
    await this.prisma.$transaction([
      this.prisma.session.create({ data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(now.getTime() + this.cfg.SESSION_TTL_HOURS * 3600_000), ip, userAgent: ua?.slice(0, 300) } }),
      this.prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: now } }),
    ]);
    this.metrics.authSuccess.inc({ kind: 'login' });
    await this.audit.log({ actor: user, action: 'auth.login', entity: 'user', entityId: user.id, ip });
    const mfa = user.totpEnabledAt ? 'pending' : this.cfg.MFA_ENFORCE === 'true' && MFA_ROLES.includes(user.role) ? 'enroll' : 'ok';
    return { token, expiresAt: new Date(now.getTime() + this.cfg.SESSION_TTL_HOURS * 3600_000), user: { ...this.profile(user), mfa } };
  }

  profile(u: { id: string; email: string; fullName: string; role: AuthUser['role']; mustChangePw: boolean; institutions?: { institutionId: string }[]; student?: { id: string } | null }) {
    return { id: u.id, email: u.email, fullName: u.fullName, role: u.role, mustChangePw: u.mustChangePw, studentId: u.student?.id ?? null, permissions: permissionsFor(u.role) };
  }

  async me(user: AuthUser) {
    const u = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { institutions: { include: { institution: { select: { id: true, code: true, name: true } } } }, student: { include: { program: true, institution: { select: { id: true, name: true, code: true } } } } },
    });
    const teacher = u.role === 'TEACHER' ? await this.prisma.teacherProfile.findUnique({ where: { userId: u.id }, select: { status: true, reviewNote: true } }) : null;
    const base = this.profile(u);
    // A teacher whose registration is not APPROVED holds only the permission to see their own approval status (the server re-checks on every teacher route as well).
    const permissions = teacher && teacher.status !== 'APPROVED' ? base.permissions.filter((p) => p === 'teacher.self' || p === 'program.read') : base.permissions;
    return { ...base, permissions, teacher: teacher && { status: teacher.status, reviewNote: teacher.reviewNote }, mfa: { enabled: !!u.totpEnabledAt, state: user.mfa, required: this.cfg.MFA_ENFORCE === 'true' && MFA_ROLES.includes(u.role) }, phone: u.phone, lastLoginAt: u.lastLoginAt, institutions: u.institutions.map((i) => i.institution), student: u.student && { id: u.student.id, regNo: u.student.regNo, semester: u.student.semester, program: u.student.program.code, programName: u.student.program.name, institution: u.student.institution, address: u.student.address, dateOfBirth: u.student.dateOfBirth, guardianPhone: u.student.guardianPhone } };
  }

  /** Self-service profile edit. Identity fields (name, email, DOB, registration number) are institution-managed and not editable here. */
  async updateProfile(user: AuthUser, d: { phone?: string; address?: string; guardianPhone?: string }, ip?: string) {
    await this.prisma.$transaction(async (tx) => {
      if (d.phone !== undefined) await tx.user.update({ where: { id: user.id }, data: { phone: d.phone } });
      if (user.studentId && (d.address !== undefined || d.guardianPhone !== undefined)) await tx.student.update({ where: { id: user.studentId }, data: { address: d.address, guardianPhone: d.guardianPhone } });
    });
    await this.audit.log({ actor: user, action: 'auth.profile_updated', entity: 'user', entityId: user.id, meta: { fields: Object.keys(d) }, ip });
    return this.me(user);
  }

  async logout(user: AuthUser) {
    await this.prisma.session.updateMany({ where: { tokenHash: user.sessionHash, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.redis.del(`sess:${user.sessionHash}`);
    await this.audit.log({ actor: user, action: 'auth.logout', entity: 'user', entityId: user.id });
  }

  /** Step 1 of recovery. Always responds identically so account existence is not disclosed. */
  async forgot(emailRaw: string, ip: string) {
    const email = emailRaw.trim().toLowerCase();
    const hits = await this.redis.hit(`rl:forgot:${email}:${ip}`, 3600);
    if (hits > 5) throw new AppError(429, 'RATE_LIMITED', 'Too many requests. Try again later.');
    const user = await this.prisma.user.findUnique({ where: { email } });
    let devCode: string | undefined;
    if (user && user.active) {
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      await this.prisma.passwordReset.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
      await this.prisma.passwordReset.create({ data: { userId: user.id, codeHash: sha256(`${user.id}:${code}`), expiresAt: new Date(Date.now() + RESET_TTL_MIN * 60000) } });
      await this.mail.enqueue(user.email, 'SZABMU Examinations — your verification code', `Your 6-digit verification code is ${code}. It expires in ${RESET_TTL_MIN} minutes.\nIf you did not request this, contact the IT helpdesk.`, 'PASSWORD_RESET');
      await this.audit.log({ actor: user, action: 'auth.reset_requested', entity: 'user', entityId: user.id, ip });
      if (this.cfg.DEV_EXPOSE_CODES === 'true') devCode = code;
    }
    return { ok: true, message: 'If that address is registered, a 6-digit code has been sent.', ...(devCode ? { devCode } : {}) };
  }

  /** Step 2: exchange the emailed code for a short-lived, single-use reset token. */
  async verifyCode(emailRaw: string, code: string, ip: string) {
    const email = emailRaw.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    const bad = new AppError(400, 'INVALID_CODE', 'The code is incorrect or has expired');
    if (!user) throw bad;
    const reset = await this.prisma.passwordReset.findFirst({ where: { userId: user.id, usedAt: null }, orderBy: { createdAt: 'desc' } });
    if (!reset || reset.expiresAt < new Date() || reset.attempts >= 5) throw bad;
    if (reset.codeHash !== sha256(`${user.id}:${code}`)) {
      await this.prisma.passwordReset.update({ where: { id: reset.id }, data: { attempts: { increment: 1 } } });
      throw bad;
    }
    await this.prisma.passwordReset.update({ where: { id: reset.id }, data: { usedAt: new Date() } });
    const token = randomBytes(24).toString('base64url');
    await this.redis.client.set(`rt:${sha256(token)}`, user.id, 'EX', RESET_TTL_MIN * 60);
    await this.audit.log({ actor: user, action: 'auth.reset_code_verified', entity: 'user', entityId: user.id, ip });
    return { resetToken: token };
  }

  async reset(resetToken: string, newPassword: string, ip: string) {
    const key = `rt:${sha256(resetToken)}`;
    const userId = await this.redis.client.getdel(key);
    if (!userId) throw new AppError(400, 'INVALID_TOKEN', 'This reset link has expired. Request a new code.');
    await this.setPassword(userId, newPassword);
    await this.audit.log({ actor: { id: userId, role: 'STUDENT' }, action: 'auth.password_reset', entity: 'user', entityId: userId, ip });
    return { ok: true };
  }

  async changePassword(user: AuthUser, current: string, next: string, ip: string) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!(await argon2.verify(u.passwordHash, current).catch(() => false))) throw new AppError(400, 'INVALID_CREDENTIALS', 'Current password is incorrect');
    await this.setPassword(user.id, next, user.sessionHash);
    await this.audit.log({ actor: user, action: 'auth.password_changed', entity: 'user', entityId: user.id, ip });
    return { ok: true };
  }

  /** Applies policy + history, rotates hash, revokes every other session ("signed out of all other devices"). */
  async setPassword(userId: string, password: string, keepSessionHash?: string) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const policy = checkPassword(password, [u.fullName.split(' ')[0] ?? '', u.email.split('@')[0] ?? '']);
    if (!policy.ok) throw badRequest(policy.problems.join(' '), { problems: policy.problems });
    const history = await this.prisma.passwordHistory.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: HISTORY_DEPTH });
    for (const h of [{ hash: u.passwordHash }, ...history]) {
      if (await argon2.verify(h.hash, password).catch(() => false)) throw badRequest(`You cannot reuse any of your last ${HISTORY_DEPTH} passwords.`);
    }
    const hash = await argon2.hash(password, { type: argon2.argon2id });
    await this.prisma.$transaction([
      this.prisma.passwordHistory.create({ data: { userId, hash: u.passwordHash } }),
      this.prisma.user.update({ where: { id: userId }, data: { passwordHash: hash, mustChangePw: false, failedLogins: 0, lockedUntil: null, passwordChangedAt: new Date() } }),
      this.prisma.session.updateMany({ where: { userId, revokedAt: null, ...(keepSessionHash ? { tokenHash: { not: keepSessionHash } } : {}) }, data: { revokedAt: new Date() } }),
    ]);
    await dropUserSessions(this.redis, userId);
    if (keepSessionHash) await this.redis.del(`sess:${keepSessionHash}`);
  }
}
