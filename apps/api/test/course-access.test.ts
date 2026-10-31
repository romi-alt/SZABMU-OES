import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, boot, type Ctx } from './helpers';

let ctx: Ctx;
beforeAll(async () => { ctx = await boot(); });
afterAll(async () => { await ctx.app.close(); });

// Seeded assignments: lecturer.a → PATH+PHARM @A · lecturer.a2 → PHARM @A · lecturer.b → PATH @B
const A = () => ctx.seeded.institutions.a.id;
const B = () => ctx.seeded.institutions.b.id;
const PATH = () => ctx.seeded.courses.path.id;
const PHARM = () => ctx.seeded.courses.pharm.id;
const body = (courseId: string, institutionId: string, tag = 'x') => ({
  courseId, institutionId, type: 'MCQ', difficulty: 'EASY', stem: `Synthetic authorization probe ${tag}: which option is correct here?`,
  options: ['One', 'Two', 'Three', 'Four'].map((text, i) => ({ label: 'ABCD'[i], text, isCorrect: i === 0 })),
});
const userId = async (local: string) => (await ctx.prisma.user.findFirstOrThrow({ where: { email: { startsWith: `${local}@` } } })).id;
const qOf = (courseId: string, institutionId = A()) => ctx.prisma.question.findFirstOrThrow({ where: { courseId, institutionId } });
const examId = () => ctx.seeded.examId; // PATH exam, participating A and B

describe('lecturer ↔ course authorization: questions', () => {
  it('a lecturer lists only questions of explicitly assigned courses (query-level), never the other course\'s content or keys', async () => {
    const a2 = await as(ctx, 'lecturer.a2');
    const r = await a2.get('/questions?pageSize=200');
    expect(r.status).toBe(200);
    const pharmCount = await ctx.prisma.question.count({ where: { courseId: PHARM(), institutionId: A() } });
    expect(pharmCount).toBeGreaterThan(0);
    expect(r.body.total).toBe(pharmCount);
    expect(r.body.items.every((q: { courseId: string }) => q.courseId === PHARM())).toBe(true);
    const pathStems = (await ctx.prisma.question.findMany({ where: { courseId: PATH(), institutionId: A() }, select: { stem: true } })).map((q) => q.stem);
    for (const stem of pathStems) expect(r.raw).not.toContain(stem.slice(0, 30));
    expect((await a2.get(`/questions?courseId=${PATH()}&pageSize=50`)).body.total).toBe(0); // explicit filter cannot widen access
    expect((await a2.get(`/questions?courseId=${PATH()}&institutionId=${A()}`)).body.total).toBe(0);
  });

  it('read / update / submit / retire of an unassigned course\'s question is 404 (indistinguishable from absent)', async () => {
    const a2 = await as(ctx, 'lecturer.a2'); const q = await qOf(PATH());
    expect((await a2.get(`/questions/${q.id}`)).status).toBe(404);
    expect((await a2.put(`/questions/${q.id}`, body(PATH(), A()))).status).toBe(404);
    expect((await a2.post(`/questions/${q.id}/submit`)).status).toBe(404);
    expect((await a2.del(`/questions/${q.id}`)).status).toBe(404);
    expect((await ctx.prisma.question.findUniqueOrThrow({ where: { id: q.id } })).status).toBe(q.status); // untouched
  });

  it('creating a question needs an assignment to that course at that institution', async () => {
    const a2 = await as(ctx, 'lecturer.a2');
    expect((await a2.post('/questions', body(PATH(), A(), 'a2-path'))).status).toBe(403);       // other course, same campus
    expect((await a2.post('/questions', body(PHARM(), A(), 'a2-pharm'))).status).toBe(201);     // assigned
    expect((await a2.post('/questions', body(PHARM(), B(), 'a2-b'))).status).toBe(403);         // other campus
    expect((await a2.post('/questions', body('00000000-0000-4000-8000-000000000000', A(), 'x'))).status).toBe(400); // unknown course
    const b = await as(ctx, 'lecturer.b');
    expect((await b.post('/questions', body(PATH(), A(), 'b-path-at-A'))).status).toBe(403);    // assigned at B only
    expect((await b.post('/questions', body(PHARM(), B(), 'b-pharm'))).status).toBe(403);       // campus B, unassigned course
    expect((await b.post('/questions', body(PATH(), B(), 'b-path-at-B'))).status).toBe(201);    // assigned
    expect(await ctx.prisma.question.count({ where: { stem: { contains: 'a2-path' } } })).toBe(0);
  });

  it('an assignment at one campus does not grant the same course at another campus', async () => {
    const aLect = await as(ctx, 'lecturer.a');
    const bQ = await ctx.prisma.question.findFirstOrThrow({ where: { institutionId: B(), courseId: PATH() } });
    expect((await aLect.get(`/questions/${bQ.id}`)).status).toBe(404);
    expect((await aLect.post('/questions', body(PATH(), B(), 'a-at-B'))).status).toBe(403);
    const list = await aLect.get('/questions?pageSize=200');
    expect(list.body.items.every((q: { institutionId: string }) => q.institutionId === A())).toBe(true);
  });

  it('non-lecturer roles keep their existing scope (examiner sees both courses; student has no access)', async () => {
    const ex = await as(ctx, 'examiner');
    const all = await ex.get('/questions?pageSize=200');
    expect(new Set(all.body.items.map((q: { courseId: string }) => q.courseId))).toEqual(new Set([PATH(), PHARM()]));
    expect((await (await as(ctx, 'student.a002')).get('/questions')).status).toBe(403);
  });
});

