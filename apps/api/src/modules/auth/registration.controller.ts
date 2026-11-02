import { Body, Controller, Get, HttpCode, Inject, Post, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CurrentUser, Perm, Public, SESSION_COOKIE, type AuthUser } from '../../common/auth';
import { CONFIG, type Config } from '../../config';
import { AuthService } from './auth.service';
import { page, parse, uuid } from '../../common/validate';
import { RegistrationService } from './registration.service';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD').refine((v) => { const d = new Date(v); return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v) && d.getFullYear() >= 1940 && d < new Date(); }, 'Enter a valid date of birth');
const regDto = z.object({ regNo: z.string().trim().min(3).max(40), email: z.string().email().max(254), password: z.string().min(1).max(256) });
const verifyDto = z.object({ email: z.string().email().max(254), code: z.string().regex(/^\d{6}$/) });
const rosterRow = z.object({ regNo: z.string().trim().min(3).max(40), fullName: z.string().trim().min(2).max(200), dateOfBirth: isoDate, programCode: z.string().trim().min(1).max(40), semester: z.number().int().min(1).max(12), batchYear: z.number().int().min(1990).max(2100) });
const importDto = z.object({ institutionId: uuid, rows: z.array(rosterRow).min(1).max(2000) });

@Controller()
export class RegistrationController {
  constructor(private readonly reg: RegistrationService, private readonly auth: AuthService, @Inject(CONFIG) private readonly cfg: Config) {}

  @Public() @Post('auth/register') @HttpCode(200)
  register(@Body() body: unknown, @Req() req: FastifyRequest) { return this.reg.start(parse(regDto, body), req.ip); }

  @Public() @Post('auth/register/verify') @HttpCode(200)
  async verify(@Body() body: unknown, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const d = parse(verifyDto, body); const r = await this.reg.verify(d.email, d.code, req.ip);
    // The student is signed in at once so they can complete the one-time profile without a second sign-in.
    const s = await this.auth.sessionFor(r.userId, req.ip, req.headers['user-agent']);
    reply.setCookie(SESSION_COOKIE, s.token, { httpOnly: true, sameSite: 'lax', secure: this.cfg.NODE_ENV === 'production', path: '/', expires: s.expiresAt });
    return { ok: true, user: s.user };
  }

  @Perm('student.manage') @Post('roster/import') @HttpCode(200)
  import(@CurrentUser() u: AuthUser, @Body() body: unknown, @Req() req: FastifyRequest) { const d = parse(importDto, body); return this.reg.importRoster(u, d.institutionId, d.rows, req.ip); }

  @Perm('student.manage') @Get('roster')
  list(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>) { return this.reg.listRoster(u, parse(page.extend({ institutionId: uuid.optional(), status: z.enum(['claimed', 'unclaimed']).optional(), search: z.string().max(100).optional() }), q)); }
}
