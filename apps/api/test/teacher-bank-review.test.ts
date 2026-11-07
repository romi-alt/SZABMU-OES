import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, as, boot, type Ctx } from './helpers';

/** Question-bank review workflow, step 4: bank status, read-only while under review, reviewer queue/detail/decisions, resubmission, version history. */
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
  const f = { fullName: `Dr Review ${n}`, email: `rv${n}@example.test`, password: PW, employeeId: `RV-${n}`, department: 'Pathology', designation: 'Lecturer', phone: '+92 300 1234567', assignments: [{ institutionId: A, programId: PROG, semester: 4, term: TERM, courseId: PATH }] };
  const s = await anon().post('/teacher-registration', f); expect((await anon().post('/teacher-registration/verify', { email: f.email, code: s.body.devCode })).status).toBe(200);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email: f.email } });
  const c = new Client(ctx.app, ''); const l = await c.req('POST', '/auth/login', { email: f.email, password: PW }); const sc = l.headers['set-cookie']; c.cookie = String(Array.isArray(sc) ? sc[0] : sc).split(';')[0]!;
  const row = await ctx.prisma.courseAssignment.findFirstOrThrow({ where: { userId: user.id } });
  const a = await as(ctx, 'admin.a'); await a.post(`/admin/teachers/${user.id}/decision`, { decision: 'APPROVE' }); await a.post(`/admin/teachers/assignments/${row.id}/decision`, { decision: 'APPROVE' });
  return { c, userId: user.id, assignmentId: row.id };
}
const mcq = (n: number, extra: Record<string, unknown> = {}) => ({ stem: `Review question ${n}: which organ produces insulin?`, options: ['Liver', 'Pancreas', 'Kidney', 'Spleen'], correctIndex: 1, difficulty: 'EASY', topic: 'Endocrine', marks: 1, ...extra });
async function bank(t: Awaited<ReturnType<typeof teacher>>, count = 3, name = `Bank ${++seq}`) {
  const id = (await t.c.post('/teacher/pools', { assignmentId: t.assignmentId, name })).body.id as string; const qs: string[] = [];
  for (let i = 0; i < count; i++) qs.push((await t.c.post(`/teacher/pools/${id}/questions`, mcq(++seq))).body.id as string);
  return { id, qs };
}
const poolRow = async (t: Awaited<ReturnType<typeof teacher>>, id: string) => (await t.c.get('/teacher/pools')).body.find((p: any) => p.id === id);
/** Stored bank status must always equal the status implied by its questions (empty → DRAFT). */
const implied = (qs: { status: string }[]) => !qs.length ? 'DRAFT' : qs.some((q) => q.status === 'SUBMITTED') ? 'SUBMITTED' : qs.some((q) => q.status === 'REJECTED') ? 'REJECTED' : qs.some((q) => q.status === 'DRAFT') ? 'DRAFT' : 'APPROVED';
const consistent = async (id: string) => { const p = await ctx.prisma.questionPool.findUniqueOrThrow({ where: { id }, include: { questions: { where: { status: { not: 'RETIRED' } }, select: { status: true } } } }); expect(p.status).toBe(implied(p.questions)); return p.status; };

describe('bank status and the read-only lock', () => {
  it('a new bank is DRAFT; submitting makes it SUBMITTED and read-only; every change is refused until it is reviewed', async () => {
    const t = await teacher(); const b = await bank(t, 2);
    expect(await poolRow(t, b.id)).toMatchObject({ status: 'DRAFT', state: 'DRAFT' }); expect(await consistent(b.id)).toBe('DRAFT');
    const empty = (await t.c.post('/teacher/pools', { assignmentId: t.assignmentId, name: 'Empty bank' })).body.id; expect(await poolRow(t, empty)).toMatchObject({ status: 'DRAFT', state: 'EMPTY' });
    expect((await t.c.post(`/teacher/pools/${b.id}/submit`)).body.submitted).toBe(2);
    expect(await poolRow(t, b.id)).toMatchObject({ status: 'SUBMITTED', state: 'SUBMITTED' }); expect(await consistent(b.id)).toBe('SUBMITTED');
    const locked = async (r: Promise<{ status: number; body: any }>, what: string) => { const x = await r; expect(x.status, what).toBe(409); expect(x.body.code, what).toBe('BANK_LOCKED'); };
    await locked(t.c.post(`/teacher/pools/${b.id}/questions`, mcq(++seq)), 'add question');
    await locked(t.c.post(`/teacher/pools/${b.id}/import`, { rows: [{ statement: 'Imported while locked: which organ pumps blood?', options: ['Heart', 'Lung', 'Liver', 'Kidney'], correct: 'A' }] }), 'import');
    await locked(t.c.post(`/teacher/questions/${b.qs[0]}/duplicate`), 'duplicate');
    await locked(t.c.del(`/teacher/questions/${b.qs[0]}`), 'delete question');
    await locked(t.c.put(`/teacher/questions/${b.qs[0]}`, mcq(++seq)), 'edit question');
    await locked(t.c.patch(`/teacher/pools/${b.id}`, { name: 'Renamed while locked' }), 'rename');
    await locked(t.c.post(`/teacher/pools/${b.id}/submit`), 'submit again');
    expect((await t.c.get(`/teacher/questions?poolId=${b.id}`)).body.total).toBe(2);                                    // reading is fine
    expect((await t.c.get(`/teacher/pools/${b.id}/export`)).status).toBe(200);                                          // so is exporting your own bank
    expect(await ctx.prisma.question.count({ where: { poolId: b.id } })).toBe(2);
  });
});