describe('lecturer ↔ course authorization: papers, grading and results', () => {
  it('paper read/compose/submit require an assignment to the exam\'s course', async () => {
    const a2 = await as(ctx, 'lecturer.a2'); const a = await as(ctx, 'lecturer.a');
    expect((await a2.get(`/exams/${examId()}/paper`)).status).toBe(403);
    expect((await a2.put(`/exams/${examId()}/paper`, { items: [{ questionId: (await qOf(PATH())).id, marks: 1 }] })).status).toBe(403);
    expect((await a2.post(`/exams/${examId()}/paper/submit`)).status).toBe(403);
    expect((await a.get(`/exams/${examId()}/paper`)).status).toBe(200);
  });

  it('grading queue, item analysis, review and result listings are limited to assigned courses', async () => {
    const a2 = await as(ctx, 'lecturer.a2'); const a = await as(ctx, 'lecturer.a');
    await ctx.prisma.exam.update({ where: { id: examId() }, data: { status: 'CLOSED' } }); // make it visible to the grading queue
    const q2 = await a2.get('/grading/exams'); const q1 = await a.get('/grading/exams');
    expect(q2.body.map((e: { id: string }) => e.id)).not.toContain(examId());
    expect(q1.body.map((e: { id: string }) => e.id)).toContain(examId());
    expect((await a2.get(`/grading/exams/${examId()}/analysis`)).status).toBe(403);
    expect((await a2.post(`/grading/exams/${examId()}/review`, { note: 'looks fine to me' })).status).toBe(403);
    expect((await a2.get(`/results/exams/${examId()}`)).status).toBe(403);
    expect((await a.get(`/grading/exams/${examId()}/analysis`)).status).toBe(200);
    expect((await a.get(`/results/exams/${examId()}`)).status).toBe(200);
  });

  it('lecturers have no export/report access at all', async () => {
    const a = await as(ctx, 'lecturer.a');
    expect((await a.get(`/reports/exams/${examId()}`)).status).toBe(403);
    expect((await a.get(`/reports/exams/${examId()}/csv`)).status).toBe(403);
  });
});

