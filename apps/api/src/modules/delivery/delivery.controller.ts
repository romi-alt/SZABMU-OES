import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CurrentUser, Perm, type AuthUser } from '../../common/auth';
import { parse } from '../../common/validate';
import { MetricsService } from '../../infra/metrics.service';
import { LocalRateWindow } from '../../common/rate-window';
import { AppError } from '../../common/errors';
import { DeliveryService } from './delivery.service';

const clientId = z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/);
const startDto = z.object({ examId: z.string().uuid(), clientId });
const saveDto = z.object({
  clientId, revision: z.number().int().min(1).max(1_000_000),
  selectedLabel: z.enum(['A', 'B', 'C', 'D', 'E']).nullable(), state: z.enum(['ANSWERED', 'SKIPPED', 'CLEARED']),
  markedForReview: z.boolean(), visited: z.boolean(),
});
const submitDto = z.object({
  clientId, submitKey: z.string().min(8).max(80),
  expected: z.array(z.object({ examQuestionId: z.string().uuid(), revision: z.number().int().min(0), selectedLabel: z.string().nullable() })).max(500).optional(),
});
// detail is optional context only (the exam player sends none): small, flat and bounded so a client cannot fill attempt_events with arbitrary data.
const eventDetail = z.record(z.string().max(40), z.union([z.string().max(200), z.number(), z.boolean(), z.null()])).refine((o) => Object.keys(o).length <= 10, 'At most 10 detail fields');
const eventDto = z.object({ clientId, kind: z.enum(['TAB_HIDDEN', 'TAB_VISIBLE', 'FULLSCREEN_EXIT', 'OFFLINE', 'ONLINE', 'PASTE_BLOCKED']), detail: eventDetail.optional() });

@Controller()
export class DeliveryController {
  private readonly saveGuard = new LocalRateWindow(10_000);
  private readonly eventGuard = new LocalRateWindow(60_000);
  constructor(private readonly svc: DeliveryService, private readonly metrics: MetricsService) {}

  @Perm('exam.sit') @Get('me/exams') myExams(@CurrentUser() u: AuthUser) { return this.svc.myExams(u); }

  @Perm('exam.sit') @Post('attempts/start') @HttpCode(200)
  start(@CurrentUser() u: AuthUser, @Body() b: unknown, @Req() req: FastifyRequest) { const d = parse(startDto, b); return this.svc.start(u, d.examId, d.clientId, req.ip, req.headers['user-agent']); }

  @Perm('exam.sit') @Put('attempts/:id/answers/:qid')
  async save(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('qid', ParseUUIDPipe) qid: string, @Body() b: unknown) {
    const t0 = process.hrtime.bigint();
    try {
      const d = parse(saveDto, b);
      // Abuse guard only: a human cannot legitimately exceed this; a bug-loop client is throttled instead of hammering the DB.
      if (this.saveGuard.hit(id) > 100) throw new AppError(429, 'RATE_LIMITED', 'Saving too quickly; retry shortly');   // in-process: no Redis round trip per save
      const r = await this.svc.saveAnswer(u, id, qid, d);
      this.metrics.saves.inc({ result: (r as { duplicate?: boolean }).duplicate ? 'duplicate' : 'ok' });
      return r;
    } catch (e) {
      this.metrics.saves.inc({ result: MetricsService.outcome(e) });
      throw e;
    } finally { this.metrics.saveDuration.observe({}, Number(process.hrtime.bigint() - t0) / 1e9); }
  }

  @Perm('exam.sit') @Post('attempts/:id/heartbeat') @HttpCode(200)
  hb(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { const d = parse(z.object({ clientId, online: z.boolean().optional() }), b); return this.svc.heartbeat(u, id, d.clientId, d.online); }

  @Perm('exam.sit') @Post('attempts/:id/events') @HttpCode(200)
  ev(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    const d = parse(eventDto, b);
    // Integrity events are weak context, never evidence on their own; a looping or hostile client must not flood the journal (2 writes per event).
    if (this.eventGuard.hit(id) > 60) throw new AppError(429, 'RATE_LIMITED', 'Too many events; retry shortly');
    return this.svc.recordEvent(u, id, d.clientId, d.kind, d.detail);
  }

  @Perm('exam.sit') @Get('attempts/:id/sheet') sheet(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.sheet(u, id); }

  @Perm('exam.sit') @Post('attempts/:id/submit') @HttpCode(200)
  async submit(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown, @Req() req: FastifyRequest) {
    const t0 = process.hrtime.bigint();
    try {
      const r = await this.svc.submit(u, id, parse(submitDto, b), req.ip);
      this.metrics.submits.inc({ result: (r as { replayed?: boolean }).replayed ? 'replayed' : 'ok' });
      return r;
    } catch (e) {
      this.metrics.submits.inc({ result: MetricsService.outcome(e) });
      throw e;
    } finally { this.metrics.submitDuration.observe({}, Number(process.hrtime.bigint() - t0) / 1e9); }
  }

  @Perm('exam.sit') @Get('attempts/:id/receipt') receipt(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.receipt(u, id); }
}
