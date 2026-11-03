import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, as, boot, cid, startExam, type Ctx } from './helpers';

/** One-time student profile after sign-up: catalog, validation, single Student record, locked academic identity, and no eligibility from self-declared data. */
let ctx: Ctx; let A: string; let PROG: string; let BSN: string; let seq = 0;
const PW = 'Sturdy-Pass-2026!x';
beforeAll(async () => { ctx = await boot({ studentsPerCampus: 4 }); ({ a: { id: A } } = ctx.seeded.institutions as Record<'a' | 'b' | 'c', { id: string }>); PROG = ctx.seeded.programs.mbbs.id; BSN = ctx.seeded.programs.bsn.id; });
afterAll(async () => { await ctx.app.close(); });

const clear = async () => { const k = await ctx.redis.client.keys('rl:*'); if (k.length) await ctx.redis.client.del(...k); };
async function signUp(extra: { regNo?: string; email?: string } = {}) {
  await clear(); const n = ++seq; const regNo = extra.regNo ?? `ONB-${n}`; const email = extra.email ?? `onb${n}@example.test`;
  const s = await new Client(ctx.app).post('/auth/register', { regNo, email, password: PW }); expect(s.status, s.raw).toBe(200);
  const c = new Client(ctx.app); const r = await c.req('POST', '/auth/register/verify', { email, code: s.body.devCode }); expect(r.status, r.raw).toBe(200);
  const sc = r.headers['set-cookie']; c.cookie = String(Array.isArray(sc) ? sc[0] : sc).split(';')[0]!;
  return { c, regNo, email, userId: (await ctx.prisma.user.findUniqueOrThrow({ where: { email } })).id };
}
const profile = (extra: Record<string, unknown> = {}) => ({ fullName: 'Amna Test Student', fatherName: 'Tariq Test', gender: 'FEMALE', institutionId: A, programId: PROG, semester: 4, batchYear: 2024, mobile: '+92 300 1234567', ...extra });

describe('catalog', () => {
  it('serves real colleges, programmes per college, semesters per programme and academic years — only to a student', async () => {
    const t = await signUp(); const r = await t.c.get('/onboarding/catalog'); expect(r.status).toBe(200);
    expect(r.body.institutions.map((i: any) => i.code)).toEqual(expect.arrayContaining(['DMC-A', 'DMC-B'])); expect(r.body.programsByInstitution[A]).toContain(PROG); expect(r.body.programsByInstitution[A]).not.toContain(BSN);
    expect(r.body.semestersByProgram[PROG]).toEqual(expect.arrayContaining([1, 4])); expect(r.body.batchYears).toContain(2024);
    expect((await new Client(ctx.app).get('/onboarding/catalog')).status).toBe(401);
    for (const who of ['lecturer.a', 'examiner', 'admin.a']) expect((await (await as(ctx, who)).get('/onboarding/catalog')).status, who).toBe(403);
  });
});

