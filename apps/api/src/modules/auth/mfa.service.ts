import { Inject, Injectable } from '@nestjs/common';
import argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { MetricsService } from '../../infra/metrics.service';
import { PrismaService } from '../../infra/prisma.service';
import { CacheService } from '../../infra/cache.service';
import { AuditService } from '../audit/audit.service';
import { MFA_ROLES, dropUserSessions, sha256, type AuthUser } from '../../common/auth';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../common/errors';
import { open, seal } from '../../common/secretbox';
import { newTotpSecret, otpauthUrl, verifyTotp } from '../../common/totp';
import { CONFIG, type Config } from '../../config';

const MAX_FAILED = 5, LOCK_MIN = 15, RECOVERY_CODES = 10;
const normRecovery = (c: string) => c.replace(/[\s-]/g, '').toUpperCase();

/** TOTP second factor for privileged staff. Secrets encrypted at rest; recovery codes hashed and single-use; codes cannot be replayed. */
@Injectable()
export class MfaService {
  constructor(private readonly prisma: PrismaService, private readonly cache: CacheService, private readonly audit: AuditService, private readonly metrics: MetricsService, @Inject(CONFIG) private readonly cfg: Config) {}
  private get material() { return this.cfg.MFA_KEY ?? this.cfg.COOKIE_SECRET; }
  required(role: AuthUser['role']) { return this.cfg.MFA_ENFORCE === 'true' && MFA_ROLES.includes(role); }
  private async refresh(userSessionHash?: string) { if (userSessionHash) await this.cache.del(`sess:${userSessionHash}`); }

  /** Step 1: generate a pending secret. Not active until a valid code proves the authenticator works (`enable`). */
  async setup(u: AuthUser, ip?: string) {
    const row = await this.prisma.user.findUniqueOrThrow({ where: { id: u.id }, select: { totpEnabledAt: true, email: true } });
    if (row.totpEnabledAt) throw conflict('ALREADY_ENABLED', 'Two-factor authentication is already enabled');
    const secret = newTotpSecret();
    await this.prisma.user.update({ where: { id: u.id }, data: { totpSecretEnc: seal(secret, this.material), totpLastStep: null } });
    await this.audit.log({ actor: u, action: 'mfa.setup_started', entity: 'user', entityId: u.id, ip });
    return { secret, otpauthUrl: otpauthUrl(secret, row.email) };
  }

