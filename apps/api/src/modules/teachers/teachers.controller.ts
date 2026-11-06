import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Patch, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CurrentUser, Ip, Perm, Public, type AuthUser } from '../../common/auth';
import { page, parse, uuid } from '../../common/validate';
import { TeacherRegistrationService } from './teacher-registration.service';
import { TeacherService } from './teacher.service';
import { TeacherAdminService } from './teacher-admin.service';
import { BankReviewService } from './bank-review.service';

const phone = z.string().trim().min(7).max(20);
const assignmentReq = z.object({ institutionId: uuid, programId: uuid, semester: z.number().int().min(1).max(12), term: z.string().trim().regex(/^[A-Za-z0-9 _-]{3,30}$/), courseId: uuid });
const regDto = z.object({
  fullName: z.string().trim().min(3).max(120), email: z.string().trim().email().max(254), password: z.string().min(1).max(256),
  employeeId: z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9._/-]+$/, 'Use letters, digits and . _ / - only'), department: z.string().trim().min(2).max(120), designation: z.string().trim().min(2).max(120), phone,
  photo: z.string().max(300_000).optional(), assignments: z.array(assignmentReq).min(1).max(30),
});
const verifyDto = z.object({ email: z.string().email().max(254), code: z.string().regex(/^\d{6}$/) });
const mcq = z.object({
  stem: z.string().trim().min(3).max(2000), options: z.array(z.string().trim().min(1).max(500)).min(4).max(5), correctIndex: z.number().int().min(0).max(4),
  explanation: z.string().trim().max(2000).optional(), difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']), topic: z.string().trim().max(120).optional(), subtopic: z.string().trim().max(120).nullable().optional(), bloom: z.enum(['REMEMBER', 'UNDERSTAND', 'APPLY', 'ANALYZE', 'EVALUATE', 'CREATE']).nullable().optional(), imageId: uuid.nullable().optional(), marks: z.number().positive().max(100).default(1),
});
const importRow = z.object({ statement: z.string().max(2000), options: z.array(z.string().max(500)).max(5), correct: z.string().max(3), explanation: z.string().max(2000).optional(), difficulty: z.string().max(10).optional(), topic: z.string().max(120).optional(), subtopic: z.string().max(200).optional(), bloom: z.string().max(20).optional(), marks: z.number().optional() });
const decision = z.object({ decision: z.enum(['APPROVE', 'REJECT']), note: z.string().trim().max(1000).optional() });
const reason = z.object({ note: z.string().trim().min(5, 'Give a reason of at least 5 characters').max(1000) });

/** Public part of registration (sign-up happens before an account exists). Read-only catalog + the two registration steps. */
@Controller()
export class TeacherRegistrationController {
  constructor(private readonly reg: TeacherRegistrationService) {}
  @Public() @Get('teacher-registration/catalog') catalog(@Req() req: FastifyRequest) { return this.reg.catalogFor(req.ip); }
  @Public() @Post('teacher-registration') @HttpCode(200) start(@Body() b: unknown, @Req() req: FastifyRequest) { return this.reg.start(parse(regDto, b), req.ip); }
  @Public() @Post('teacher-registration/verify') @HttpCode(200) verify(@Body() b: unknown, @Req() req: FastifyRequest) { const d = parse(verifyDto, b); return this.reg.verify(d.email, d.code, req.ip); }
}

