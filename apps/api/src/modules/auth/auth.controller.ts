import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { isValidPhone, PHONE_HINT, PORTAL_HEADER, portalOf } from '@oes/shared';
import { AllowMfaPending, AllowMustChange, CurrentUser, Perm, Public, SESSION_COOKIE, type AuthUser } from '../../common/auth';
import { parse } from '../../common/validate';
import { AuthService } from './auth.service';
import { MfaService } from './mfa.service';
import { Inject } from '@nestjs/common';
import { CONFIG, type Config } from '../../config';

const loginDto = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(256) });
const forgotDto = z.object({ email: z.string().email().max(254) });
const verifyDto = z.object({ email: z.string().email().max(254), code: z.string().regex(/^\d{6}$/) });
const resetDto = z.object({ resetToken: z.string().min(10).max(200), newPassword: z.string().min(1).max(256) });
const changeDto = z.object({ currentPassword: z.string().min(1).max(256), newPassword: z.string().min(1).max(256) });

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly mfa: MfaService, @Inject(CONFIG) private readonly cfg: Config) {}

  @Public() @Post('login') @HttpCode(200)
  async login(@Body() body: unknown, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const dto = parse(loginDto, body);
    const r = await this.auth.login(dto.email, dto.password, req.ip, req.headers['user-agent'], portalOf(req.headers[PORTAL_HEADER]));
    reply.setCookie(SESSION_COOKIE, r.token, { httpOnly: true, sameSite: 'lax', secure: this.cfg.NODE_ENV === 'production', path: '/', expires: r.expiresAt });
    return { user: r.user };
  }

  @Perm('program.read') @AllowMustChange() @AllowMfaPending() @Post('logout') @HttpCode(200)
  async logout(@CurrentUser() u: AuthUser, @Res({ passthrough: true }) reply: FastifyReply) {
    await this.auth.logout(u);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  }

  @Perm('program.read') @AllowMustChange() @AllowMfaPending() @Get('me')
  me(@CurrentUser() u: AuthUser) { return this.auth.me(u); }

  @Perm('program.read') @Patch('profile')
  profile(@CurrentUser() u: AuthUser, @Body() b: unknown, @Req() req: FastifyRequest) { return this.auth.updateProfile(u, parse(z.object({ phone: z.string().max(30).refine(isValidPhone, PHONE_HINT).optional(), address: z.string().max(300).optional(), guardianPhone: z.string().max(30).refine(isValidPhone, PHONE_HINT).optional() }), b), req.ip); }

  @Public() @Post('forgot') @HttpCode(200)
  forgot(@Body() body: unknown, @Req() req: FastifyRequest) { return this.auth.forgot(parse(forgotDto, body).email, req.ip); }

  @Public() @Post('verify-code') @HttpCode(200)
  verify(@Body() body: unknown, @Req() req: FastifyRequest) { const d = parse(verifyDto, body); return this.auth.verifyCode(d.email, d.code, req.ip); }

  @Public() @Post('reset') @HttpCode(200)
  reset(@Body() body: unknown, @Req() req: FastifyRequest) { const d = parse(resetDto, body); return this.auth.reset(d.resetToken, d.newPassword, req.ip); }

  @Perm('program.read') @AllowMustChange() @Post('change-password') @HttpCode(200)
  change(@CurrentUser() u: AuthUser, @Body() body: unknown, @Req() req: FastifyRequest) { const d = parse(changeDto, body); return this.auth.changePassword(u, d.currentPassword, d.newPassword, req.ip); }

  // ── second factor (TOTP) ──
  @Perm('program.read') @AllowMfaPending() @Post('mfa/setup') @HttpCode(200)
  mfaSetup(@CurrentUser() u: AuthUser, @Req() req: FastifyRequest) { return this.mfa.setup(u, req.ip); }

  @Perm('program.read') @AllowMfaPending() @Post('mfa/enable') @HttpCode(200)
  mfaEnable(@CurrentUser() u: AuthUser, @Body() b: unknown, @Req() req: FastifyRequest) { return this.mfa.enable(u, parse(z.object({ code: z.string().regex(/^\d{6}$/) }), b).code, req.ip); }

  @Perm('program.read') @AllowMfaPending() @Post('mfa/verify') @HttpCode(200)
  mfaVerify(@CurrentUser() u: AuthUser, @Body() b: unknown, @Req() req: FastifyRequest) { return this.mfa.verify(u, parse(z.object({ code: z.string().regex(/^\d{6}$/).optional(), recoveryCode: z.string().min(8).max(20).optional() }), b), req.ip); }

  @Perm('program.read') @Post('mfa/disable') @HttpCode(200)
  mfaDisable(@CurrentUser() u: AuthUser, @Body() b: unknown, @Req() req: FastifyRequest) { const d = parse(z.object({ password: z.string().min(1).max(256), code: z.string().regex(/^\d{6}$/) }), b); return this.mfa.disable(u, d.password, d.code, req.ip); }

  @Perm('user.manage_global') @Post('mfa/reset/:userId') @HttpCode(200)
  mfaReset(@CurrentUser() u: AuthUser, @Param('userId', ParseUUIDPipe) userId: string, @Req() req: FastifyRequest) { return this.mfa.adminReset(u, userId, req.ip); }
}
