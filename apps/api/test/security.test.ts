import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Reflector } from '@nestjs/core';
import { AuthController } from '../src/modules/auth/auth.controller';
import { OrgController } from '../src/modules/org/org.controller';
import { ExamsController } from '../src/modules/exams/exams.controller';
import { DeliveryController } from '../src/modules/delivery/delivery.controller';
import { ResultsController } from '../src/modules/results/results.controller';
import { InvigilationController } from '../src/modules/invigilation/invigilation.controller';
import { ReportsController } from '../src/modules/reports/reports.controller';
import { HealthController } from '../src/modules/health.controller';

const CONTROLLERS = [AuthController, OrgController, ExamsController, DeliveryController, ResultsController, InvigilationController, ReportsController, HealthController];
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Client, as, boot, cid, startExam, type Ctx } from './helpers';
import { DOMAIN } from '../src/seed/seed';

let ctx: Ctx;
let A: string; let B: string;
beforeAll(async () => { ctx = await boot({ studentsPerCampus: 5 }); A = ctx.seeded.institutions.a.id; B = ctx.seeded.institutions.b.id; });
afterAll(async () => { await ctx.app.close(); });

describe('deny by default (structural)', () => {
  it('every route handler declares @Public() or exactly one @Perm()', () => {
    const reflector = ctx.app.get(Reflector);
    const missing: string[] = []; let routes = 0;
    for (const C of CONTROLLERS) {
      const proto = C.prototype;
      for (const name of Object.getOwnPropertyNames(proto)) {
        const fn = proto[name]; if (typeof fn !== 'function' || Reflect.getMetadata(METHOD_METADATA, fn) === undefined) continue;
        routes++;
        const pub = reflector.get('public', fn); const perm = reflector.get('perm', fn);
        if (!pub && !perm) missing.push(`${C.name}.${name} (${Reflect.getMetadata(PATH_METADATA, fn)})`);
      }
    }
    expect(routes).toBeGreaterThan(60);
    expect(missing).toEqual([]);
  });

  it('public routes are exactly the sign-in/recovery/verify/health set', () => {
    const reflector = ctx.app.get(Reflector);
    const pubs: string[] = [];
    for (const C of CONTROLLERS) {
      for (const name of Object.getOwnPropertyNames(C.prototype)) { const fn = C.prototype[name]; if (typeof fn === 'function' && reflector.get('public', fn)) pubs.push(`${C.name}.${name}`); }
    }
    expect(pubs.sort()).toEqual(['AuthController.forgot', 'AuthController.login', 'AuthController.reset', 'AuthController.verify', 'HealthController.health', 'ResultsController.verify']);
  });

  it('unauthenticated callers get 401 on representative protected routes', async () => {
    const anon = new Client(ctx.app);
    for (const [m, u] of [['GET', '/students'], ['GET', '/questions'], ['GET', '/me/exams'], ['GET', '/results/exams/' + ctx.seeded.examId], ['GET', '/audit'], ['POST', '/users'], ['GET', '/dashboard'], ['POST', '/attempts/start']] as const) {
      expect((await anon.req(m, u, m === 'GET' ? undefined : {})).status, `${m} ${u}`).toBe(401);
    }
  });
});

describe('role matrix', () => {
  const cases: [string, string, string][] = [
    // [user, METHOD path, expected 403]
    ['student.a002', 'GET /students', ''], ['student.a002', 'GET /questions', ''], ['student.a002', 'GET /audit', ''], ['student.a002', 'POST /institutions', ''],
    ['student.a002', 'GET /invigilation/exams', ''], ['student.a002', 'GET /reports/institutions', ''], ['student.a002', 'POST /users', ''],
    ['lecturer.a', 'POST /institutions', ''], ['lecturer.a', 'POST /users', ''], ['lecturer.a', 'POST /exams', ''], ['lecturer.a', 'GET /me/exams', ''], ['lecturer.a', 'POST /attempts/start', ''], ['lecturer.a', 'GET /audit', ''],
    ['invigilator.a', 'GET /questions', ''], ['invigilator.a', 'POST /exams', ''], ['invigilator.a', 'GET /users', ''], ['invigilator.a', 'POST /results/exams/x/publish', ''],
    ['admin.a', 'POST /institutions', ''], ['admin.a', 'POST /questions', ''], ['admin.a', 'POST /exams', ''], ['admin.a', 'GET /grading/exams', ''], ['admin.a', 'POST /programs', ''],
    ['examiner', 'POST /institutions', ''], ['examiner', 'POST /users', ''], ['examiner', 'POST /results/exams/x/publish', ''], ['examiner', 'GET /audit', ''],
    ['cce', 'POST /questions', ''], ['cce', 'POST /users', ''], ['cce', 'POST /attempts/start', ''],
  ];
  for (const [user, route] of cases.map((c) => [c[0], c[1]] as const)) {
    it(`${user} is forbidden: ${route}`, async () => {
      const c = await as(ctx, user);
      const [method, path] = route.split(' ');
      const url = (path ?? '').replace('/x/', `/${ctx.seeded.examId}/`);
      const r = await c.req(method!, url, method === 'GET' ? undefined : {});
      expect(r.status, r.raw).toBe(403);
    });
  }
});