describe('complete profile', () => {
  it('validates on the server and keeps the sign-up usable after every error', async () => {
    const t = await signUp();
    const bad = async (extra: Record<string, unknown>, label: string) => expect((await t.c.post('/onboarding/complete', profile(extra))).status, label).toBe(400);
    await bad({ mobile: 'abc' }, 'phone'); await bad({ fullName: 'Al' }, 'short name'); await bad({ fatherName: '' }, 'father'); await bad({ gender: 'X' }, 'gender'); await bad({ programId: BSN }, 'programme not offered at that college');
    await bad({ semester: 11 }, 'semester outside programme'); await bad({ batchYear: 1980 }, 'year'); await bad({ institutionId: '00000000-0000-4000-8000-000000000000' }, 'unknown college'); await bad({ dateOfBirth: '2999-01-01' }, 'dob');
    await bad({ photo: 'data:image/png;base64,AAAA' }, 'photo');
    expect(await ctx.prisma.student.count({ where: { userId: t.userId } })).toBe(0);
    expect((await t.c.get('/auth/me')).body.onboarding.required).toBe(true);
  });

  it('creates ONE Student record from the reserved registration number, marks the profile complete, and needs no second sign-in', async () => {
    const t = await signUp(); const r = await t.c.post('/onboarding/complete', profile({ dateOfBirth: '2004-03-09' })); expect(r.status, r.raw).toBe(200);
    expect(r.body).toMatchObject({ studentId: expect.any(String), onboarding: null, student: { regNo: t.regNo, semester: 4, selfDeclared: true, fatherName: 'Tariq Test', gender: 'FEMALE', hasPhoto: false } });
    const s = await ctx.prisma.student.findUniqueOrThrow({ where: { userId: t.userId }, include: { user: true } });
    expect(s).toMatchObject({ regNo: t.regNo, institutionId: A, programId: PROG, batchYear: 2024, selfDeclared: true, status: 'ACTIVE' }); expect(s.profileCompletedAt).toBeTruthy(); expect(s.user).toMatchObject({ fullName: 'Amna Test Student', phone: '+92 300 1234567' });
    expect((await ctx.prisma.studentSignup.findUniqueOrThrow({ where: { userId: t.userId } })).completedAt).toBeTruthy(); expect(await ctx.prisma.userInstitution.count({ where: { userId: t.userId, institutionId: A } })).toBe(1);
    expect((await t.c.get('/me/exams')).status).toBe(200);                                                                       // same session; student routes now resolve
    expect(await ctx.prisma.auditLog.count({ where: { action: 'student.profile_completed', entityId: t.userId } })).toBe(1);
    expect((await t.c.post('/onboarding/complete', profile())).status).toBe(409);                                                    // one time only
    expect(await ctx.prisma.student.count({ where: { regNo: t.regNo } })).toBe(1);                                                  // never a duplicate record
  });

  it('stores an optional photo, never serves it in staff lists, and refuses other roles', async () => {
    const t = await signUp(); const png = 'data:image/png;base64,' + Buffer.concat([Buffer.from([0x89]), Buffer.from('PNG\r\n\x1a\n'), Buffer.alloc(60)]).toString('base64');
    const r = await t.c.post('/onboarding/complete', profile({ photo: png })); expect(r.body.student.hasPhoto).toBe(true);
    const list = await (await as(ctx, 'admin.a')).get(`/students?search=${t.regNo}`); expect(list.body.items[0]).toMatchObject({ regNo: t.regNo, selfDeclared: true }); expect(list.raw).not.toContain('"photo"');
    for (const who of ['lecturer.a', 'examiner']) expect((await (await as(ctx, who)).post('/onboarding/complete', profile())).status, who).toBe(403);
    expect((await (await as(ctx, 'student.a002')).post('/onboarding/complete', profile())).status).toBe(403);                      // an existing student has no pending sign-up
  });
});

describe('before the profile is complete', () => {
  it('no student or examination API works, but me, sign-out and recovery do', async () => {
    const t = await signUp();
    for (const u of ['/me/exams', '/me/results']) expect((await t.c.get(u)).status, u).toBe(403);
    expect((await t.c.post('/attempts/start', { examId: ctx.seeded.examId, clientId: cid() })).status).toBe(403);
    expect((await t.c.post('/student/change-request', { note: 'Please move me to semester 5 programme' })).status).toBe(403);
    expect((await t.c.get('/auth/me')).status).toBe(200); expect((await t.c.post('/auth/logout')).status).toBe(200);
    const again = new Client(ctx.app); expect((await again.req('POST', '/auth/login', { email: t.email, password: PW })).status).toBe(200);             // returns to the same state
    expect((await new Client(ctx.app).post('/auth/forgot', { email: t.email })).status).toBe(200);
  });
});

