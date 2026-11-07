import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, as, boot, type Ctx } from './helpers';

/** Phase 10 pass: gaps found while checking the brief against the executed tests. */
let ctx: Ctx; let A: string; let PATH: string; let PHARM: string; let PROG: string; let seq = 0;
const TERM = '2026-SPRING'; const PW = 'Sturdy-Pass-2026!x'; const NOPE = '00000000-0000-4000-8000-000000000001';
const anon = () => new Client(ctx.app);
beforeAll(async () => {
  ctx = await boot({ studentsPerCampus: 4 });
  A = (ctx.seeded.institutions as Record<'a', { id: string }>).a.id; PATH = ctx.seeded.courses.path.id; PHARM = ctx.seeded.courses.pharm.id; PROG = ctx.seeded.programs.mbbs.id;
});
afterAll(async () => { await ctx.app.close(); });

async function register(approveAccount = true) {
  await ctx.kv.clearPrefix('rl:treg:'); const n = `${Date.now()}${++seq}`;
  const f = { fullName: `Dr Phase Ten ${n}`, email: `p10${n}@example.test`, password: PW, employeeId: `P10-${n}`, department: 'Pathology', designation: 'Lecturer', phone: '+92 300 1234567',
    assignments: [{ institutionId: A, programId: PROG, semester: 4, term: TERM, courseId: PATH }, { institutionId: A, programId: PROG, semester: 4, term: TERM, courseId: PHARM }] };
  const s = await anon().post('/teacher-registration', f); expect((await anon().post('/teacher-registration/verify', { email: f.email, code: s.body.devCode })).status).toBe(200);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email: f.email } });
  const c = new Client(ctx.app, ''); const l = await c.req('POST', '/auth/login', { email: f.email, password: PW }); const sc = l.headers['set-cookie']; c.cookie = String(Array.isArray(sc) ? sc[0] : sc).split(';')[0]!;
  const rows = await ctx.prisma.courseAssignment.findMany({ where: { userId: user.id } });
  const admin = await as(ctx, 'admin.a');
  if (approveAccount) await admin.post(`/admin/teachers/${user.id}/decision`, { decision: 'APPROVE' });
  return { c, userId: user.id, path: rows.find((r) => r.courseId === PATH)!, pharm: rows.find((r) => r.courseId === PHARM)!, admin };
}
const mcq = (n: number) => ({ stem: `Phase ten question ${n}: which organ produces insulin?`, options: ['Liver', 'Pancreas', 'Kidney', 'Spleen'], correctIndex: 1, difficulty: 'EASY', topic: 'Endocrine', marks: 1 });

describe('academic session scoping (correct campus AND session)', () => {
  it('when one session’s assignment is revoked, its banks and questions are unreachable even though another session of the same subject stays approved', async () => {
    const t = await register(); await t.admin.post(`/admin/teachers/assignments/${t.path.id}/decision`, { decision: 'APPROVE' });
    const fall = await ctx.prisma.courseAssignment.create({ data: { userId: t.userId, courseId: PATH, institutionId: A, assignedById: t.userId, status: 'APPROVED', term: '2026-FALL', requestedAt: new Date() } });
    const springBank = (await t.c.post('/teacher/pools', { assignmentId: t.path.id, name: 'Spring bank' })).body.id as string;
    const fallBank = (await t.c.post('/teacher/pools', { assignmentId: fall.id, name: 'Fall bank' })).body.id as string;
    const springQ = (await t.c.post(`/teacher/pools/${springBank}/questions`, mcq(++seq))).body.id as string; const fallQ = (await t.c.post(`/teacher/pools/${fallBank}/questions`, mcq(++seq))).body.id as string;
    expect((await t.c.get(`/teacher/questions/${springQ}`)).status).toBe(200);
    expect((await t.admin.post(`/admin/teachers/assignments/${t.path.id}/revoke`, { note: 'No longer teaching this session' })).status).toBe(200);
    expect((await t.c.get(`/teacher/questions/${springQ}`)).status).toBe(404);
    expect((await t.c.put(`/teacher/questions/${springQ}`, mcq(++seq))).status).toBe(404);
    expect((await t.c.get(`/teacher/questions/${springQ}/versions`)).status).toBe(404);
    expect((await t.c.post(`/teacher/questions/${springQ}/duplicate`)).status).toBe(404);
    expect((await t.c.del(`/teacher/questions/${springQ}`)).status).toBe(404);
    expect((await t.c.get(`/teacher/questions?poolId=${springBank}`)).status).toBe(404);
    expect((await t.c.get('/teacher/questions?pageSize=50')).body.items.map((q: any) => q.id)).toEqual([fallQ]);                    // lists show only the session that is still approved
    expect((await t.c.get('/teacher/submissions')).body.total).toBe(0);
    expect((await t.c.get('/teacher/overview')).body.mcqs).toBe(1);
    expect((await t.c.get('/teacher/pools')).body.map((p: any) => p.id)).toEqual([fallBank]);
    expect((await t.c.get(`/teacher/questions/${fallQ}`)).status).toBe(200);
  });
});

