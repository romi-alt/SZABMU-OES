import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, Ip, Perm, type AuthUser } from '../../common/auth';
import { parse, uuid } from '../../common/validate';
import { AuthService } from './auth.service';
import { OnboardingService } from './onboarding.service';

const thisYear = new Date().getFullYear();
const profileDto = z.object({
  fullName: z.string().trim().min(3, 'Enter your full name').max(120), fatherName: z.string().trim().min(3, "Enter your father's name").max(120), gender: z.enum(['MALE', 'FEMALE', 'OTHER']),
  institutionId: uuid, programId: uuid, semester: z.number().int().min(1).max(12), batchYear: z.number().int().min(1990).max(thisYear + 1), mobile: z.string().trim().min(7).max(20),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), photo: z.string().max(300_000).optional(),
});

@Controller()
export class OnboardingController {
  constructor(private readonly svc: OnboardingService, private readonly auth: AuthService) {}
  @Perm('student.self') @Get('onboarding/catalog') catalog() { return this.svc.catalog(); }
  @Perm('student.self') @Post('onboarding/complete') @HttpCode(200)
  async complete(@CurrentUser() u: AuthUser, @Body() b: unknown, @Ip() ip: string) { await this.svc.complete(u, parse(profileDto, b), ip); return this.auth.me(u); }
  @Perm('student.self') @Post('student/change-request') @HttpCode(200)
  change(@CurrentUser() u: AuthUser, @Body() b: unknown, @Ip() ip: string) { return this.svc.requestChange(u, parse(z.object({ note: z.string().trim().min(10, 'Describe what should change (at least 10 characters)').max(500) }), b).note, ip); }
}