describe('reviewer queue and detail', () => {
  it('reviewers (question.approve) see submitted banks with the answer key; drafts stay private; everyone else is refused', async () => {
    const t = await teacher(); const sub = await bank(t, 2, 'Queue bank'); const draft = await bank(t, 1, 'Private draft'); await t.c.post(`/teacher/pools/${sub.id}/submit`);
    const ex = await as(ctx, 'examiner');
    const q = (await ex.get('/question-banks?status=SUBMITTED')).body; const row = q.items.find((x: any) => x.id === sub.id);
    expect(row).toMatchObject({ name: 'Queue bank', status: 'SUBMITTED', owner: { fullName: expect.stringMatching(/^Dr Review/) }, course: { code: 'MBBS-PATH-4' }, counts: { total: 2, submitted: 2 } });
    expect(q.items.find((x: any) => x.id === draft.id)).toBeUndefined();
    const d = (await ex.get(`/question-banks/${sub.id}`)).body;
    expect(d.questions).toHaveLength(2); expect(d.questions[0].options.find((o: any) => o.isCorrect).label).toBe('B'); expect(d).toMatchObject({ id: sub.id, status: 'SUBMITTED', owner: { fullName: expect.any(String) } });
    expect(d.activity.length).toBeGreaterThan(0);
    expect((await ex.get(`/question-banks/${draft.id}`)).status).toBe(404);                                           // a draft is the teacher's own
    for (const who of ['lecturer.a', 'admin.a', 'invigilator.a', 'student.a001']) { const c = await as(ctx, who); expect((await c.get('/question-banks')).status, who).toBe(403); expect((await c.get(`/question-banks/${sub.id}`)).status, who).toBe(403); expect((await c.post(`/question-banks/${sub.id}/review`, { decision: 'APPROVE' })).status, who).toBe(403); }
    expect((await t.c.get('/question-banks')).status).toBe(403); expect((await t.c.post(`/question-banks/${sub.id}/review`, { decision: 'APPROVE' })).status).toBe(403);   // a teacher cannot approve (own or any) bank
    for (const who of ['cce', 'super.admin']) expect((await (await as(ctx, who)).get(`/question-banks/${sub.id}`)).status, who).toBe(200);
  });
});

describe('reviewer sees the question images of the bank they review', () => {
  it('serves an image only through a visible bank that uses it', async () => {
    const t = await teacher(); const b = await bank(t, 0, 'Image bank'); const other = await bank(t, 0, 'Other image bank');
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const imageId = (await t.c.post('/teacher/images', { data: png })).body.id as string;
    await t.c.post(`/teacher/pools/${b.id}/questions`, mcq(++seq, { imageId })); await t.c.post(`/teacher/pools/${other.id}/questions`, mcq(++seq));
    const ex = await as(ctx, 'examiner');
    expect((await ex.get(`/question-banks/${b.id}/images/${imageId}`)).status).toBe(404);                              // bank still a draft
    await t.c.post(`/teacher/pools/${b.id}/submit`); await t.c.post(`/teacher/pools/${other.id}/submit`);
    expect((await ex.get(`/question-banks/${b.id}/images/${imageId}`)).body).toEqual({ id: imageId, mime: 'image/png', data: png });
    expect((await ex.get(`/question-banks/${other.id}/images/${imageId}`)).status).toBe(404);                          // not used in that bank
    expect((await t.c.post('/teacher/images', { data: png })).body.id).toBe(imageId);                                   // the same file is stored once per teacher
    expect((await (await as(ctx, 'lecturer.a')).get(`/question-banks/${b.id}/images/${imageId}`)).status).toBe(403);
  });
});

