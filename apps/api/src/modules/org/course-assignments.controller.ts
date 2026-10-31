import { Body, Controller, Delete, Get, Ip, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, Perm, type AuthUser } from '../../common/auth';
import { parse } from '../../common/validate';
import { CourseAccessService } from './course-access.service';

const uuid = z.string().uuid();

@Controller()
export class CourseAssignmentsController {
  constructor(private readonly access: CourseAccessService) {}

  @Perm('course.assign') @Post('course-assignments')
  assign(@CurrentUser() u: AuthUser, @Body() b: unknown, @Ip() ip: string) { return this.access.assign(u, parse(z.object({ userId: uuid, courseId: uuid, institutionId: uuid }), b), ip); }

  @Perm('course.assign') @Delete('course-assignments/:id')
  revoke(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) { return this.access.revoke(u, id, ip); }

  @Perm('course.assign') @Get('course-assignments')
  list(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>) {
    const d = parse(z.object({ userId: uuid.optional(), courseId: uuid.optional(), institutionId: uuid.optional(), includeRevoked: z.enum(['true', 'false']).optional() }), q);
    return this.access.list(u, { ...d, includeRevoked: d.includeRevoked === 'true' });
  }

  @Perm('question.read') @Get('me/course-assignments')
  mine(@CurrentUser() u: AuthUser) { return this.access.mine(u); }
}