  private async failure(userId: string, actor: AuthUser, why: string, ip?: string): Promise<never> {
    const cur = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { failedLogins: true } });
    const failed = cur.failedLogins + 1;
    await this.prisma.user.update({ where: { id: userId }, data: { failedLogins: failed, lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MIN * 60000) : null } });
    await this.audit.log({ actor, action: 'mfa.verify_failed', entity: 'user', entityId: userId, meta: { why, failed }, ip });
    this.metrics.authFailures.inc({ kind: 'mfa_invalid' });
    throw new AppError(401, 'INVALID_MFA_CODE', 'That code is not valid');
  }
  private async assertNotLocked(userId: string) {
    const r = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { lockedUntil: true } });
    if (r.lockedUntil && r.lockedUntil > new Date()) { this.metrics.authFailures.inc({ kind: 'mfa_locked' }); throw new AppError(423, 'ACCOUNT_LOCKED', 'Too many failed attempts. Try again later or contact the helpdesk.'); }
  }

  /** Step 2: confirm the first code, activate, issue one-time recovery codes, sign out all other sessions. */
  async enable(u: AuthUser, code: string, ip?: string) {
    await this.assertNotLocked(u.id);
    const row = await this.prisma.user.findUniqueOrThrow({ where: { id: u.id }, select: { totpSecretEnc: true, totpEnabledAt: true, totpLastStep: true } });
    if (row.totpEnabledAt) throw conflict('ALREADY_ENABLED', 'Two-factor authentication is already enabled');
    if (!row.totpSecretEnc) throw badRequest('Start setup first');
    const step = verifyTotp(open(row.totpSecretEnc, this.material), code, Date.now(), null);
    if (step === null) return this.failure(u.id, u, 'enable', ip);
    const codes = Array.from({ length: RECOVERY_CODES }, () => { const r = randomBytes(8).toString('hex').toUpperCase(); return `${r.slice(0, 5)}-${r.slice(5, 10)}`; });
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: u.id }, data: { totpEnabledAt: new Date(), totpLastStep: step, failedLogins: 0, lockedUntil: null } }),
      this.prisma.mfaRecoveryCode.deleteMany({ where: { userId: u.id } }),
      this.prisma.mfaRecoveryCode.createMany({ data: codes.map((c) => ({ userId: u.id, codeHash: sha256(normRecovery(c)) })) }),
      this.prisma.session.updateMany({ where: { userId: u.id, tokenHash: { not: u.sessionHash }, revokedAt: null }, data: { revokedAt: new Date() } }),
      this.prisma.session.updateMany({ where: { tokenHash: u.sessionHash }, data: { mfaVerifiedAt: new Date() } }),
    ]);
    await dropUserSessions(this.cache, u.id);
    await this.audit.log({ actor: u, action: 'mfa.enabled', entity: 'user', entityId: u.id, ip });
    return { enabled: true, recoveryCodes: codes, note: 'Store these recovery codes offline. Each works once; they are not shown again.' };
  }

  /** Satisfies the second factor for the current session (TOTP, or a single-use recovery code). */
  async verify(u: AuthUser, d: { code?: string; recoveryCode?: string }, ip?: string) {
    if (u.mfa === 'ok') return { ok: true };
    if (u.mfa === 'enroll') throw new AppError(403, 'MFA_REQUIRED', 'Set up two-factor authentication first', { mfa: 'enroll' });
    await this.assertNotLocked(u.id);
    const row = await this.prisma.user.findUniqueOrThrow({ where: { id: u.id }, select: { totpSecretEnc: true, totpLastStep: true } });
    if (!row.totpSecretEnc) throw badRequest('Two-factor authentication is not set up');
    let usedRecovery = false;
    if (d.code) {
      const step = verifyTotp(open(row.totpSecretEnc, this.material), d.code, Date.now(), row.totpLastStep);
      if (step === null) return this.failure(u.id, u, 'totp', ip);
      // compare-and-set: two concurrent requests with the same code cannot both succeed
      const won = await this.prisma.user.updateMany({ where: { id: u.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] }, data: { totpLastStep: step, failedLogins: 0, lockedUntil: null } });
      if (won.count !== 1) return this.failure(u.id, u, 'replay', ip);
    } else if (d.recoveryCode) {
      const used = await this.prisma.mfaRecoveryCode.updateMany({ where: { userId: u.id, codeHash: sha256(normRecovery(d.recoveryCode)), usedAt: null }, data: { usedAt: new Date() } });
      if (used.count !== 1) return this.failure(u.id, u, 'recovery', ip);
      usedRecovery = true; await this.prisma.user.update({ where: { id: u.id }, data: { failedLogins: 0, lockedUntil: null } });
    } else throw badRequest('Provide a code or a recovery code');
    await this.prisma.session.updateMany({ where: { tokenHash: u.sessionHash }, data: { mfaVerifiedAt: new Date() } });
    await this.refresh(u.sessionHash);
    const remaining = usedRecovery ? await this.prisma.mfaRecoveryCode.count({ where: { userId: u.id, usedAt: null } }) : undefined;
    this.metrics.authSuccess.inc({ kind: usedRecovery ? 'mfa_recovery' : 'mfa' });
    await this.audit.log({ actor: u, action: usedRecovery ? 'mfa.recovery_used' : 'mfa.verified', entity: 'user', entityId: u.id, meta: usedRecovery ? { remaining } : undefined, ip });
    return { ok: true, ...(usedRecovery ? { recoveryCodesRemaining: remaining } : {}) };
  }

  /** Self-service disable — refused for roles that must use MFA. Needs password AND a current code. */
  async disable(u: AuthUser, password: string, code: string, ip?: string) {
    if (this.required(u.role)) throw forbidden('Your role requires two-factor authentication; ask a Super Administrator to reset it if you lost your device');
    await this.assertNotLocked(u.id);
    const row = await this.prisma.user.findUniqueOrThrow({ where: { id: u.id }, select: { passwordHash: true, totpSecretEnc: true, totpEnabledAt: true, totpLastStep: true } });
    if (!row.totpEnabledAt || !row.totpSecretEnc) throw badRequest('Two-factor authentication is not enabled');
    if (!(await argon2.verify(row.passwordHash, password).catch(() => false))) return this.failure(u.id, u, 'disable-password', ip);
    if (verifyTotp(open(row.totpSecretEnc, this.material), code, Date.now(), row.totpLastStep) === null) return this.failure(u.id, u, 'disable-code', ip);
    await this.clear(u.id);
    await this.audit.log({ actor: u, action: 'mfa.disabled', entity: 'user', entityId: u.id, ip });
    return { enabled: false };
  }

  /** Lost-device recovery by a Super Administrator: removes the factor and signs the user out everywhere. */
  async adminReset(actor: AuthUser, userId: string, ip?: string) {
    const t = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!t) throw notFound('User');
    await this.clear(userId);
    await this.prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await dropUserSessions(this.cache, userId);
    await this.audit.log({ actor, action: 'mfa.reset', entity: 'user', entityId: userId, ip });
    return { ok: true };
  }
  private async clear(userId: string) {
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null } }),
      this.prisma.mfaRecoveryCode.deleteMany({ where: { userId } }),
    ]);
  }
}