/** The teacher's own workspace. `teacher.work` routes additionally require an APPROVED profile and APPROVED assignments (service layer, per request). */
@Controller('teacher')
export class TeacherController {
  constructor(private readonly t: TeacherService) {}
  @Perm('teacher.self') @Get('status') status(@CurrentUser() u: AuthUser) { return this.t.status(u); }
  @Perm('teacher.self') @Get('profile') profile(@CurrentUser() u: AuthUser) { return this.t.profile(u); }
  @Perm('teacher.self') @Patch('profile') updateProfile(@CurrentUser() u: AuthUser, @Body() b: unknown, @Ip() ip: string) {
    return this.t.updateProfile(u, parse(z.object({ phone: phone.optional(), department: z.string().trim().min(2).max(120).optional(), designation: z.string().trim().min(2).max(120).optional(), photo: z.string().max(300_000).nullable().optional() }), b), ip);
  }
  @Perm('teacher.work') @Get('overview') overview(@CurrentUser() u: AuthUser) { return this.t.overview(u); }
  @Perm('teacher.work') @Get('assignments') assignments(@CurrentUser() u: AuthUser) { return this.t.assignments(u); }
  @Perm('teacher.work') @Get('submissions') submissions(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>) { return this.t.submissions(u, parse(page.extend({ status: z.enum(['SUBMITTED', 'APPROVED', 'REJECTED']).optional() }), q)); }
  @Perm('teacher.work') @Get('students') students(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>) { return this.t.students(u, parse(page.extend({ assignmentId: uuid.optional(), search: z.string().trim().max(100).optional() }), q)); }

  @Perm('teacher.work') @Get('pools') pools(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>) { return this.t.pools(u, parse(z.object({ assignmentId: uuid.optional() }), q)); }
  @Perm('teacher.work') @Post('pools') createPool(@CurrentUser() u: AuthUser, @Body() b: unknown, @Ip() ip: string) { return this.t.createPool(u, parse(z.object({ assignmentId: uuid, name: z.string().trim().min(2).max(120), description: z.string().trim().max(500).optional() }), b), ip); }
  @Perm('teacher.work') @Patch('pools/:id') updatePool(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown, @Ip() ip: string) { return this.t.updatePool(u, id, parse(z.object({ name: z.string().trim().min(2).max(120).optional(), description: z.string().trim().max(500).nullable().optional() }), b), ip); }
  @Perm('teacher.work') @Delete('pools/:id') deletePool(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) { return this.t.deletePool(u, id, ip); }
  @Perm('teacher.work') @Post('pools/:id/submit') @HttpCode(200) submitPool(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) { return this.t.submitPool(u, id, ip); }
  @Perm('teacher.work') @Post('pools/:id/questions') createQ(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown, @Ip() ip: string) { return this.t.createQuestion(u, id, parse(mcq, b), ip); }
  @Perm('teacher.work') @Post('pools/:id/import') @HttpCode(200) importQ(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown, @Ip() ip: string) { return this.t.importQuestions(u, id, parse(z.object({ rows: z.array(importRow).min(1).max(500) }), b).rows, ip); }
  @Perm('teacher.work') @Get('pools/:id/export') exportQ(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) { return this.t.exportPool(u, id, ip); }

  @Perm('teacher.work') @Post('images') uploadImage(@CurrentUser() u: AuthUser, @Body() b: unknown, @Ip() ip: string) { return this.t.uploadImage(u, parse(z.object({ data: z.string().max(1_500_000) }), b).data, ip); }
  @Perm('teacher.work') @Get('images/:id') getImage(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.t.getImage(u, id); }

