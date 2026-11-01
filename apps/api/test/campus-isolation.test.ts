import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, boot, type Client, type Ctx } from './helpers';

/**
 * Campus data scoping for reports and aggregates (audit defect D-09: GET /reports/institutions returned every campus to a
 * Campus Admin). These tests assert on the ACTUAL RESPONSE BODIES: a 200 is only acceptable when it contains nothing
 * from a campus the caller is not assigned to.
 */
let ctx: Ctx; let A: string; let B: string; let C: string;
const NAME_B = 'Demo Medical College B'; const NAME_C = 'Demo College of Nursing C';
beforeAll(async () => {
  ctx = await boot({ studentsPerCampus: 5 });
  ({ a: { id: A }, b: { id: B }, c: { id: C } } = ctx.seeded.institutions as Record<'a' | 'b' | 'c', { id: string }>);
});
afterAll(async () => { await ctx.app.close(); });

const leaks = (raw: string, ...tokens: string[]) => tokens.filter((t) => raw.includes(t));
const othersOf = (own: 'A' | 'B') => own === 'A' ? [B, 'DMC-B', NAME_B, C, 'DNC-C', NAME_C] : [A, 'DMC-A', 'Demo Medical College A', C, 'DNC-C', NAME_C];
const codes = (body: { code: string }[]) => body.map((r) => r.code).sort();

describe('GET /reports/institutions — institution aggregate scoping', () => {
  it('1. a campus admin receives their own campus aggregate', async () => {
    const r = await (await as(ctx, 'admin.a')).get('/reports/institutions');
    expect(r.status).toBe(200);
    expect(codes(r.body)).toEqual(['DMC-A']);
    expect(r.body[0].students).toBeGreaterThan(0);
  });

  it('2/3. …and never another campus or the university-wide list (verified on the response body)', async () => {
    const r = await (await as(ctx, 'admin.a')).get('/reports/institutions');
    expect(leaks(r.raw, ...othersOf('A'))).toEqual([]);
    const rb = await (await as(ctx, 'admin.b')).get('/reports/institutions');
    expect(codes(rb.body)).toEqual(['DMC-B']);
    expect(leaks(rb.raw, ...othersOf('B'))).toEqual([]);
  });

  it('4. naming another campus with institutionId is refused (403) and discloses nothing', async () => {
    const admin = await as(ctx, 'admin.a');
    const r = await admin.get(`/reports/institutions?institutionId=${B}`);
    expect(r.status).toBe(403);
    expect(leaks(r.raw, B, 'DMC-B', NAME_B)).toEqual([]);
    const own = await admin.get(`/reports/institutions?institutionId=${A}`);
    expect(own.status).toBe(200); expect(codes(own.body)).toEqual(['DMC-A']);
    expect((await admin.get('/reports/institutions?institutionId=not-a-uuid')).status).toBe(400);
  });

  it('5. an unknown campusId/scope parameter cannot widen the result', async () => {
    const admin = await as(ctx, 'admin.a');
    for (const q of [`campusId=${B}`, 'scope=all', 'all=true', `institutionIds=${B},${C}`, `institutionId[]=${B}`]) {
      const r = await admin.get(`/reports/institutions?${q}`);
      if (r.status === 200) { expect(codes(r.body)).toEqual(['DMC-A']); expect(leaks(r.raw, ...othersOf('A'))).toEqual([]); }
      else expect([400, 403]).toContain(r.status);
    }
  });

  it('6/7. a user with two approved campuses sees exactly those two; revoking one removes it immediately', async () => {
    const sa = await as(ctx, 'super.admin');
    const adminUser = await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'admin.a@demo.szabmu.invalid' } });
    expect((await sa.patch(`/users/${adminUser.id}`, { institutionIds: [A, B] })).status).toBe(200);
    try {
    const two = await as(ctx, 'admin.a');
    const r2 = await two.get('/reports/institutions');
    expect(codes(r2.body)).toEqual(['DMC-A', 'DMC-B']);
    expect(leaks(r2.raw, C, 'DNC-C', NAME_C)).toEqual([]);
    expect((await two.get(`/reports/institutions?institutionId=${B}`)).status).toBe(200);

    expect((await sa.patch(`/users/${adminUser.id}`, { institutionIds: [A] })).status).toBe(200);
    const stale = await two.get('/reports/institutions');                    // the old session must not keep campus B
    expect([200, 401]).toContain(stale.status);
    if (stale.status === 200) expect(codes(stale.body)).toEqual(['DMC-A']);
    expect(leaks(stale.raw, B, 'DMC-B', NAME_B)).toEqual([]);
    expect((await two.get(`/reports/institutions?institutionId=${B}`)).status).not.toBe(200);
    const fresh = await as(ctx, 'admin.a');
    expect(codes((await fresh.get('/reports/institutions')).body)).toEqual(['DMC-A']);
    } finally { await sa.patch(`/users/${adminUser.id}`, { institutionIds: [A] }); }   // never leave shared fixtures widened
  });

  it('8. university-level roles keep their authority: CCE, examiner and super admin see all campuses; narrowing by institutionId works', async () => {
    for (const who of ['cce', 'examiner', 'super.admin']) {
      const c = await as(ctx, who);
      expect(codes((await c.get('/reports/institutions')).body)).toEqual(['DMC-A', 'DMC-B', 'DNC-C']);
      expect(codes((await c.get(`/reports/institutions?institutionId=${B}`)).body)).toEqual(['DMC-B']);
    }
  });

  it('roles without report.read are refused outright', async () => {
    for (const who of ['lecturer.a', 'invigilator.a']) expect((await (await as(ctx, who)).get('/reports/institutions')).status).toBe(403);
    const stu = await as(ctx, 'student.a001'); expect((await stu.get('/reports/institutions')).status).toBe(403);
  });

  it('10. unauthenticated requests are rejected', async () => {
    const anon = await (async () => { const c = await as(ctx, 'admin.a'); c.cookie = ''; return c; })();
    for (const url of ['/reports/institutions', `/reports/exams/${ctx.seeded.examId}`, `/reports/exams/${ctx.seeded.examId}/csv`, '/dashboard']) expect((await anon.get(url)).status).toBe(401);
  });
});