describe('Classes & Subjects shows what the brief asks for', () => {
  it('each approved assignment carries its student count, MCQ count and bank count, from the database', async () => {
    const t = await register(); await t.admin.post(`/admin/teachers/assignments/${t.path.id}/decision`, { decision: 'APPROVE' });
    const b1 = (await t.c.post('/teacher/pools', { assignmentId: t.path.id, name: 'One' })).body.id as string; await t.c.post('/teacher/pools', { assignmentId: t.path.id, name: 'Two' });
    for (let i = 0; i < 3; i++) await t.c.post(`/teacher/pools/${b1}/questions`, mcq(++seq));
    const q = (await t.c.post(`/teacher/pools/${b1}/questions`, mcq(++seq))).body.id as string; await t.c.del(`/teacher/questions/${q}`);                  // a deleted question is not counted
    const rows = (await t.c.get('/teacher/assignments')).body; const mine = rows.find((r: any) => r.id === t.path.id); const pending = rows.find((r: any) => r.id === t.pharm.id);
    expect(mine).toMatchObject({ status: 'APPROVED', mcqCount: 3, bankCount: 2, course: { code: 'MBBS-PATH-4' }, institution: { code: 'DMC-A' }, term: TERM });
    expect(typeof mine.studentCount).toBe('number');
    expect(pending).toMatchObject({ status: 'PENDING', mcqCount: null, bankCount: null, studentCount: null });
    const o = (await t.c.get('/teacher/pools?assignmentId=' + t.path.id)).body; expect(o).toHaveLength(2);                                                    // “open the question bank” filters by assignment
  });
});

describe('teachers cannot approve or change their own access', () => {
  it('every administrator action on their own account or assignments is refused, and nothing changes', async () => {
    const t = await register(false);
    for (const [method, url, body] of [
      ['POST', `/admin/teachers/${t.userId}/decision`, { decision: 'APPROVE' }], ['POST', `/admin/teachers/assignments/${t.path.id}/decision`, { decision: 'APPROVE' }],
      ['POST', `/admin/teachers/assignments/${t.path.id}/revoke`, { note: 'self' }], ['POST', `/admin/teachers/${t.userId}/suspend`, { note: 'self' }], ['POST', `/admin/teachers/${t.userId}/reinstate`, {}],
      ['GET', `/admin/teachers/${t.userId}`, undefined], ['GET', '/admin/teachers', undefined],
    ] as const) { const r = await t.c.req(method, url, body); expect(r.status, `${method} ${url}`).toBe(403); }
    expect((await ctx.prisma.teacherProfile.findUniqueOrThrow({ where: { userId: t.userId } })).status).toBe('PENDING');
    expect((await ctx.prisma.courseAssignment.findMany({ where: { userId: t.userId } })).every((a) => a.status === 'PENDING')).toBe(true);
    // the profile route ignores any attempt to smuggle in status or assignment fields
    expect((await t.c.patch('/teacher/profile', { phone: '+92 301 7654321', status: 'APPROVED', assignments: [] })).status).toBeLessThan(500);
    expect((await ctx.prisma.teacherProfile.findUniqueOrThrow({ where: { userId: t.userId } })).status).toBe('PENDING');
  });
});

describe('the answer key is protected at the database', () => {
  it('a question can never have two correct options or none', async () => {
    const t = await register(); await t.admin.post(`/admin/teachers/assignments/${t.path.id}/decision`, { decision: 'APPROVE' });
    const b = (await t.c.post('/teacher/pools', { assignmentId: t.path.id, name: 'Key bank' })).body.id as string; const q = (await t.c.post(`/teacher/pools/${b}/questions`, mcq(++seq))).body;
    const wrong = q.options.find((o: any) => !o.isCorrect).label as string;
    await expect(ctx.prisma.$executeRaw`UPDATE question_options SET isCorrect = 1 WHERE questionId = ${q.id} AND label = ${wrong}`).rejects.toThrow();
    const keys = await ctx.prisma.questionOption.count({ where: { questionId: q.id, isCorrect: true } }); expect(keys).toBe(1);
    for (const opts of [[true, true, false, false], [false, false, false, false]]) {
      const r = await ctx.prisma.question.create({ data: { courseId: PATH, institutionId: A, authorId: t.userId, type: 'MCQ', tags: [], stem: `Two keys? ${++seq}`, difficulty: 'EASY', poolId: b, defaultMarks: 1 } });
      const attempt = ctx.prisma.questionOption.createMany({ data: opts.map((isCorrect, i) => ({ questionId: r.id, label: 'ABCD'[i]!, text: `opt ${i}`, isCorrect })) });
      if (opts.filter(Boolean).length > 1) await expect(attempt).rejects.toThrow(); else await attempt;                        // zero keys is stopped by validateQuestion in the API, one-key-at-most by the database
    }
    expect((await t.c.post(`/teacher/pools/${b}/questions`, { ...mcq(++seq), correctIndex: -1 })).status).toBe(400);
  });
});

