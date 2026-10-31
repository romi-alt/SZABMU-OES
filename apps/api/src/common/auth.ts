import { CanActivate, ExecutionContext, Injectable, SetMetadata, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { can, isCampusScoped, type Permission, type Role } from '@oes/shared';
import { PrismaService } from '../infra/prisma.service';
import { RedisService } from '../infra/redis.service';
import { AppError, forbidden } from './errors';

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
}

export const SESSION_COOKIE = 'oes_session';
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export const Public = () => SetMetadata('public', true);
/** Declares the single permission required by a route. Routes without one are rejected at runtime. */
export const Perm = (p: Permission) => SetMetadata('perm', p);
export const AllowMustChange = () => SetMetadata('allowMustChange', true);
export const CurrentUser = createParamDecorator((_d, ctx: ExecutionContext) => ctx.switchToHttp().getRequest().user as AuthUser);
export const Ip = createParamDecorator((_d, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<FastifyRequest>().ip);

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

export async function loadSession(prisma: PrismaService, redis: RedisService, token: string): Promise<AuthUser | null> {
  const hash = sha256(token);
  const cached = await redis.getJson<AuthUser>(`sess:${hash}`);
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
  };
  await redis.setJson(`sess:${hash}`, user, 120); // invalidated explicitly on logout, deactivation, password reset and scope changes
  await redis.client.sadd(`usess:${u.id}`, hash).catch(() => undefined);
  return user;
}

export async function dropUserSessions(redis: RedisService, userId: string) {
  try {
    const hashes = await redis.client.smembers(`usess:${userId}`);
    await redis.del(...hashes.map((h) => `sess:${h}`), `usess:${userId}`);
  } catch {
    /* cache only */
  }
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly prisma: PrismaService, private readonly redis: RedisService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const handler = ctx.getHandler();
    const cls = ctx.getClass();
    const isPublic = this.reflector.getAllAndOverride<boolean>('public', [handler, cls]);
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();

    if (isPublic) return true;

    const token = (req.cookies as Record<string, string | undefined> | undefined)?.[SESSION_COOKIE];
    if (!token) throw new AppError(401, 'UNAUTHENTICATED', 'Sign in required');
    const user = await loadSession(this.prisma, this.redis, token);
    if (!user) throw new AppError(401, 'UNAUTHENTICATED', 'Session expired or invalid');
    req.user = user;

    const perm = this.reflector.getAllAndOverride<Permission | undefined>('perm', [handler, cls]);
    if (!perm) throw forbidden('Route has no declared permission'); // deny by default
    if (!can(user.role, perm)) throw forbidden('Your role is not permitted to perform this action');
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
