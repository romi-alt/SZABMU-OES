import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { DIFFICULTIES, QUESTION_TYPES } from '@oes/shared';
import { CurrentUser, Ip, Perm, type AuthUser } from '../../common/auth';
import { page, parse, uuid } from '../../common/validate';
import { QuestionsService } from './questions.service';
import { ExamsService } from './exams.service';

const optionDto = z.object({ label: z.enum(['A', 'B', 'C', 'D', 'E']), text: z.string().min(1).max(1000), isCorrect: z.boolean() });
const questionDto = z.object({
  courseId: uuid, institutionId: uuid.optional(), type: z.enum(QUESTION_TYPES).default('MCQ'),
  vignette: z.string().max(4000).optional(), stem: z.string().min(10).max(2000), explanation: z.string().max(4000).optional(),
  difficulty: z.enum(DIFFICULTIES).default('MEDIUM'), tags: z.array(z.string().max(40)).max(10).optional(), options: z.array(optionDto).min(4).max(5),
});
const examDto = z.object({
  code: z.string().min(3).max(40).regex(/^[A-Z0-9-]+$/), title: z.string().min(3).max(200), courseId: uuid, term: z.string().min(3).max(30),
  opensAt: z.coerce.date(), closesAt: z.coerce.date(), durationMin: z.number().int().min(5).max(480), passPercent: z.number().min(0).max(100).default(50),
  negativeMarking: z.number().min(0).max(1).default(0), shuffleQuestions: z.boolean().default(true), instructions: z.string().max(4000).optional(), institutionIds: z.array(uuid).min(1).max(200),
});
const decision = z.object({ decision: z.enum(['APPROVE', 'REJECT']), note: z.string().max(1000).optional() });

@Controller()
export class ExamsController {
  constructor(private readonly questions: QuestionsService, private readonly exams: ExamsService) {}

  // ── question bank ──
  @Perm('question.read') @Get('questions')
  listQ(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>) {
    return this.questions.list(u, parse(page.extend({ courseId: uuid.optional(), institutionId: uuid.optional(), status: z.string().max(20).optional(), difficulty: z.string().max(10).optional(), type: z.string().max(20).optional(), search: z.string().max(100).optional() }), q));
  }
  @Perm('question.read') @Get('questions/:id') getQ(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.questions.get(u, id); }
  @Perm('question.write') @Post('questions') createQ(@CurrentUser() u: AuthUser, @Body() b: unknown, @Ip() ip: string) { return this.questions.create(u, parse(questionDto, b), ip); }
  @Perm('question.write') @Put('questions/:id') updateQ(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown, @Ip() ip: string) { return this.questions.update(u, id, parse(questionDto, b), ip); }
  @Perm('question.write') @Post('questions/:id/submit') submitQ(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) { return this.questions.submit(u, id, ip); }
  @Perm('question.approve') @Post('questions/:id/review') reviewQ(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown, @Ip() ip: string) { const d = parse(decision, b); return this.questions.review(u, id, d.decision, d.note, ip); }
  @Perm('question.write') @Delete('questions/:id') retireQ(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) { return this.questions.retire(u, id, ip); }

  // ── exams ──
  @Perm('exam.read') @Get('exams') listE(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>) { return this.exams.list(u, parse(page.extend({ status: z.string().max(20).optional(), courseId: uuid.optional() }), q)); }
  @Perm('exam.read') @Get('exams/:id') getE(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.exams.load(u, id); }
  @Perm('exam.schedule') @Post('exams') createE(@CurrentUser() u: AuthUser, @Body() b: unknown, @Ip() ip: string) { return this.exams.create(u, parse(examDto, b), ip); }
  @Perm('question.read') @Get('exams/:id/paper') paper(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.exams.paper(u, id, true); }
  @Perm('paper.build') @Put('exams/:id/paper') setPaper(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown, @Ip() ip: string) {
    return this.exams.setPaper(u, id, parse(z.object({ items: z.array(z.object({ questionId: uuid, marks: z.number().positive().max(100) })).min(1).max(300) }), b).items, ip);
  }
  @Perm('paper.build') @Post('exams/:id/paper/submit') submitPaper(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) { return this.exams.submitPaper(u, id, ip); }
  @Perm('paper.approve') @Post('exams/:id/paper/review') reviewPaper(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown, @Ip() ip: string) { const d = parse(decision, b); return this.exams.reviewPaper(u, id, d.decision, d.note, ip); }
  @Perm('exam.schedule') @Post('exams/:id/schedule') schedule(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) { return this.exams.schedule(u, id, ip); }
  @Perm('exam.schedule') @Post('exams/:id/cancel') cancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown, @Ip() ip: string) { return this.exams.cancel(u, id, parse(z.object({ reason: z.string().min(5).max(500) }), b).reason, ip); }
  @Perm('exam.read') @Get('exams/:id/roster') roster(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.exams.roster(u, id); }
  @Perm('enrollment.manage') @Patch('exams/:id/candidates/:studentId') accommodation(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('studentId', ParseUUIDPipe) sid: string, @Body() b: unknown, @Ip() ip: string) {
    return this.exams.setAccommodation(u, id, sid, parse(z.object({ extraTimeMin: z.number().int().min(0).max(120), accommodation: z.string().max(300).optional() }), b), ip);
  }
  @Perm('invigilator.assign') @Post('exams/:id/invigilators') assign(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown, @Ip() ip: string) { return this.exams.assignInvigilator(u, id, parse(z.object({ userId: uuid, institutionId: uuid }), b), ip); }
}