describe('exports and exam reports follow the same scope', () => {
  beforeAll(async () => {
    // publish synthetic results for one student per campus so exports have content
    const examId = ctx.seeded.examId;
    const students = await ctx.prisma.student.findMany({ where: { regNo: { in: ['DMC-A-2024-0001', 'DMC-B-2024-0001'] } } });
    expect(students.length).toBe(2);
    for (const s of students) await ctx.prisma.result.create({ data: { examId, studentId: s.id, rawScore: 12, totalMarks: 24, percent: 50, status: 'PASS' } });
    await ctx.prisma.resultBatch.upsert({ where: { examId }, create: { examId, status: 'PUBLISHED' }, update: { status: 'PUBLISHED' } });
    await ctx.prisma.exam.update({ where: { id: examId }, data: { status: 'PUBLISHED' } });
  });

  it('9. CSV export contains only the caller\'s campus; CCE sees both', async () => {
    const examId = ctx.seeded.examId;
    const a = await (await as(ctx, 'admin.a')).get(`/reports/exams/${examId}/csv`);
    expect(a.status).toBe(200);
    expect(a.raw).toContain('DMC-A-2024-0001'); expect(leaks(a.raw, 'DMC-B-', 'DNC-C')).toEqual([]);
    const b = await (await as(ctx, 'admin.b')).get(`/reports/exams/${examId}/csv`);
    expect(b.raw).toContain('DMC-B-2024-0001'); expect(leaks(b.raw, 'DMC-A-', 'DNC-C')).toEqual([]);
    const cce = await (await as(ctx, 'cce')).get(`/reports/exams/${examId}/csv`);
    expect(cce.raw).toContain('DMC-A-2024-0001'); expect(cce.raw).toContain('DMC-B-2024-0001');
  });

  it('9. the exam report aggregate and the results list are campus-filtered', async () => {
    const examId = ctx.seeded.examId;
    const a = await (await as(ctx, 'admin.a')).get(`/reports/exams/${examId}`);
    expect(a.status).toBe(200); expect(codes(a.body.byInstitution)).toEqual(['DMC-A']); expect(a.body.candidates).toBe(1);
    expect(leaks(a.raw, ...othersOf('A'))).toEqual([]);
    const res = await (await as(ctx, 'admin.a')).get(`/results/exams/${examId}`);
    expect(leaks(res.raw, 'DMC-B-', 'DNC-C', NAME_B)).toEqual([]);
  });

  it('dashboard aggregates for a campus admin count only their campus', async () => {
    const d = await (await as(ctx, 'admin.a')).get('/dashboard');
    const [studentsA, studentsAll] = await Promise.all([ctx.prisma.student.count({ where: { institutionId: A } }), ctx.prisma.student.count()]);
    expect(studentsAll).toBeGreaterThan(studentsA);
    expect(d.body.students).toBe(studentsA);
  });
});

describe('every GET route, called as a campus-scoped user, discloses no other campus (structural sweep)', () => {
  const urls = (examId: string) => [
    '/dashboard', '/students', '/students?q=DMC', '/users', '/exams', `/exams/${examId}`, `/exams/${examId}/roster`, `/exams/${examId}/roster-versions`,
    '/enrollments', '/incidents', '/institutions', `/institutions/${A}/departments`, '/audit', '/notifications', '/course-assignments', '/invigilation/exams',
    `/invigilation/exams/${examId}/monitor`, '/reports/institutions', '/questions', '/programs', '/courses', '/grading/exams', '/me/course-assignments', '/results/exams/EXAM',
  ];
  for (const [who, own] of [['admin.a', 'A'], ['admin.b', 'B'], ['invigilator.a', 'A'], ['invigilator.b', 'B'], ['lecturer.a', 'A'], ['lecturer.b', 'B']] as const) {
    it(`${who} (campus ${own}): no foreign campus id, code or name appears in any list/aggregate response`, async () => {
      const c: Client = await as(ctx, who);
      const bad: string[] = [];
      for (const u of urls(ctx.seeded.examId).map((x) => x.replace('EXAM', ctx.seeded.examId))) {
        const r = await c.get(u);
        if (r.status !== 200) continue;
        const l = leaks(r.raw, ...othersOf(own));
        if (l.length) bad.push(`${u} → ${l.join(', ')}`);
      }
      expect(bad).toEqual([]);
    });
  }
});
