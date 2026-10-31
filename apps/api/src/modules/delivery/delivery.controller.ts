import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CurrentUser, Perm, type AuthUser } from '../../common/auth';
import { parse } from '../../common/validate';
import { RedisService } from '../../infra/redis.service';
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
const eventDto = z.object({ clientId, kind: z.enum(['TAB_HIDDEN', 'TAB_VISIBLE', 'FULLSCREEN_EXIT', 'OFFLINE', 'ONLINE', 'PASTE_BLOCKED']), detail: z.record(z.string(), z.unknown()).optional() });

@Controller()
export class DeliveryController {
  constructor(private readonly svc: DeliveryService, private readonly redis: RedisService) {}

  @Perm('exam.sit') @Get('me/exams') myExams(@CurrentUser() u: AuthUser) { return this.svc.myExams(u); }

  @Perm('exam.sit') @Post('attempts/start') @HttpCode(200)
  start(@CurrentUser() u: AuthUser, @Body() b: unknown, @Req() req: FastifyRequest) { const d = parse(startDto, b); return this.svc.start(u, d.examId, d.clientId, req.ip, req.headers['user-agent']); }

  @Perm('exam.sit') @Put('attempts/:id/answers/:qid')
  async save(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('qid', ParseUUIDPipe) qid: string, @Body() b: unknown) {
    const d = parse(saveDto, b);
    // Abuse guard only: a human cannot legitimately exceed this; a bug-loop client is throttled instead of hammering the DB.
    if ((await this.redis.hit(`rl:save:${id}`, 10)) > 100) throw new AppError(429, 'RATE_LIMITED', 'Saving too quickly; retry shortly');
    return this.svc.saveAnswer(u, id, qid, d);
  }

  @Perm('exam.sit') @Post('attempts/:id/heartbeat') @HttpCode(200)
  hb(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { const d = parse(z.object({ clientId, online: z.boolean().optional() }), b); return this.svc.heartbeat(u, id, d.clientId, d.online); }

  @Perm('exam.sit') @Post('attempts/:id/events') @HttpCode(200)
  ev(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { const d = parse(eventDto, b); return this.svc.recordEvent(u, id, d.clientId, d.kind, d.detail); }

  @Perm('exam.sit') @Get('attempts/:id/sheet') sheet(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.sheet(u, id); }

  @Perm('exam.sit') @Post('attempts/:id/submit') @HttpCode(200)
  submit(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown, @Req() req: FastifyRequest) { return this.svc.submit(u, id, parse(submitDto, b), req.ip); }

  @Perm('exam.sit') @Get('attempts/:id/receipt') receipt(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.receipt(u, id); }
}