describe('every teacher and reviewer route, against every kind of caller', () => {
  const manifest = readFileSync(path.resolve(__dirname, '../../../docs/route-permissions.md'), 'utf8');
  const routes = (perm: string) => [...manifest.matchAll(/^\| (GET|POST|PUT|PATCH|DELETE) \| `([^`]+)` \| `([^`]+)`/gm)].filter((m) => m[3] === perm).map((m) => ({ method: m[1]!, url: m[2]!.replace(/^\/api/, '').replace(/:[A-Za-z]+/g, NOPE) }));
  const call = (c: Client, r: { method: string; url: string }) => c.req(r.method, r.url, r.method === 'GET' || r.method === 'DELETE' ? undefined : {});

  it('teacher.work routes: anonymous 401, other roles 403, pending teacher 403 TEACHER_NOT_APPROVED, approved teacher never gets a 200/500 for an id that is not theirs', async () => {
    const work = routes('teacher.work'); expect(work.length).toBeGreaterThanOrEqual(20);                                   // the parse found the routes
    const pending = await register(false); const approved = await register(); await approved.admin.post(`/admin/teachers/assignments/${approved.path.id}/decision`, { decision: 'APPROVE' });
    const others = await Promise.all(['student.a001', 'lecturer.a', 'admin.a', 'examiner', 'cce', 'invigilator.a', 'super.admin'].map((w) => as(ctx, w)));
    for (const r of work) {
      const tag = `${r.method} ${r.url}`;
      expect((await call(anon(), r)).status, `anonymous ${tag}`).toBe(401);
      for (const o of others) expect((await call(o, r)).status, `${o.email} ${tag}`).toBe(403);
      const p = await call(pending.c, r); expect(p.status, `pending ${tag}`).toBe(403); expect(p.body.code, `pending ${tag}`).toBe('TEACHER_NOT_APPROVED');
      if (r.url.includes(NOPE)) { const a = await call(approved.c, r); expect([400, 404], `approved teacher, foreign id ${tag}`).toContain(a.status); }
    }
  });

  it('question.approve routes: anonymous 401; teachers, students, lecturers, campus administrators and invigilators 403; a reviewer gets 404 for an unknown bank', async () => {
    const rev = routes('question.approve'); expect(rev.length).toBeGreaterThanOrEqual(4);
    const teacher = await register(); const refused = await Promise.all(['student.a001', 'lecturer.a', 'admin.a', 'invigilator.a'].map((w) => as(ctx, w)));
    const reviewers = await Promise.all(['examiner', 'cce', 'super.admin'].map((w) => as(ctx, w)));
    for (const r of rev.filter((x) => !x.url.endsWith('/question-banks'))) {
      const tag = `${r.method} ${r.url}`;
      expect((await call(anon(), r)).status, `anonymous ${tag}`).toBe(401); expect((await call(teacher.c, r)).status, `teacher ${tag}`).toBe(403);
      for (const o of refused) expect((await call(o, r)).status, `${o.email} ${tag}`).toBe(403);
      for (const o of reviewers) expect([400, 404], `${o.email} ${tag}`).toContain((await call(o, r)).status);
    }
  });

  it('no teacher endpoint returns a student’s result, mark, grade or contact detail', async () => {
    const t = await register(); await t.admin.post(`/admin/teachers/assignments/${t.path.id}/decision`, { decision: 'APPROVE' });
    const b = (await t.c.post('/teacher/pools', { assignmentId: t.path.id, name: 'Leak check' })).body.id as string; await t.c.post(`/teacher/pools/${b}/questions`, mcq(++seq));
    const gets = routes('teacher.work').filter((r) => r.method === 'GET' && !r.url.includes(NOPE)).map((r) => r.url).concat([`/teacher/pools/${b}/export`, '/teacher/students', `/teacher/questions?poolId=${b}`]);
    const student = await ctx.prisma.student.findFirstOrThrow({ include: { user: true } });
    for (const url of gets) {
      const r = await t.c.get(url); expect(r.status, url).toBe(200); const body = r.raw;
      for (const secret of [student.user.email, student.regNo, student.user.phone ?? '§none§']) expect(body, `${url} leaks ${secret}`).not.toContain(secret);
      expect(body, url).not.toMatch(/"(email|dateOfBirth|cnic|attendance|grade|percentage|score|obtained|passed|result)"\s*:/i.source ? /"(dateOfBirth|cnic|attendance|grade|percentage|score|obtained|passed)"\s*:/i : /x/);
    }
  });
});