  @Perm('teacher.work') @Get('questions') listQ(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>) {
    return this.t.listQuestions(u, parse(page.extend({ poolId: uuid.optional(), assignmentId: uuid.optional(), topic: z.string().max(120).optional(), difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']).optional(), status: z.enum(['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED']).optional(), search: z.string().trim().max(100).optional() }), q));
  }
  @Perm('teacher.work') @Get('questions/:id/versions') versionsQ(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.t.versions(u, id); }
  @Perm('teacher.work') @Get('questions/:id') getQ(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.t.getQuestion(u, id); }
  @Perm('teacher.work') @Put('questions/:id') updateQ(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown, @Ip() ip: string) { return this.t.updateQuestion(u, id, parse(mcq, b), ip); }
  @Perm('teacher.work') @Delete('questions/:id') deleteQ(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) { return this.t.deleteQuestion(u, id, ip); }
  @Perm('teacher.work') @Post('questions/:id/duplicate') duplicateQ(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) { return this.t.duplicateQuestion(u, id, ip); }
  @Perm('teacher.work') @Post('questions/:id/submit') @HttpCode(200) submitQ(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) { return this.t.submitQuestion(u, id, ip); }
}

/** Administrator side: queue, directory, decisions, suspension. Scoped to the administrator's institutions in the service. */
@Controller('admin/teachers')
export class TeacherAdminController {
  constructor(private readonly a: TeacherAdminService) {}
  @Perm('teacher.manage') @Get() list(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>) { return this.a.list(u, parse(page.extend({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED']).optional(), search: z.string().trim().max(100).optional() }), q)); }
  @Perm('teacher.manage') @Get(':userId') detail(@CurrentUser() u: AuthUser, @Param('userId', ParseUUIDPipe) id: string) { return this.a.detail(u, id); }
  @Perm('teacher.manage') @Get(':userId/activity') activity(@CurrentUser() u: AuthUser, @Param('userId', ParseUUIDPipe) id: string) { return this.a.activity(u, id); }
  @Perm('teacher.manage') @Get(':userId/pools') pools(@CurrentUser() u: AuthUser, @Param('userId', ParseUUIDPipe) id: string) { return this.a.pools(u, id); }
  @Perm('teacher.manage') @Post(':userId/decision') @HttpCode(200) decide(@CurrentUser() u: AuthUser, @Param('userId', ParseUUIDPipe) id: string, @Body() b: unknown, @Ip() ip: string) { const d = parse(decision, b); return this.a.decide(u, id, d.decision, d.note, ip); }
  @Perm('teacher.manage') @Post(':userId/suspend') @HttpCode(200) suspend(@CurrentUser() u: AuthUser, @Param('userId', ParseUUIDPipe) id: string, @Body() b: unknown, @Ip() ip: string) { return this.a.suspend(u, id, parse(reason, b).note, ip); }
  @Perm('teacher.manage') @Post(':userId/reinstate') @HttpCode(200) reinstate(@CurrentUser() u: AuthUser, @Param('userId', ParseUUIDPipe) id: string, @Body() b: unknown, @Ip() ip: string) { return this.a.reinstate(u, id, parse(z.object({ note: z.string().trim().max(1000).optional() }), b).note, ip); }
  @Perm('teacher.manage') @Post('assignments/:id/decision') @HttpCode(200) decideA(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown, @Ip() ip: string) { const d = parse(decision, b); return this.a.decideAssignment(u, id, d.decision, d.note, ip); }
  @Perm('teacher.manage') @Post('assignments/:id/revoke') @HttpCode(200) revokeA(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown, @Ip() ip: string) { return this.a.revokeAssignment(u, id, parse(reason, b).note, ip); }
}

const bankDecision = z.enum(['APPROVE', 'REJECT']);
const bankReview = z.object({ decision: bankDecision.optional(), note: z.string().trim().max(2000).optional(), items: z.array(z.object({ questionId: uuid, decision: bankDecision, note: z.string().trim().max(2000).optional() })).min(1).max(500).optional() })
  .refine((d) => !!d.decision !== !!d.items, { message: 'Send either a decision for the whole bank or a decision for each question' });

/** Examiner / administrator side of teacher question banks (question.approve): queue, detail with answer keys, decisions. */
@Controller('question-banks')
export class QuestionBanksController {
  constructor(private readonly b: BankReviewService) {}
  @Perm('question.approve') @Get() list(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>) { return this.b.list(u, parse(page.extend({ status: z.enum(['SUBMITTED', 'APPROVED', 'REJECTED']).optional(), search: z.string().trim().max(100).optional() }), q)); }
  @Perm('question.approve') @Get(':id') detail(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.b.detail(u, id); }
  @Perm('question.approve') @Get(':id/images/:imageId') image(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('imageId', ParseUUIDPipe) imageId: string) { return this.b.image(u, id, imageId); }
  @Perm('question.approve') @Post(':id/review') @HttpCode(200) review(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown, @Ip() ip: string) { return this.b.review(u, id, parse(bankReview, b), ip); }
}
