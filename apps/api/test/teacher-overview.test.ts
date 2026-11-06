import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, as, boot, type Ctx } from './helpers';

/** Teacher overview figures, recent activity and the Question Submissions list: every number comes from the database, scoped to the caller. */
let ctx: Ctx; let A: string; let PATH: string; let PROG: string; let seq = 0;
const TERM = '2026-SPRING'; const PW = 'Sturdy-Pass-2026!x';
const anon = () => new Client(ctx.app);
beforeAll(async () => {
  ctx = await boot({ studentsPerCampus: 4 });
  A = (ctx.seeded.institutions as Record<'a', { id: string }>).a.id; PATH = ctx.seeded.courses.path.id; PROG = ctx.seeded.programs.mbbs.id;
});
afterAll(async () => { await ctx.app.close(); });

async function teacher(approve = true) {
  await ctx.kv.clearPrefix('rl:treg:'); const n = `${Date.now()}${++seq}`;
  const f = { fullName: `Dr Overview ${n}`, email: `ov${n}@example.test`, password: PW, employeeId: `OV-${n}`, department: 'Pathology', designation: 'Lecturer', phone: '+92 300 1234567', assignments: [{ institutionId: A, programId: PROG, semester: 4, term: TERM, courseId: PATH }] };
  const s = await anon().post('/teacher-registration', f); expect((await anon().post('/teacher-registration/verify', { email: f.email, code: s.body.devCode })).status).toBe(200);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email: f.email } });
  const c = new Client(ctx.app, ''); const l = await c.req('POST', '/auth/login', { email: f.email, password: PW }); const sc = l.headers['set-cookie']; c.cookie = String(Array.isArray(sc) ? sc[0] : sc).split(';')[0]!;
  const row = await ctx.prisma.courseAssignment.findFirstOrThrow({ where: { userId: user.id } });
  if (approve) { const a = await as(ctx, 'admin.a'); await a.post(`/admin/teachers/${user.id}/decision`, { decision: 'APPROVE' }); await a.post(`/admin/teachers/assignments/${row.id}/decision`, { decision: 'APPROVE' }); }
  return { c, assignmentId: row.id };
}
const mcq = (n: number) => ({ stem: `Overview question ${n}: which organ produces insulin?`, options: ['Liver', 'Pancreas', 'Kidney', 'Spleen'], correctIndex: 1, difficulty: 'EASY', topic: 'Endocrine', marks: 1 });
const bank = async (t: Awaited<ReturnType<typeof teacher>>, name: string, n: number) => {
  const id = (await t.c.post('/teacher/pools', { assignmentId: t.assignmentId, name })).body.id as string; const qs: string[] = [];
  for (let i = 0; i < n; i++) qs.push((await t.c.post(`/teacher/pools/${id}/questions`, mcq(++seq))).body.id as string);
  return { id, qs };
};

describe('overview and submissions are computed from the database', () => {
  it('counts questions and banks by state, lists recent activity (submitted / reviewed), and shows reviewer feedback in Question Submissions', async () => {
    const t = await teacher(); const ex = await as(ctx, 'examiner');
    const before = (await t.c.get('/teacher/overview')).body;
    expect(before).toMatchObject({ classes: 1, subjects: 1, mcqs: 0, questions: { draft: 0, submitted: 0, approved: 0, rejected: 0 }, banks: { total: 0, empty: 0, draft: 0, submitted: 0, approved: 0, rejected: 0 }, recent: [] });

    const a = await bank(t, 'Bank A', 2); const b = await bank(t, 'Bank B', 1); await bank(t, 'Bank C (empty)', 0); const d = await bank(t, 'Bank D', 1); const e = await bank(t, 'Bank E', 1);
    for (const x of [a, d, e]) expect((await t.c.post(`/teacher/pools/${x.id}/submit`)).status).toBe(200);
    expect([200, 201]).toContain((await ex.post(`/questions/${a.qs[0]}/review`, { decision: 'APPROVE' })).status);
    expect([200, 201]).toContain((await ex.post(`/questions/${a.qs[1]}/review`, { decision: 'REJECT', note: 'Option C is also defensible' })).status);
    expect([200, 201]).toContain((await ex.post(`/questions/${e.qs[0]}/review`, { decision: 'APPROVE' })).status);

    const ov = (await t.c.get('/teacher/overview')).body;
    expect(ov).toMatchObject({ mcqs: 5, questions: { draft: 1, submitted: 1, approved: 2, rejected: 1 }, banks: { total: 5, empty: 1, draft: 1, submitted: 1, approved: 1, rejected: 1 } });
    // derived bank state: any submitted → SUBMITTED; else any rejected → REJECTED; else any draft → DRAFT; else all approved → APPROVED
    expect(ov.recent.length).toBeGreaterThan(0); expect(ov.recent.length).toBeLessThanOrEqual(8);
    const times = ov.recent.map((r: any) => +new Date(r.at)); expect(times).toEqual([...times].sort((x, y) => y - x));
    expect(ov.recent).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'SUBMITTED', bank: expect.objectContaining({ name: 'Bank D' }), count: 1 }),
      expect.objectContaining({ kind: 'REVIEWED', decision: 'REJECTED', bank: expect.objectContaining({ name: 'Bank A' }), count: 1 }),
      expect.objectContaining({ kind: 'REVIEWED', decision: 'APPROVED', bank: expect.objectContaining({ name: 'Bank E' }), count: 1 }),
    ]));
    expect((await t.c.get('/teacher/pools')).body.find((p: any) => p.id === b.id).state).toBe('DRAFT');

    const sub = (await t.c.get('/teacher/submissions')).body;
    expect(sub.counts).toEqual({ SUBMITTED: 1, APPROVED: 2, REJECTED: 1 }); expect(sub.total).toBe(4);
    expect(sub.items.map((i: any) => i.status).sort()).toEqual(['APPROVED', 'APPROVED', 'REJECTED', 'SUBMITTED']);     // drafts are not submissions
    const rej = sub.items.find((i: any) => i.status === 'REJECTED'); expect(rej).toMatchObject({ reviewNote: 'Option C is also defensible', pool: { name: 'Bank A' }, course: 'MBBS-PATH-4' });
    expect(JSON.stringify(sub)).not.toMatch(/isCorrect|correct/i);                                                     // no answer key in the list
    expect((await t.c.get('/teacher/submissions?status=REJECTED')).body.total).toBe(1);
    expect((await t.c.get('/teacher/submissions?status=DRAFT')).status).toBe(400);
  });

  it('is private to the caller and unavailable to a pending teacher', async () => {
    const other = await teacher(); const pending = await teacher(false);
    expect((await other.c.get('/teacher/overview')).body).toMatchObject({ mcqs: 0, banks: { total: 0 }, recent: [] });
    expect((await other.c.get('/teacher/submissions')).body).toMatchObject({ total: 0, items: [] });
    for (const u of ['/teacher/overview', '/teacher/submissions']) { const r = await pending.c.get(u); expect(r.status, u).toBe(403); expect(r.body.code).toBe('TEACHER_NOT_APPROVED'); }
    expect((await (await as(ctx, 'student.a001')).get('/teacher/submissions')).status).toBe(403);
  });
});