describe('completing the profile grants no eligibility', () => {
  it('shows no examinations, refuses direct attempts, and is skipped by enrolment and rosters until an administrator verifies the placement', async () => {
    const t = await signUp(); await t.c.post('/onboarding/complete', profile()); const sid = (await ctx.prisma.student.findUniqueOrThrow({ where: { userId: t.userId } })).id;
    expect((await t.c.get('/me/exams')).body.items).toEqual([]);
    const start = await t.c.post('/attempts/start', { examId: ctx.seeded.examId, clientId: cid() }); expect(start.status).toBe(403);
    const adm = await as(ctx, 'admin.a'); await adm.post('/enrollments/bulk', { courseId: ctx.seeded.courses.path.id, term: '2026-SPRING', institutionId: A });
    expect(await ctx.prisma.enrollment.count({ where: { studentId: sid } })).toBe(0);                                                  // not swept into the cohort
    expect((await adm.post('/enrollments/bulk', { courseId: ctx.seeded.courses.path.id, term: '2026-SPRING', institutionId: A, studentIds: [sid] })).body.eligibleCohort).toBe(0);
    // even a forced enrolment + candidate row cannot sit the exam while unverified
    await ctx.prisma.enrollment.create({ data: { studentId: sid, courseId: ctx.seeded.courses.path.id, term: '2026-SPRING' } });
    await ctx.prisma.examCandidate.create({ data: { examId: ctx.seeded.examId, studentId: sid, institutionId: A, rosterVersion: 1 } });
    const forced = await t.c.post('/attempts/start', { examId: ctx.seeded.examId, clientId: cid() }); expect(forced.status).toBe(403); expect(forced.body.code).toBe('ACADEMIC_UNVERIFIED');
    // verification by an administrator (campus-scoped, audited) lifts the restriction
    expect((await (await as(ctx, 'admin.b')).patch(`/students/${sid}`, { verify: true })).status).toBe(404);                              // other campus cannot
    expect((await adm.patch(`/students/${sid}`, { verify: true })).status).toBe(200);
    expect((await ctx.prisma.student.findUniqueOrThrow({ where: { id: sid } })).selfDeclared).toBe(false); expect(await ctx.prisma.auditLog.count({ where: { action: 'student.verified', entityId: sid } })).toBe(1);
    expect((await t.c.post('/attempts/start', { examId: ctx.seeded.examId, clientId: cid() })).status).toBe(200);
  });

  it('the student cannot change academic identity: extra fields are ignored, staff routes are refused, and a change is only a request to administrators', async () => {
    const t = await signUp(); await t.c.post('/onboarding/complete', profile()); const sid = (await ctx.prisma.student.findUniqueOrThrow({ where: { userId: t.userId } })).id;
    const r = await t.c.patch('/auth/profile', { phone: '0300-7654321', fatherName: 'Tariq T', institutionId: ctx.seeded.institutions.b.id, programId: BSN, semester: 1, regNo: 'HACK-1', selfDeclared: false, fullName: 'Someone Else' }); expect(r.status).toBe(200);
    expect(await ctx.prisma.student.findUniqueOrThrow({ where: { id: sid } })).toMatchObject({ institutionId: A, programId: PROG, semester: 4, regNo: t.regNo, selfDeclared: true, fatherName: 'Tariq T' });
    expect((await ctx.prisma.user.findUniqueOrThrow({ where: { id: t.userId } })).fullName).toBe('Amna Test Student');
    expect((await t.c.patch(`/students/${sid}`, { verify: true, semester: 1 })).status).toBe(403); expect((await t.c.post('/enrollments/bulk', { courseId: ctx.seeded.courses.path.id, term: '2026-SPRING', institutionId: A })).status).toBe(403);
    expect((await t.c.post('/student/change-request', { note: 'short' })).status).toBe(400);
    expect((await t.c.post('/student/change-request', { note: 'Please correct my semester to 5, I was promoted.' })).status).toBe(200);
    const admin = await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'admin.a@demo.szabmu.invalid' } });
    expect(await ctx.prisma.notification.count({ where: { userId: admin.id, title: 'Student requests an academic change' } })).toBe(1); expect(await ctx.prisma.auditLog.count({ where: { action: 'student.change_requested', entityId: sid } })).toBe(1);
  });
});

describe('existing students are untouched', () => {
  it('seeded students skip onboarding, keep their exams, and an attempt still works', async () => {
    const c = await as(ctx, 'student.a003'); const me = await c.get('/auth/me');
    expect(me.body.onboarding).toBeNull(); expect(me.body.student).toMatchObject({ selfDeclared: false }); expect((await c.get('/me/exams')).body.items.length).toBeGreaterThan(0);
    const s = await startExam(ctx, c); expect(s.questions.length).toBeGreaterThan(0); expect(s.res.raw).not.toMatch(/isCorrect|correctLabel/);
  });
});