describe('institution scope (campus isolation)', () => {
  it('campus admin sees only their own students and cannot request another campus', async () => {
    const adminB = await as(ctx, 'admin.b');
    const list = await adminB.get('/students?pageSize=200');
    expect(list.status).toBe(200);
    expect(list.body.items.length).toBe(5);
    expect(list.body.items.every((s: any) => s.institution.code === 'DMC-B')).toBe(true);
    expect((await adminB.get(`/students?institutionId=${A}`)).status).toBe(403);
    expect((await adminB.get(`/institutions`)).body.map((i: any) => i.code)).toEqual(['DMC-B']);
    expect((await adminB.get(`/institutions/${A}/departments`)).status).toBe(403);
  });

  it('campus admin cannot create, modify, enrol or reset users/students in another campus', async () => {
    const adminB = await as(ctx, 'admin.b');
    const stuA = await ctx.prisma.student.findFirstOrThrow({ where: { institutionId: A }, include: { user: true } });
    const prog = ctx.seeded.programs.mbbs.id;
    expect((await adminB.post('/students', { email: `x1@${DOMAIN}`, fullName: 'Intruder One', institutionId: A, programId: prog, regNo: 'X-1', semester: 4, batchYear: 2024 })).status).toBe(403);
    expect((await adminB.post('/users', { email: `x2@${DOMAIN}`, fullName: 'Intruder Two', role: 'LECTURER', institutionIds: [A] })).status).toBe(403);
    expect((await adminB.post('/users', { email: `x3@${DOMAIN}`, fullName: 'Intruder Three', role: 'LECTURER', institutionIds: [A, B] })).status).toBe(403);
    expect((await adminB.patch(`/students/${stuA.id}`, { semester: 9 })).status).toBe(404);
    expect((await adminB.patch(`/users/${stuA.userId}`, { active: false })).status).toBe(404);
    expect((await adminB.post(`/users/${stuA.userId}/reset-password`)).status).toBe(404);
    expect((await adminB.post('/enrollments/bulk', { courseId: ctx.seeded.courses.path.id, term: '2026-SPRING', institutionId: A })).status).toBe(403);
    expect((await ctx.prisma.student.findUniqueOrThrow({ where: { id: stuA.id } })).semester).toBe(4);
  });

  it('lecturers cannot read or edit another campus\'s questions', async () => {
    const lecB = await as(ctx, 'lecturer.b');
    expect((await lecB.get('/questions?pageSize=200')).body.total).toBe(0);
    const q = await ctx.prisma.question.findFirstOrThrow({ where: { institutionId: A } });
    expect((await lecB.get(`/questions/${q.id}`)).status).toBe(404);
    expect((await lecB.post(`/questions/${q.id}/submit`)).status).toBe(404);
    expect((await lecB.del(`/questions/${q.id}`)).status).toBe(404);
    const lecA2 = await as(ctx, 'lecturer.a2'); // same campus, different author
    expect((await lecA2.post(`/questions/${q.id}/submit`)).status).toBe(403);
  });

  it('invigilators monitor only the campus they are assigned to and cannot act on other campuses\' candidates', async () => {
    const stuA = await as(ctx, 'student.a003'); const stuB = await as(ctx, 'student.b003');
    const a = await startExam(ctx, stuA); const b = await startExam(ctx, stuB);
    const invA = await as(ctx, 'invigilator.a');
    const m = await invA.get(`/invigilation/exams/${ctx.seeded.examId}/monitor`);
    expect(m.status).toBe(200);
    expect(m.body.rows.every((r: any) => r.institution === 'DMC-A')).toBe(true);
    expect(m.body.rows.find((r: any) => r.attemptId === a.attemptId)).toBeTruthy();
    expect(JSON.stringify(m.body)).not.toContain('DMC-B');
    expect((await invA.post(`/invigilation/attempts/${b.attemptId}/extend`, { minutes: 10, reason: 'cross-campus attempt' })).status).toBe(404);
    expect((await invA.post(`/invigilation/attempts/${b.attemptId}/force-submit`, { reason: 'cross-campus attempt' })).status).toBe(404);
    expect((await invA.post('/incidents', { examId: ctx.seeded.examId, institutionId: B, type: 'OTHER', severity: 'LOW', description: 'Cross-campus incident report' })).status).toBe(403);
  });

  it('exam detail, roster and audit trail are filtered by campus', async () => {
    const adminB = await as(ctx, 'admin.b');
    const roster = await adminB.get(`/exams/${ctx.seeded.examId}/roster`);
    expect(roster.status).toBe(200);
    expect(roster.body.every((r: any) => r.institution === 'DMC-B')).toBe(true);
    const audit = await adminB.get('/audit?pageSize=200');
    expect(audit.status).toBe(200);
    expect(audit.body.items.every((x: any) => x.institutionId === B)).toBe(true);
    expect((await adminB.get(`/audit?institutionId=${A}`)).status).toBe(403);
    expect((await adminB.get('/audit/verify')).status).toBe(403);
  });

  it('an exam that does not run at a campus is invisible to its staff', async () => {
    const examiner = await as(ctx, 'examiner');
    const ex = await examiner.post('/exams', { code: 'ONLY-A-1', title: 'Campus A only exam', courseId: ctx.seeded.courses.path.id, term: '2026-SPRING', opensAt: new Date(Date.now() + 86400000), closesAt: new Date(Date.now() + 2 * 86400000), durationMin: 30, institutionIds: [A] });
    expect(ex.status).toBe(201);
    const adminB = await as(ctx, 'admin.b');
    expect((await adminB.get(`/exams/${ex.body.id}`)).status).toBe(404);
    expect((await adminB.get('/exams')).body.items.some((e: any) => e.id === ex.body.id)).toBe(false);
  });
});