describe('decisions', () => {
  it('approving a bank approves every submitted question, tells the teacher, audits it and unlocks editing', async () => {
    const t = await teacher(); const b = await bank(t, 3); await t.c.post(`/teacher/pools/${b.id}/submit`); const ex = await as(ctx, 'examiner');
    expect((await ex.post(`/question-banks/${b.id}/review`, { decision: 'APPROVE', note: 'Good set' })).body).toMatchObject({ status: 'APPROVED', approved: 3, rejected: 0 });
    expect(await poolRow(t, b.id)).toMatchObject({ status: 'APPROVED', state: 'APPROVED', reviewNote: 'Good set' }); expect(await consistent(b.id)).toBe('APPROVED');
    expect((await ctx.prisma.question.findMany({ where: { poolId: b.id } })).every((q) => q.status === 'APPROVED' && q.reviewedAt)).toBe(true);
    expect(await ctx.prisma.notification.count({ where: { userId: t.userId, title: 'Question bank approved' } })).toBe(1);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'question_pool.review', entityId: b.id } })).toBe(1);
    expect((await ex.post(`/question-banks/${b.id}/review`, { decision: 'APPROVE' })).status).toBe(409);               // nothing left to review
    // editing an approved question returns just that question (and so the bank) to draft; the other two stay approved
    expect((await t.c.put(`/teacher/questions/${b.qs[0]}`, mcq(++seq))).body.status).toBe('DRAFT');
    expect(await poolRow(t, b.id)).toMatchObject({ status: 'DRAFT' }); expect(await consistent(b.id)).toBe('DRAFT');
    expect((await t.c.post(`/teacher/pools/${b.id}/questions`, mcq(++seq))).status).toBe(201);                        // open again
  });

  it('rejecting needs a comment; the teacher sees it, revises, resubmits and the bank is approved on the second round', async () => {
    const t = await teacher(); const b = await bank(t, 2); await t.c.post(`/teacher/pools/${b.id}/submit`); const ex = await as(ctx, 'examiner');
    expect((await ex.post(`/question-banks/${b.id}/review`, { decision: 'REJECT' })).status).toBe(400);
    expect((await ex.post(`/question-banks/${b.id}/review`, { decision: 'REJECT', note: '   ' })).status).toBe(400);
    expect((await ex.post(`/question-banks/${b.id}/review`, { decision: 'REJECT', note: 'Options B and C overlap; fix before resubmitting' })).body).toMatchObject({ status: 'REJECTED', approved: 0, rejected: 2 });
    expect(await poolRow(t, b.id)).toMatchObject({ status: 'REJECTED', reviewNote: 'Options B and C overlap; fix before resubmitting' }); expect(await consistent(b.id)).toBe('REJECTED');
    const sub = (await t.c.get('/teacher/submissions?status=REJECTED')).body; expect(sub.items.filter((i: any) => i.pool.id === b.id)).toHaveLength(2); expect(sub.items[0].reviewNote).toMatch(/overlap/);
    expect(await ctx.prisma.notification.count({ where: { userId: t.userId, title: 'Question bank returned for changes' } })).toBe(1);
    // revise both, then resubmit
    for (const id of b.qs) expect((await t.c.put(`/teacher/questions/${id}`, mcq(++seq, { explanation: 'Clarified' }))).body).toMatchObject({ status: 'DRAFT' });
    expect(await consistent(b.id)).toBe('DRAFT');
    expect((await t.c.post(`/teacher/pools/${b.id}/submit`)).body.submitted).toBe(2); expect(await poolRow(t, b.id)).toMatchObject({ status: 'SUBMITTED', reviewNote: null });
    expect((await ex.post(`/question-banks/${b.id}/review`, { decision: 'APPROVE' })).body.status).toBe('APPROVED'); expect(await consistent(b.id)).toBe('APPROVED');
    for (const id of b.qs) expect(await ctx.prisma.questionVersion.count({ where: { questionId: id } })).toBe(2);        // original + revision are both kept
  });

  it('question-by-question decisions must cover every submitted question; one rejection returns the bank', async () => {
    const t = await teacher(); const b = await bank(t, 3); const other = await bank(t, 1); await t.c.post(`/teacher/pools/${b.id}/submit`); await t.c.post(`/teacher/pools/${other.id}/submit`); const ex = await as(ctx, 'examiner');
    const items = (ids: string[], decisions: string[], notes: (string | undefined)[]) => ids.map((questionId, i) => ({ questionId, decision: decisions[i], note: notes[i] }));
    expect((await ex.post(`/question-banks/${b.id}/review`, { items: items(b.qs.slice(0, 2), ['APPROVE', 'APPROVE'], [undefined, undefined]) })).status).toBe(400);   // one question left out
    expect((await ex.post(`/question-banks/${b.id}/review`, { items: items([...b.qs.slice(0, 2), other.qs[0]!], ['APPROVE', 'APPROVE', 'APPROVE'], [undefined, undefined, undefined]) })).status).toBe(400);   // a question from another bank
    expect((await ex.post(`/question-banks/${b.id}/review`, { items: items(b.qs, ['APPROVE', 'REJECT', 'APPROVE'], [undefined, undefined, undefined]) })).status).toBe(400);   // a rejection without any comment
    const ok = await ex.post(`/question-banks/${b.id}/review`, { items: items(b.qs, ['APPROVE', 'REJECT', 'APPROVE'], [undefined, 'Stem is ambiguous', undefined]) });
    expect(ok.body).toMatchObject({ status: 'REJECTED', approved: 2, rejected: 1 });
    const rows = await ctx.prisma.question.findMany({ where: { poolId: b.id }, orderBy: { createdAt: 'asc' } }); expect(rows.map((r) => r.status)).toEqual(['APPROVED', 'REJECTED', 'APPROVED']); expect(rows[1]!.reviewNote).toBe('Stem is ambiguous');
    expect(await consistent(b.id)).toBe('REJECTED'); expect(await consistent(other.id)).toBe('SUBMITTED');                // the other bank was not touched
    // only the returned question needs work: fix it and resubmit; the two approved ones stay approved
    await t.c.put(`/teacher/questions/${b.qs[1]}`, mcq(++seq)); expect((await t.c.post(`/teacher/pools/${b.id}/submit`)).body.submitted).toBe(1);
    expect((await ex.post(`/question-banks/${b.id}/review`, { decision: 'APPROVE' })).body).toMatchObject({ status: 'APPROVED', approved: 1 });
    expect((await ctx.prisma.question.findMany({ where: { poolId: b.id } })).every((r) => r.status === 'APPROVED')).toBe(true);
  });

  it('the existing question-by-question review route keeps the bank status in step', async () => {
    const t = await teacher(); const b = await bank(t, 2); await t.c.post(`/teacher/pools/${b.id}/submit`); const ex = await as(ctx, 'examiner');
    expect([200, 201]).toContain((await ex.post(`/questions/${b.qs[0]}/review`, { decision: 'APPROVE' })).status); expect(await consistent(b.id)).toBe('SUBMITTED');   // one still waiting
    expect([200, 201]).toContain((await ex.post(`/questions/${b.qs[1]}/review`, { decision: 'REJECT', note: 'Needs work' })).status); expect(await consistent(b.id)).toBe('REJECTED');
    expect(await poolRow(t, b.id)).toMatchObject({ status: 'REJECTED' });
  });
});

