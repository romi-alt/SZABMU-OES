import { CanActivate, ExecutionContext, Inject, Injectable, SetMetadata, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { PORTAL_HEADER, can, isCampusScoped, portalOf, roleAllowedOnPortal, type Permission, type Role } from '@oes/shared';
import { PrismaService } from '../infra/prisma.service';
import { KvService } from '../infra/kv.service';
import { AppError, forbidden } from './errors';
import { CONFIG, type Config } from '../config';

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  /** null → university-wide reach; otherwise the only institutions this user may touch. */
  institutionIds: string[] | null;
  studentId?: string;
  sessionHash: string;
  mustChangePw: boolean;
  /** ok = fully authenticated · pending = TOTP enrolled but not yet verified in this session · enroll = role requires TOTP and none is set up. */
  mfa: 'ok' | 'pending' | 'enroll';
}

/** Roles that must use a second factor when MFA_ENFORCE is on. */
export const MFA_ROLES: readonly Role[] = ['SUPER_ADMIN', 'CCE', 'EXAMINER', 'CAMPUS_ADMIN'];

export const SESSION_COOKIE = 'oes_session';
/**
 * Session cookie attributes. `secure` must not depend on NODE_ENV alone: the Hostinger demo runs the API with NODE_ENV=development
 * behind HTTPS, which left the cookie without the Secure flag. It is set when the deployment is production, the request arrived over
 * HTTPS (trusted proxy), or every configured web origin is https. Plain-http local development keeps working.
 */
export function sessionCookieOptions(cfg: Pick<Config, 'NODE_ENV' | 'WEB_ORIGIN'>, req: { protocol?: string }, expires?: Date) {
  const origins = cfg.WEB_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean);
  const secure = cfg.NODE_ENV === 'production' || req.protocol === 'https' || (origins.length > 0 && origins.every((o) => o.startsWith('https://')));
  return { httpOnly: true, sameSite: 'lax' as const, secure, path: '/', ...(expires ? { expires } : {}) };
}
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export const Public = () => SetMetadata('public', true);
/** Declares the single permission required by a route. Routes without one are rejected at runtime. */
export const Perm = (p: Permission) => SetMetadata('perm', p);
export const AllowMustChange = () => SetMetadata('allowMustChange', true);
/** Route may be used while the second factor is still outstanding (the MFA endpoints themselves, me, logout). */
export const AllowMfaPending = () => SetMetadata('allowMfaPending', true);
export const CurrentUser = createParamDecorator((_d, ctx: ExecutionContext) => ctx.switchToHttp().getRequest().user as AuthUser);
export const Ip = createParamDecorator((_d, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<FastifyRequest>().ip);

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

export async function loadSession(prisma: PrismaService, kv: KvService, token: string, mfaEnforce = false): Promise<AuthUser | null> {
  const hash = sha256(token);
  const cached = await kv.getJson<AuthUser>(`sess:${hash}`);
  if (cached) return cached;
  const s = await prisma.session.findUnique({
    where: { tokenHash: hash },
    include: { user: { include: { institutions: true, student: { select: { id: true } } } } },
  });
  if (!s || s.revokedAt || s.expiresAt < new Date() || !s.user.active) return null;
  const u = s.user;
  const user: AuthUser = {
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    role: u.role,
    institutionIds: isCampusScoped(u.role) ? u.institutions.map((i) => i.institutionId) : null,
    studentId: u.student?.id,
    sessionHash: hash,
    mustChangePw: u.mustChangePw,
    mfa: u.totpEnabledAt ? (s.mfaVerifiedAt ? 'ok' : 'pending') : mfaEnforce && MFA_ROLES.includes(u.role) ? 'enroll' : 'ok',
  };
  await kv.setJson(`sess:${hash}`, user, 120); // invalidated explicitly on logout, deactivation, password reset and scope changes
  await kv.addToSet(`usess:${u.id}`, hash);
  return user;
}

export async function dropUserSessions(kv: KvService, userId: string) {
  try {
    const hashes = await kv.members(`usess:${userId}`);
    await kv.del(...hashes.map((h) => `sess:${h}`)); await kv.dropSet(`usess:${userId}`);
  } catch {
    /* cache only */
  }
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly prisma: PrismaService, private readonly kv: KvService, @Inject(CONFIG) private readonly cfg: Config) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const handler = ctx.getHandler();
    const cls = ctx.getClass();
    const isPublic = this.reflector.getAllAndOverride<boolean>('public', [handler, cls]);
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();

    if (isPublic) return true;

    const token = (req.cookies as Record<string, string | undefined> | undefined)?.[SESSION_COOKIE];
    if (!token) throw new AppError(401, 'UNAUTHENTICATED', 'Sign in required');
    const user = await loadSession(this.prisma, this.kv, token, this.cfg.MFA_ENFORCE === 'true');
    if (!user) throw new AppError(401, 'UNAUTHENTICATED', 'Session expired or invalid');
    req.user = user;
    // Two-portal deployment: a session is only honoured on the portal its role belongs to (fail closed when the proxy header is missing).
    if (this.cfg.PORTAL_ENFORCE === 'true') {
      const portal = portalOf(req.headers[PORTAL_HEADER]);
      if (!portal || !roleAllowedOnPortal(user.role, portal)) throw new AppError(403, 'WRONG_PORTAL', 'This account cannot be used on this portal');
    }
    if (user.mfa !== 'ok' && !this.reflector.getAllAndOverride<boolean>('allowMfaPending', [handler, cls])) {
      throw new AppError(403, 'MFA_REQUIRED', user.mfa === 'enroll' ? 'Your role requires two-factor authentication. Set it up to continue.' : 'Enter your authentication code to continue.', { mfa: user.mfa });
    }

    const perm = this.reflector.getAllAndOverride<Permission | undefined>('perm', [handler, cls]);
    if (!perm) throw forbidden('Route has no declared permission'); // deny by default
    if (!can(user.role, perm)) throw forbidden('Your role is not permitted to perform this action');
    // Working teacher routes need an APPROVED, active teacher account, checked here in the database before any handler or validation runs
    // (the services check again). Pending, rejected and suspended teachers therefore get the same 403 on every such route.
    if (perm === 'teacher.work') {
      const t = await this.prisma.teacherProfile.findUnique({ where: { userId: user.id }, select: { status: true, user: { select: { active: true } } } });
      if (!t || t.status !== 'APPROVED' || !t.user.active) throw new AppError(403, 'TEACHER_NOT_APPROVED', t?.status === 'SUSPENDED' ? 'Your access is suspended. Contact your campus administrator.' : 'Your registration has not been approved yet.');
    }
    if (user.mustChangePw && !this.reflector.getAllAndOverride<boolean>('allowMustChange', [handler, cls])) {
      throw new AppError(403, 'PASSWORD_CHANGE_REQUIRED', 'You must change your password before continuing');
    }
    return true;
  }
}

/** Institution-scope helpers. Every service query for campus data funnels through these. */
export const scope = {
  /** Prisma `in` filter value, or undefined for university-wide users. */
  filter(user: AuthUser): { in: string[] } | undefined {
    return user.institutionIds === null ? undefined : { in: user.institutionIds };
  },
  allows(user: AuthUser, institutionId: string): boolean {
    return user.institutionIds === null || user.institutionIds.includes(institutionId);
  },
  assert(user: AuthUser, institutionId: string) {
    if (!this.allows(user, institutionId)) throw forbidden('This resource belongs to an institution outside your assignment');
  },
};