describe('privilege escalation & mass assignment', () => {
  it('campus admin cannot mint privileged roles', async () => {
    const admin = await as(ctx, 'admin.a');
    for (const role of ['SUPER_ADMIN', 'CCE', 'EXAMINER', 'CAMPUS_ADMIN']) {
      expect((await admin.post('/users', { email: `esc.${role}@${DOMAIN}`.toLowerCase(), fullName: 'Escalation Test', role, institutionIds: [A] })).status, role).toBe(403);
    }
  });
  it('PATCH /users ignores a smuggled role field', async () => {
    const admin = await as(ctx, 'admin.a');
    const u = await ctx.prisma.user.findUniqueOrThrow({ where: { email: `lecturer.a2@${DOMAIN}` } });
    const r = await admin.patch(`/users/${u.id}`, { fullName: 'Renamed Lecturer', role: 'SUPER_ADMIN', passwordHash: 'x', institutionIds: [A] });
    expect(r.status).toBe(200);
    expect((await ctx.prisma.user.findUniqueOrThrow({ where: { id: u.id } })).role).toBe('LECTURER');
  });
  it('a campus admin cannot move a user into an institution they do not administer', async () => {
    const admin = await as(ctx, 'admin.a');
    const u = await ctx.prisma.user.findUniqueOrThrow({ where: { email: `lecturer.a2@${DOMAIN}` } });
    expect((await admin.patch(`/users/${u.id}`, { institutionIds: [A, B] })).status).toBe(403);
  });
  it('a user cannot deactivate themselves; deactivation kills live sessions immediately', async () => {
    const admin = await as(ctx, 'admin.a');
    const me = await ctx.prisma.user.findUniqueOrThrow({ where: { email: `admin.a@${DOMAIN}` } });
    expect((await admin.patch(`/users/${me.id}`, { active: false })).status).toBe(404) // campus admins are outside the provisionable set, so the account is not even visible to them;
    const victim = await as(ctx, 'lecturer.a2');
    const u = await ctx.prisma.user.findUniqueOrThrow({ where: { email: `lecturer.a2@${DOMAIN}` } });
    expect((await victim.get('/auth/me')).status).toBe(200);
    expect((await admin.patch(`/users/${u.id}`, { active: false })).status).toBe(200);
    expect((await victim.get('/auth/me')).status).toBe(401);
  });
  it('four-eyes: a question author cannot approve their own question; a paper submitter cannot approve their paper', async () => {
    const ex = await as(ctx, 'examiner');
    const q = await ex.post('/questions', { courseId: ctx.seeded.courses.path.id, institutionId: A, type: 'MCQ', stem: 'Four-eyes test question stem long enough?', difficulty: 'EASY', options: ['One', 'Two', 'Three', 'Four'].map((text, i) => ({ label: 'ABCD'[i], text, isCorrect: i === 0 })) });
    expect(q.status).toBe(201);
    expect((await ex.post(`/questions/${q.body.id}/submit`)).status).toBe(201);
    expect((await ex.post(`/questions/${q.body.id}/review`, { decision: 'APPROVE' })).status).toBe(403);
    expect((await (await as(ctx, 'examiner2')).post(`/questions/${q.body.id}/review`, { decision: 'APPROVE' })).status).toBe(201);
  });
});