describe('version history and exam use', () => {
  it('lists every version with what changed, flags the version an examination froze, and refuses other teachers', async () => {
    const t = await teacher(); const other = await teacher(); const b = await bank(t, 1); const q = b.qs[0]!; const ex = await as(ctx, 'examiner'); const cce = await as(ctx, 'cce');
    await t.c.post(`/teacher/pools/${b.id}/submit`); await ex.post(`/question-banks/${b.id}/review`, { decision: 'APPROVE' });
    const exam = (await ex.post('/exams', { code: `BNK-${++seq}`, title: 'Bank review exam', courseId: PATH, term: TERM, opensAt: new Date(Date.now() + 86_400_000).toISOString(), closesAt: new Date(Date.now() + 2 * 86_400_000).toISOString(), durationMin: 30, institutionIds: [A] })).body;
    await ex.put(`/exams/${exam.id}/paper`, { items: [{ questionId: q, marks: 1 }] }); await ex.post(`/exams/${exam.id}/paper/submit`); expect([200, 201]).toContain((await cce.post(`/exams/${exam.id}/paper/review`, { decision: 'APPROVE' })).status);
    expect((await t.c.get(`/teacher/questions/${q}`)).body.usedInExams).toBe(1);
    const edited = await t.c.put(`/teacher/questions/${q}`, mcq(++seq, { stem: 'Edited after the exam froze it: which gland secretes insulin?', difficulty: 'HARD', correctIndex: 2 }));
    expect(edited.body).toMatchObject({ version: 2, status: 'DRAFT' });
    const v = (await t.c.get(`/teacher/questions/${q}/versions`)).body;
    expect(v.map((x: any) => x.version)).toEqual([1, 2]); expect(v[0].changed).toEqual([]); expect(v[1].changed).toEqual(expect.arrayContaining(['stem', 'difficulty', 'correct answer']));
    expect(v.map((x: any) => x.usedInExams)).toEqual([1, 0]);                                                            // exactly version 1 is what the examination froze
    expect(v[0].snapshot.stem).toMatch(/^Review question/); expect(v[1].snapshot.stem).toMatch(/^Edited after/);
    expect((await other.c.get(`/teacher/questions/${q}/versions`)).status).toBe(404);
    expect((await ex.get(`/question-banks/${b.id}`)).status).toBe(404);                                                  // the edit put the bank back in the teacher's hands (draft), so reviewers no longer see it
    const frozen = (await ctx.prisma.examQuestion.findFirstOrThrow({ where: { examId: exam.id, questionId: q } })).snapshot as any; expect(frozen.stem).toMatch(/^Review question/);   // the paper kept the approved text
  });
});
