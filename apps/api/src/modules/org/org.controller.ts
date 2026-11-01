import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { ROLES, INSTITUTION_TYPES } from '@oes/shared';
import { CurrentUser, Ip, Perm, type AuthUser } from '../../common/auth';
import { page, parse, uuid } from '../../common/validate';
import { OrgService } from './org.service';

const role = z.enum(ROLES);
const instCode = z.string().min(2).max(20).regex(/^[A-Z0-9-]+$/);
const instName = z.string().min(3).max(200);
const instAffiliation = z.enum(['CONSTITUENT', 'AFFILIATED']);
const instCity = z.string().max(100);
const instDto = z.object({ code: instCode, name: instName, type: z.enum(INSTITUTION_TYPES), affiliation: instAffiliation.default('CONSTITUENT'), city: instCity.optional() });
/**
 * PATCH semantics: a field that is not sent is never touched. This schema is deliberately NOT derived from `instDto.partial()` —
 * zod keeps `.default()` on partial fields, which silently injected affiliation=CONSTITUENT into every partial update (UI-002).
 */
const instPatch = z.object({ code: instCode.optional(), name: instName.optional(), type: z.enum(INSTITUTION_TYPES).optional(), affiliation: instAffiliation.optional(), city: instCity.optional(), active: z.boolean().optional() });
const deptDto = z.object({ code: z.string().min(1).max(20), name: z.string().min(2).max(200) });
const programDto = z.object({ code: z.string().min(2).max(20), name: z.string().min(2).max(200), durationYrs: z.number().int().min(1).max(8), level: z.string().max(40).optional() });
const courseDto = z.object({ code: z.string().min(2).max(30), title: z.string().min(2).max(200), semester: z.number().int().min(1).max(12), credits: z.number().int().min(0).max(30).optional() });
const userDto = z.object({ email: z.string().email().max(254), fullName: z.string().min(2).max(200), role, institutionIds: z.array(uuid).max(50), phone: z.string().max(30).optional() });
const userPatch = z.object({ active: z.boolean().optional(), institutionIds: z.array(uuid).max(50).optional(), fullName: z.string().min(2).max(200).optional() });
const studentDto = z.object({ email: z.string().email().max(254), fullName: z.string().min(2).max(200), institutionId: uuid, programId: uuid, regNo: z.string().min(3).max(40), semester: z.number().int().min(1).max(12), batchYear: z.number().int().min(1990).max(2100), dateOfBirth: z.string().date().optional() });
const importDto = z.object({ institutionId: uuid, rows: z.array(studentDto.omit({ institutionId: true, dateOfBirth: true })).min(1).max(1000) });
const studentPatch = z.object({ semester: z.number().int().min(1).max(12).optional(), status: z.enum(['ACTIVE', 'SUSPENDED', 'GRADUATED', 'WITHDRAWN']).optional(), address: z.string().max(300).optional(), guardianPhone: z.string().max(30).optional() });
const enrolDto = z.object({ courseId: uuid, term: z.string().min(3).max(30), institutionId: uuid, studentIds: z.array(uuid).max(5000).optional() });

@Controller()
export class OrgController {
  constructor(private readonly org: OrgService) {}

  @Perm('institution.read') @Get('institutions') institutions(@CurrentUser() u: AuthUser) { return this.org.listInstitutions(u); }
  @Perm('institution.manage') @Post('institutions') createInst(@CurrentUser() u: AuthUser, @Body() b: unknown, @Ip() ip: string) { return this.org.createInstitution(u, parse(instDto, b), ip); }
  @Perm('institution.manage') @Patch('institutions/:id') updInst(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown, @Ip() ip: string) { return this.org.updateInstitution(u, id, parse(instPatch, b), ip); }
  @Perm('institution.read') @Get('institutions/:id/departments') deps(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.org.listDepartments(u, id); }
  @Perm('department.manage') @Post('institutions/:id/departments') addDep(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown, @Ip() ip: string) { return this.org.createDepartment(u, id, parse(deptDto, b), ip); }

  @Perm('program.read') @Get('programs') programs() { return this.org.listPrograms(); }
  @Perm('program.manage') @Post('programs') addProgram(@CurrentUser() u: AuthUser, @Body() b: unknown, @Ip() ip: string) { return this.org.createProgram(u, parse(programDto, b), ip); }
  @Perm('program.manage') @Post('programs/:id/courses') addCourse(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown, @Ip() ip: string) { return this.org.createCourse(u, id, parse(courseDto, b), ip); }
  @Perm('program.read') @Get('courses') courses(@Query() q: Record<string, string>) { const d = parse(z.object({ programId: uuid.optional(), semester: z.coerce.number().int().optional() }), q); return this.org.listCourses(d.programId, d.semester); }

  @Perm('user.manage') @Get('users') users(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>) { return this.org.listUsers(u, parse(page.extend({ role: role.optional(), institutionId: uuid.optional(), search: z.string().max(100).optional() }), q)); }
  @Perm('user.manage') @Post('users') addUser(@CurrentUser() u: AuthUser, @Body() b: unknown, @Ip() ip: string) { return this.org.createUser(u, parse(userDto, b), ip); }
  @Perm('user.manage') @Patch('users/:id') patchUser(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown, @Ip() ip: string) { return this.org.updateUser(u, id, parse(userPatch, b), ip); }
  @Perm('user.manage') @Post('users/:id/reset-password') resetPw(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) { return this.org.resetUserPassword(u, id, ip); }

  @Perm('student.read') @Get('students') students(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>) { return this.org.listStudents(u, parse(page.extend({ institutionId: uuid.optional(), programId: uuid.optional(), semester: z.coerce.number().int().optional(), search: z.string().max(100).optional() }), q)); }
  @Perm('student.manage') @Post('students') addStudent(@CurrentUser() u: AuthUser, @Body() b: unknown, @Ip() ip: string) { return this.org.createStudent(u, parse(studentDto, b), ip); }
  @Perm('student.manage') @Post('students/import') importStudents(@CurrentUser() u: AuthUser, @Body() b: unknown, @Ip() ip: string) { const d = parse(importDto, b); return this.org.importStudents(u, d.institutionId, d.rows, ip); }
  @Perm('student.manage') @Patch('students/:id') patchStudent(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown, @Ip() ip: string) { return this.org.updateStudent(u, id, parse(studentPatch, b), ip); }

  @Perm('enrollment.manage') @Post('enrollments/bulk') enrol(@CurrentUser() u: AuthUser, @Body() b: unknown, @Ip() ip: string) { return this.org.enrol(u, parse(enrolDto, b), ip); }
  @Perm('student.read') @Get('enrollments') enrollments(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>) { return this.org.listEnrollments(u, parse(z.object({ courseId: uuid, term: z.string().min(3), institutionId: uuid.optional() }), q)); }
  @Perm('enrollment.manage') @Patch('enrollments/:id/attendance') att(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown, @Ip() ip: string) { return this.org.setAttendance(u, id, parse(z.object({ attendancePct: z.number().min(0).max(100) }), b).attendancePct, ip); }
  @Perm('eligibility.override') @Post('enrollments/:id/condone') condone(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown, @Ip() ip: string) { return this.org.condone(u, id, parse(z.object({ note: z.string().min(5).max(500) }), b).note, ip); }
}
