import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, as, boot, type Ctx } from './helpers';

/** Teacher portal step 5: reviewer dashboard count and notification, teacher activity history for administrators, examiners picking approved teacher MCQs. */
let ctx: Ctx; let A: string; let PATH: string; let PROG: string; let seq = 0;
const TERM = '2026-SPRING'; const PW = 'Sturdy-Pass-2026!x';
const anon = () => new Client(ctx.app);
beforeAll(async () => {
  ctx = await boot({ studentsPerCampus: 4 });
  A = (ctx.seeded.institutions as Record<'a', { id: string }>).a.id; PATH = ctx.seeded.courses.path.id; PROG = ctx.seeded.programs.mbbs.id;
});
afterAll(async () => { await ctx.app.close(); });

async function teacher() {
  await ctx.kv.clearPrefix('rl:treg:'); const n = `${Date.now()}${++seq}`;
  const f = { fullName: `Dr Admin View ${n}`, email: `av${n}@example.test`, password: PW, employeeId: `AV-${n}`, department: 'Pathology', designation: 'Lecturer', phone: '+92 300 1234567', assignments: [{ institutionId: A, programId: PROG, semester: 4, term: TERM, courseId: PATH }] };
  const s = await anon().post('/teacher-registration', f); expect((await anon().post('/teacher-registration/verify', { email: f.email, code: s.body.devCode })).status).toBe(200);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email: f.email } });
  const c = new Client(ctx.app, ''); const l = await c.req('POST', '/auth/login', { email: f.email, password: PW }); const sc = l.headers['set-cookie']; c.cookie = String(Array.isArray(sc) ? sc[0] : sc).split(';')[0]!;
  const row = await ctx.prisma.courseAssignment.findFirstOrThrow({ where: { userId: user.id } });
  const a = await as(ctx, 'admin.a'); await a.post(`/admin/teachers/${user.id}/decision`, { decision: 'APPROVE' }); await a.post(`/admin/teachers/assignments/${row.id}/decision`, { decision: 'APPROVE' });
  return { c, userId: user.id, assignmentId: row.id };
}
const mcq = (n: number) => ({ stem: `Admin view question ${n}: which organ produces insulin?`, options: ['Liver', 'Pancreas', 'Kidney', 'Spleen'], correctIndex: 1, difficulty: 'EASY', topic: 'Endocrine', marks: 1 });
async function bank(t: Awaited<ReturnType<typeof teacher>>, count = 2, name = `Bank ${++seq}`) {
  const id = (await t.c.post('/teacher/pools', { assignmentId: t.assignmentId, name })).body.id as string; const qs: string[] = [];
  for (let i = 0; i < count; i++) qs.push((await t.c.post(`/teacher/pools/${id}/questions`, mcq(++seq))).body.id as string);
  return { id, qs };
}

describe('reviewer dashboard and notification', () => {
  it('examiner and CCE dashboards count submitted banks; examiners are told with a link to the queue; nobody else gets the field', async () => {
    const ex = await as(ctx, 'examiner'); const cce = await as(ctx, 'cce');
    const base = (await ex.get('/dashboard')).body.banksToReview as number; expect(typeof base).toBe('number'); expect((await cce.get('/dashboard')).body.banksToReview).toBe(base);
    const t = await teacher(); const b = await bank(t, 2); expect((await ex.get('/dashboard')).body.banksToReview).toBe(base);          // a draft is not counted
    await t.c.post(`/teacher/pools/${b.id}/submit`);
    expect((await ex.get('/dashboard')).body.banksToReview).toBe(base + 1); expect((await cce.get('/dashboard')).body.banksToReview).toBe(base + 1);
    const exId = (await ctx.prisma.user.findFirstOrThrow({ where: { email: 'examiner@demo.szabmu.invalid' } })).id;
    expect(await ctx.prisma.notification.count({ where: { userId: exId, title: 'Question bank awaiting review', link: '/question-banks' } })).toBeGreaterThan(0);
    await ex.post(`/question-banks/${b.id}/review`, { decision: 'APPROVE' }); expect((await ex.get('/dashboard')).body.banksToReview).toBe(base);
    for (const who of ['admin.a', 'lecturer.a', 'invigilator.a', 'student.a001']) expect((await (await as(ctx, who)).get('/dashboard')).body.banksToReview, who).toBeUndefined();
  });
});

