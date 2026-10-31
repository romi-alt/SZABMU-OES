import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AllowMustChange, CurrentUser, Perm, Public, SESSION_COOKIE, type AuthUser } from '../../common/auth';
import { parse } from '../../common/validate';
import { AuthService } from './auth.service';
import { Inject } from '@nestjs/common';
import { CONFIG, type Config } from '../../config';

const loginDto = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(256) });
const forgotDto = z.object({ email: z.string().email().max(254) });
const verifyDto = z.object({ email: z.string().email().max(254), code: z.string().regex(/^\d{6}$/) });
const resetDto = z.object({ resetToken: z.string().min(10).max(200), newPassword: z.string().min(1).max(256) });
const changeDto = z.object({ currentPassword: z.string().min(1).max(256), newPassword: z.string().min(1).max(256) });

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, @Inject(CONFIG) private readonly cfg: Config) {}

  @Public() @Post('login') @HttpCode(200)
  async login(@Body() body: unknown, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const dto = parse(loginDto, body);
    const r = await this.auth.login(dto.email, dto.password, req.ip, req.headers['user-agent']);
    reply.setCookie(SESSION_COOKIE, r.token, { httpOnly: true, sameSite: 'lax', secure: this.cfg.NODE_ENV === 'production', path: '/', expires: r.expiresAt });
    return { user: r.user };
  }

  @Perm('program.read') @AllowMustChange() @Post('logout') @HttpCode(200)
  async logout(@CurrentUser() u: AuthUser, @Res({ passthrough: true }) reply: FastifyReply) {
    await this.auth.logout(u);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  }

  @Perm('program.read') @AllowMustChange() @Get('me')
  me(@CurrentUser() u: AuthUser) { return this.auth.me(u); }

  @Public() @Post('forgot') @HttpCode(200)
  forgot(@Body() body: unknown, @Req() req: FastifyRequest) { return this.auth.forgot(parse(forgotDto, body).email, req.ip); }

  @Public() @Post('verify-code') @HttpCode(200)
  verify(@Body() body: unknown, @Req() req: FastifyRequest) { const d = parse(verifyDto, body); return this.auth.verifyCode(d.email, d.code, req.ip); }

  @Public() @Post('reset') @HttpCode(200)
  reset(@Body() body: unknown, @Req() req: FastifyRequest) { const d = parse(resetDto, body); return this.auth.reset(d.resetToken, d.newPassword, req.ip); }

  @Perm('program.read') @AllowMustChange() @Post('change-password') @HttpCode(200)
  change(@CurrentUser() u: AuthUser, @Body() body: unknown, @Req() req: FastifyRequest) { const d = parse(changeDto, body); return this.auth.changePassword(u, d.currentPassword, d.newPassword, req.ip); }
}
