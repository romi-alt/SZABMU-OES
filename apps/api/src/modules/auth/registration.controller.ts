import { Body, Controller, Get, HttpCode, Post, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CurrentUser, Perm, Public, type AuthUser } from '../../common/auth';
import { page, parse, uuid } from '../../common/validate';
import { RegistrationService } from './registration.service';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD').refine((v) => { const d = new Date(v); return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v) && d.getFullYear() >= 1940 && d < new Date(); }, 'Enter a valid date of birth');
const regDto = z.object({ regNo: z.string().trim().min(3).max(40), dateOfBirth: isoDate, email: z.string().email().max(254), password: z.string().min(1).max(256) });
const verifyDto = z.object({ email: z.string().email().max(254), code: z.string().regex(/^\d{6}$/) });
const rosterRow = z.object({ regNo: z.string().trim().min(3).max(40), fullName: z.string().trim().min(2).max(200), dateOfBirth: isoDate, programCode: z.string().trim().min(1).max(40), semester: z.number().int().min(1).max(12), batchYear: z.number().int().min(1990).max(2100) });
const importDto = z.object({ institutionId: uuid, rows: z.array(rosterRow).min(1).max(2000) });

@Controller()
export class RegistrationController {
  constructor(private readonly reg: RegistrationService) {}

  @Public() @Post('auth/register') @HttpCode(200)
  register(@Body() body: unknown, @Req() req: FastifyRequest) { return this.reg.start(parse(regDto, body), req.ip); }

  @Public() @Post('auth/register/verify') @HttpCode(200)
  verify(@Body() body: unknown, @Req() req: FastifyRequest) { const d = parse(verifyDto, body); return this.reg.verify(d.email, d.code, req.ip); }

  @Perm('student.manage') @Post('roster/import') @HttpCode(200)
  import(@CurrentUser() u: AuthUser, @Body() body: unknown, @Req() req: FastifyRequest) { const d = parse(importDto, body); return this.reg.importRoster(u, d.institutionId, d.rows, req.ip); }

  @Perm('student.manage') @Get('roster')
  list(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>) { return this.reg.listRoster(u, parse(page.extend({ institutionId: uuid.optional(), status: z.enum(['claimed', 'unclaimed']).optional(), search: z.string().max(100).optional() }), q)); }
}