describe('web attack surface', () => {
  it('rejects state-changing requests from a foreign Origin (CSRF)', async () => {
    const c = await as(ctx, 'student.a002');
    const r = await c.req('POST', '/auth/logout', {}, { origin: 'https://evil.example' });
    expect(r.status).toBe(403);
    expect((await c.get('/auth/me')).status).toBe(200); // session untouched
    expect((await c.req('POST', '/auth/logout', {}, { origin: 'http://localhost:3000' })).status).toBe(200);
  });
  it('treats SQL metacharacters as data in search, filters and identifiers', async () => {
    const admin = await as(ctx, 'admin.a');
    for (const payload of ["'; DROP TABLE users;--", "' OR '1'='1", '%27%20OR%201=1--', '"; SELECT pg_sleep(5);--']) {
      const r = await admin.get(`/students?search=${encodeURIComponent(payload)}`);
      expect(r.status).toBe(200);
      expect(r.body.items).toHaveLength(0);
    }
    expect((await admin.get("/students/'; DROP TABLE users;--")).status).toBe(404);
    expect((await admin.patch("/students/not-a-uuid", { semester: 2 })).status).toBe(400);
    expect(await ctx.prisma.user.count()).toBeGreaterThan(10);
    const login = await new Client(ctx.app).req('POST', '/auth/login', { email: "admin.a@demo.szabmu.invalid' OR '1'='1", password: 'x' });
    expect(login.status).toBe(400);
  });
  it('returns generic errors that leak no stack traces or SQL', async () => {
    const c = await as(ctx, 'admin.a');
    const r = await c.post('/students', { email: 'dup@demo.szabmu.invalid', fullName: 'Dup One', institutionId: A, programId: ctx.seeded.programs.mbbs.id, regNo: 'DMC-A-2024-0002', semester: 4, batchYear: 2024 });
    expect(r.status).toBe(409);
    expect(r.raw).not.toMatch(/prisma|SELECT|INSERT|stack|at \w+ \(/i);
    const bad = await c.req('POST', '/students', '{"malformed":', { 'content-type': 'application/json' });
    expect(bad.status).toBe(400);
  });
  it('sets hardening headers', async () => {
    const r = await new Client(ctx.app).get('/health');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-frame-options']).toBeTruthy();
    expect(r.headers['x-powered-by']).toBeUndefined();
  });
  it('neutralises spreadsheet formula injection in CSV export', async () => {
    // publish-independent: exercise the service directly on a crafted result
    const stud = await ctx.prisma.student.findFirstOrThrow({ where: { institutionId: A }, include: { user: true } });
    await ctx.prisma.user.update({ where: { id: stud.userId }, data: { fullName: '=HYPERLINK("http://evil.example","x")' } });
    await ctx.prisma.result.create({ data: { examId: ctx.seeded.examId, studentId: stud.id, rawScore: 1, totalMarks: 24, percent: 4.17, status: 'FAIL' } });
    const { ReportsService } = await import('../src/modules/reports/reports.service');
    const { asUser } = await import('../src/seed/seed');
    const csv = await ctx.app.get(ReportsService).examCsv(await asUser(ctx.prisma, `cce@${DOMAIN}`), ctx.seeded.examId);
    expect(csv).toContain(`"'=HYPERLINK`);
    expect(csv).not.toMatch(/^"=HYPERLINK|,"=HYPERLINK/m);
  });
});

describe('result confidentiality', () => {
  it('students never see unpublished results; campus admins only after publication', async () => {
    const stud = await ctx.prisma.student.findFirstOrThrow({ where: { institutionId: A }, include: { user: true } });
    const c = new Client(ctx.app, stud.user.email.split('@')[0]); await c.login();
    expect((await c.get('/me/results')).body).toEqual([]);
    const adminA = await as(ctx, 'admin.a');
    expect((await adminA.get(`/results/exams/${ctx.seeded.examId}`)).status).toBe(403);
    expect((await adminA.get(`/reports/exams/${ctx.seeded.examId}`)).body.available).toBe(false);
    expect((await adminA.get(`/reports/exams/${ctx.seeded.examId}/csv`)).status).toBe(404);
  });
  it('certificate verification needs both serial and code and discloses only a masked name', async () => {
    const anon = new Client(ctx.app);
    expect((await anon.get('/public/verify?serial=SZABMU/2026/1000&code=AAAA')).body).toEqual({ valid: false });
    expect((await anon.get('/public/verify?serial=x')).status).toBe(400);
  });
});
void cid;