describe('teacher activity history for administrators', () => {
  it('shows a teacher’s bank and question activity and the reviewers’ decisions, scoped to the administrator’s campus', async () => {
    const t = await teacher(); const b = await bank(t, 2, 'Activity bank'); const ex = await as(ctx, 'examiner');
    await t.c.post('/teacher/images', { data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' });
    await t.c.put(`/teacher/questions/${b.qs[0]}`, mcq(++seq)); await t.c.post(`/teacher/pools/${b.id}/submit`);
    await ex.post(`/question-banks/${b.id}/review`, { decision: 'REJECT', note: 'Please tighten the stems' });
    const a = await as(ctx, 'admin.a'); const r = await a.get(`/admin/teachers/${t.userId}/activity`); expect(r.status).toBe(200);
    expect(r.body.summary).toMatchObject({ banks: { total: 1, rejected: 1 }, questions: { rejected: 2, draft: 0, submitted: 0, approved: 0 } });
    const acts = r.body.items.map((i: any) => i.action); expect(acts).toEqual(expect.arrayContaining(['pool.create', 'question.create', 'question.update', 'question.submit', 'question_pool.review']));
    const rev = r.body.items.find((i: any) => i.action === 'question_pool.review'); expect(rev).toMatchObject({ actor: { name: expect.stringMatching(/./), role: 'EXAMINER' }, bank: { name: 'Activity bank' }, note: 'Please tighten the stems', rejected: 2, approved: 0 });
    const times = r.body.items.map((i: any) => +new Date(i.at)); expect(times).toEqual([...times].sort((x: number, y: number) => y - x));
    expect(r.body.items.some((i: any) => i.action === 'pool.create' && i.bank?.name === 'Activity bank' && i.actor.role === 'TEACHER')).toBe(true);
    expect(JSON.stringify(r.body)).not.toMatch(/"ip"|isCorrect|passwordHash|"hash"/);                                    // no addresses, answer keys or log hashes
    expect((await (await as(ctx, 'super.admin')).get(`/admin/teachers/${t.userId}/activity`)).status).toBe(200);
    expect((await (await as(ctx, 'admin.b')).get(`/admin/teachers/${t.userId}/activity`)).status).toBe(404);           // another campus: not found, not forbidden
    for (const who of ['examiner', 'cce', 'lecturer.a', 'student.a001']) expect((await (await as(ctx, who)).get(`/admin/teachers/${t.userId}/activity`)).status, who).toBe(403);
    expect((await t.c.get(`/admin/teachers/${t.userId}/activity`)).status).toBe(403);
  });
});

describe('examiners prepare examinations from approved teacher questions', () => {
  it('approved teacher MCQs are available to the paper builder, and submitting or approving a bank never creates or schedules an exam', async () => {
    const t = await teacher(); const b = await bank(t, 2, 'Picker bank'); const ex = await as(ctx, 'examiner'); const examsBefore = await ctx.prisma.exam.count();
    await t.c.post(`/teacher/pools/${b.id}/submit`);
    const submitted = (await ex.get(`/questions?status=APPROVED&courseId=${PATH}&pageSize=200`)).body.items.map((q: any) => q.id); expect(submitted).not.toContain(b.qs[0]);   // not selectable before approval
    await ex.post(`/question-banks/${b.id}/review`, { decision: 'APPROVE' });
    const picker = (await ex.get(`/questions?status=APPROVED&courseId=${PATH}&pageSize=200`)).body.items.map((q: any) => q.id); expect(picker).toEqual(expect.arrayContaining(b.qs));
    expect(await ctx.prisma.exam.count()).toBe(examsBefore);                                                           // nothing was scheduled or published
    const exam = (await ex.post('/exams', { code: `PICK-${++seq}`, title: 'Picker exam', courseId: PATH, term: TERM, opensAt: new Date(Date.now() + 86_400_000).toISOString(), closesAt: new Date(Date.now() + 2 * 86_400_000).toISOString(), durationMin: 30, institutionIds: [A] })).body;
    expect([200, 201]).toContain((await ex.put(`/exams/${exam.id}/paper`, { items: b.qs.map((questionId) => ({ questionId, marks: 1 })) })).status);
    expect((await ctx.prisma.exam.findUniqueOrThrow({ where: { id: exam.id } })).status).toBe('DRAFT');                 // still a draft until the examiner and the CCE act
  });
});
