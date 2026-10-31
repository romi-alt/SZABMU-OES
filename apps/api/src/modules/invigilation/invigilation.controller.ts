import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { INCIDENT_TYPES } from '@oes/shared';
import { CurrentUser, Ip, Perm, type AuthUser } from '../../common/auth';
import { parse, uuid } from '../../common/validate';
import { InvigilationService } from './invigilation.service';

const reportDto = z.object({ examId: uuid, institutionId: uuid, attemptId: uuid.optional(), studentId: uuid.optional(), type: z.enum(INCIDENT_TYPES), severity: z.enum(['LOW', 'MEDIUM', 'HIGH']).default('LOW'), description: z.string().min(10).max(2000) });

@Controller()
export class InvigilationController {
  constructor(private readonly svc: InvigilationService) {}

  @Perm('invigilation.monitor') @Get('invigilation/exams') duties(@CurrentUser() u: AuthUser) { return this.svc.duties(u); }
  @Perm('invigilation.monitor') @Get('invigilation/exams/:id/monitor') monitor(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.monitor(u, id); }
  @Perm('invigilation.intervene') @Post('invigilation/attempts/:id/extend') @HttpCode(200)
  extend(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown, @Ip() ip: string) { const d = parse(z.object({ minutes: z.number().int().min(1).max(60), reason: z.string().min(5).max(500) }), b); return this.svc.extend(u, id, d.minutes, d.reason, ip); }
  @Perm('invigilation.intervene') @Post('invigilation/attempts/:id/force-submit') @HttpCode(200)
  force(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown, @Ip() ip: string) { return this.svc.forceSubmit(u, id, parse(z.object({ reason: z.string().min(5).max(500) }), b).reason, ip); }

  @Perm('incident.report') @Post('incidents') report(@CurrentUser() u: AuthUser, @Body() b: unknown, @Ip() ip: string) { return this.svc.report(u, parse(reportDto, b), ip); }
  @Perm('invigilation.monitor') @Get('incidents') list(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>) { return this.svc.listIncidents(u, parse(z.object({ examId: uuid.optional(), status: z.string().max(20).optional() }), q)); }
  @Perm('incident.report') @Post('incidents/:id/notes') note(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.svc.addNote(u, id, parse(z.object({ body: z.string().min(2).max(2000) }), b).body); }
  @Perm('incident.resolve') @Patch('incidents/:id') resolve(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown, @Ip() ip: string) { const d = parse(z.object({ status: z.enum(['INVESTIGATING', 'RESOLVED', 'DISMISSED']), resolution: z.string().max(2000).optional() }), b); return this.svc.resolve(u, id, d.status, d.resolution, ip); }
}
