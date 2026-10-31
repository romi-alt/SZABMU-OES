import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CurrentUser, Ip, Perm, Public, type AuthUser } from '../../common/auth';
import { parse, uuid } from '../../common/validate';
import { AppError } from '../../common/errors';
import { RedisService } from '../../infra/redis.service';
import { ResultsService } from './results.service';

@Controller()
export class ResultsController {
  constructor(private readonly svc: ResultsService, private readonly redis: RedisService) {}

  @Perm('grading.review') @Get('grading/exams') queue(@CurrentUser() u: AuthUser) { return this.svc.gradingQueue(u); }
  @Perm('grading.review') @Get('grading/exams/:id/analysis') analysis(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.itemAnalysis(u, id); }
  @Perm('grading.keyaction') @Post('grading/exams/:id/key-actions') key(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown, @Ip() ip: string) {
    return this.svc.keyAction(u, id, parse(z.object({ examQuestionId: uuid, kind: z.enum(['VOID', 'CHANGE_KEY']), newLabel: z.enum(['A', 'B', 'C', 'D', 'E']).optional(), reason: z.string().min(10).max(500) }), b), ip);
  }
  @Perm('grading.review') @Post('grading/exams/:id/review') @HttpCode(200) review(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown, @Ip() ip: string) { return this.svc.lecturerReview(u, id, parse(z.object({ note: z.string().max(1000).optional() }), b).note, ip); }

  @Perm('result.read_scoped') @Get('results/exams/:id') results(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.examResults(u, id); }
  @Perm('result.approve_examiner') @Post('results/exams/:id/approve') @HttpCode(200) approve(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) { return this.svc.examinerApprove(u, id, ip); }
  @Perm('result.publish') @Post('results/exams/:id/publish') @HttpCode(200) publish(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) { return this.svc.publish(u, id, ip); }

  @Perm('result.read_own') @Get('me/results') mine(@CurrentUser() u: AuthUser) { return this.svc.myResults(u); }
  @Perm('result.read_own') @Get('me/results/:id/certificate') cert(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.myCertificate(u, id); }

  @Public() @Get('public/verify')
  async verify(@Query() q: Record<string, string>, @Req() req: FastifyRequest) {
    if ((await this.redis.hit(`rl:verify:${req.ip}`, 60)) > 20) throw new AppError(429, 'RATE_LIMITED', 'Too many verification attempts');
    const d = parse(z.object({ serial: z.string().min(5).max(40), code: z.string().min(4).max(20) }), q);
    return this.svc.verify(d.serial, d.code);
  }
}