describe('assignment administration', () => {
  const post = async (who: string, d: Record<string, unknown>) => (await as(ctx, who)).post('/course-assignments', d);

  it('only campus admins (own campuses) and super admins may assign; everyone else is refused', async () => {
    const d = { userId: await userId('lecturer.a2'), courseId: PATH(), institutionId: A() };
    for (const who of ['lecturer.a', 'lecturer.a2', 'student.a002', 'examiner', 'cce', 'invigilator.a']) expect((await post(who, d)).status, who).toBe(403);
    expect((await post('admin.b', d)).status).toBe(403); // campus B admin cannot act on campus A
    expect(await ctx.prisma.courseAssignment.count({ where: { userId: d.userId, courseId: PATH() } })).toBe(0);
    expect((await ctx.app.getHttpAdapter().getInstance().inject({ method: 'POST', url: '/api/course-assignments', payload: d })).statusCode).toBe(401);
  });

  it('validates the target: must be an active lecturer of that institution, real course, no duplicates', async () => {
    expect((await post('admin.a', { userId: await userId('student.a002'), courseId: PATH(), institutionId: A() })).status).toBe(400);
    expect((await post('admin.a', { userId: await userId('lecturer.b'), courseId: PATH(), institutionId: A() })).status).toBe(400); // lecturer of campus B
    expect((await post('admin.a', { userId: await userId('lecturer.a2'), courseId: '00000000-0000-4000-8000-000000000000', institutionId: A() })).status).toBe(404);
    expect((await post('admin.a', { userId: await userId('lecturer.a2'), courseId: PHARM(), institutionId: A() })).status).toBe(409); // already assigned
  });

  it('assign grants access immediately; revoke removes it immediately and keeps history; campus isolation applies to revoke', async () => {
    const a2 = await as(ctx, 'lecturer.a2'); const q = await qOf(PATH());
    expect((await a2.get(`/questions/${q.id}`)).status).toBe(404);
    const asg = await post('admin.a', { userId: await userId('lecturer.a2'), courseId: PATH(), institutionId: A() });
    expect(asg.status).toBe(201);
    expect((await a2.get(`/questions/${q.id}`)).status).toBe(200);
    expect((await (await as(ctx, 'admin.b')).del(`/course-assignments/${asg.body.id}`)).status).toBe(404); // other campus
    expect((await (await as(ctx, 'lecturer.a')).del(`/course-assignments/${asg.body.id}`)).status).toBe(403);
    expect((await (await as(ctx, 'admin.a')).del(`/course-assignments/${asg.body.id}`)).status).toBe(200);
    expect((await a2.get(`/questions/${q.id}`)).status).toBe(404);
    expect((await (await as(ctx, 'admin.a')).del(`/course-assignments/${asg.body.id}`)).status).toBe(409);
    const row = await ctx.prisma.courseAssignment.findUniqueOrThrow({ where: { id: asg.body.id } });
    expect(row.revokedAt).not.toBeNull();
    expect(row.revokedById).toBeTruthy();
    // re-assignment after revoke is allowed and creates a new row
    expect((await post('admin.a', { userId: await userId('lecturer.a2'), courseId: PATH(), institutionId: A() })).status).toBe(201);
    const hist = await (await as(ctx, 'admin.a')).get(`/course-assignments?userId=${await userId('lecturer.a2')}&includeRevoked=true`);
    expect(hist.body.length).toBeGreaterThanOrEqual(3);
  });

  it('a lecturer left with no assignments sees nothing, including questions they authored themselves', async () => {
    const a2 = await as(ctx, 'lecturer.a2'); const admin = await as(ctx, 'admin.a');
    const own = await ctx.prisma.question.findFirstOrThrow({ where: { authorId: await userId('lecturer.a2') } });
    expect((await a2.get(`/questions/${own.id}`)).status).toBe(200);
    for (const a of await admin.get(`/course-assignments?userId=${await userId('lecturer.a2')}`).then((r) => r.body as { id: string }[])) await admin.del(`/course-assignments/${a.id}`);
    expect((await a2.get('/questions?pageSize=200')).body.total).toBe(0);
    expect((await a2.get(`/questions/${own.id}`)).status).toBe(404);
    expect((await a2.get('/me/course-assignments')).body).toEqual([]);
    expect((await a2.get('/grading/exams')).body).toEqual([]);
  });

  it('"my assignments" is self-only; students are refused; every change is audited; DB forbids duplicate active rows', async () => {
    const mine = await (await as(ctx, 'lecturer.a')).get('/me/course-assignments');
    expect(mine.body.map((m: { course: { id: string } }) => m.course.id).sort()).toEqual([PATH(), PHARM()].sort());
    expect((await (await as(ctx, 'student.a002')).get('/me/course-assignments')).status).toBe(403);
    const actions = (await ctx.prisma.auditLog.findMany({ where: { action: { in: ['course.assign', 'course.unassign'] } } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['course.assign', 'course.unassign']));
    const uid = await userId('lecturer.a');
    await expect(ctx.prisma.courseAssignment.create({ data: { userId: uid, courseId: PATH(), institutionId: A(), assignedById: uid } })).rejects.toThrow();
  });
});
