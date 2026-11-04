import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PERMISSIONS } from '@oes/shared';
import { Client, as, boot, startExam, type Ctx } from './helpers';

/**
 * Teacher registration, approval and the restricted teacher workspace.
 * Covers: public catalog, validation, email proof, transactional create, pending/approved/rejected/suspended states, scope of admins,
 * per-assignment approval, immediate revocation, IDOR, names-only student list, MCQ pool lifecycle, import/export, frozen exam revisions,
 * and the boundary that teachers never reach results, marks, grades, exports or student detail.
 */
let ctx: Ctx; let A: string; let B: string; let PATH: string; let PHARM: string; let PROG: string; let seq = 0;
const TERM = '2026-SPRING'; const PW = 'Sturdy-Pass-2026!x';
const anon = () => new Client(ctx.app);
beforeAll(async () => {
  ctx = await boot({ studentsPerCampus: 4 });
  ({ a: { id: A }, b: { id: B } } = ctx.seeded.institutions as Record<'a' | 'b' | 'c', { id: string }>);
  PATH = ctx.seeded.courses.path.id; PHARM = ctx.seeded.courses.pharm.id; PROG = ctx.seeded.programs.mbbs.id;
});
afterAll(async () => { await ctx.app.close(); });

const req = (courseId: string, institutionId = A, term = TERM) => ({ institutionId, programId: PROG, semester: 4, term, courseId });
const form = (extra: Record<string, unknown> = {}) => { const n = ++seq; return { fullName: `Dr Test Teacher ${n}`, email: `teacher${n}@example.test`, password: PW, employeeId: `EMP-${1000 + n}`, department: 'Pathology', designation: 'Assistant Professor', phone: '+92 300 1234567', assignments: [req(PATH), req(PHARM)], ...extra }; };
/** Full registration: start → emailed code → verify. Returns the signed-in client and ids. */
async function register(extra: Record<string, unknown> = {}) {
  await clearLimits(); const f = form(extra); const s = await anon().post('/teacher-registration', f); expect(s.status, s.raw).toBe(200);
  const v = await anon().post('/teacher-registration/verify', { email: f.email, code: s.body.devCode }); expect(v.status, v.raw).toBe(200);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email: f.email } });
  const c = new Client(ctx.app, ''); const l = await c.req('POST', '/auth/login', { email: f.email, password: PW }); expect(l.status, l.raw).toBe(200);
  const sc = l.headers['set-cookie']; c.cookie = String(Array.isArray(sc) ? sc[0] : sc).split(';')[0]!;
  const rows = await ctx.prisma.courseAssignment.findMany({ where: { userId: user.id }, orderBy: { courseId: 'asc' } });
  return { f, c, userId: user.id, rows, path: rows.find((r) => r.courseId === PATH)!, pharm: rows.find((r) => r.courseId === PHARM)! };
}
async function approveAll(t: Awaited<ReturnType<typeof register>>, admin = 'admin.a') {
  const a = await as(ctx, admin);
  expect((await a.post(`/admin/teachers/${t.userId}/decision`, { decision: 'APPROVE' })).status).toBe(200);
  for (const r of t.rows) expect((await a.post(`/admin/teachers/assignments/${r.id}/decision`, { decision: 'APPROVE' })).status).toBe(200);
  return a;
}
/** The suite registers dozens of teachers from one address; real limits are exercised in their own test below. */
const clearLimits = async () => { const k = await ctx.redis.client.keys('rl:treg:*'); if (k.length) await ctx.redis.client.del(...k); };
const mcq = (extra: Record<string, unknown> = {}) => ({ stem: 'Which organ produces insulin in the human body?', options: ['Liver', 'Pancreas', 'Kidney', 'Spleen'], correctIndex: 1, explanation: 'Beta cells of the pancreatic islets.', difficulty: 'EASY', topic: 'Endocrine', marks: 1, ...extra });

describe('public catalog and validation', () => {
  it('serves the real academic structure and no personal data', async () => {
    const r = await anon().get('/teacher-registration/catalog'); expect(r.status).toBe(200);
    expect(r.body.institutions.map((i: any) => i.code)).toEqual(expect.arrayContaining(['DMC-A', 'DMC-B']));
    expect(r.body.programs.map((p: any) => p.code)).toContain('MBBS'); expect(r.body.courses.map((c: any) => c.code)).toEqual(expect.arrayContaining(['MBBS-PATH-4', 'MBBS-PHARM-4']));
    expect(r.body.terms).toContain(TERM);
    expect(r.raw).not.toMatch(/@demo|regNo|password|fullName/);
  });
  it('rejects weak passwords, bad phones, mismatched subjects, unknown sessions, duplicates, empty selections and bad photos', async () => {
    const bad = async (extra: Record<string, unknown>, status = 400) => { await clearLimits(); expect((await anon().post('/teacher-registration', form(extra))).status, JSON.stringify(extra).slice(0, 80)).toBe(status); };
    await bad({ password: 'short' }); await bad({ phone: 'abc' }); await bad({ assignments: [] }); await bad({ assignments: [req(PATH, A, '1999-FALL')] });
    await bad({ assignments: [{ ...req(PATH), semester: 2 }] }); await bad({ assignments: [req(PATH), req(PATH)] }); await bad({ assignments: [{ ...req(PATH), institutionId: '00000000-0000-4000-8000-000000000000' }] });
    await bad({ photo: 'data:image/png;base64,AAAA' }); await bad({ photo: 'data:text/html;base64,PGI+' }); await bad({ email: 'not-an-email' }); await bad({ employeeId: 'x' });
  });
  it('never creates an account before the emailed code is entered, and the code is checked', async () => {
    const f = form(); const s = await anon().post('/teacher-registration', f); expect(s.status).toBe(200);
    expect(await ctx.prisma.user.count({ where: { email: f.email } })).toBe(0);
    expect((await anon().post('/auth/login', { email: f.email, password: PW })).status).toBe(401);
    expect((await anon().post('/teacher-registration/verify', { email: f.email, code: s.body.devCode === '000000' ? '111111' : '000000' })).status).toBe(400);
    expect((await anon().post('/teacher-registration/verify', { email: f.email, code: s.body.devCode })).status).toBe(200);
    expect((await anon().post('/teacher-registration/verify', { email: f.email, code: s.body.devCode })).status).toBe(400);   // single use
  });
  it('is rate limited per address', async () => {
    await clearLimits(); let last = 200; for (let i = 0; i < 7; i++) last = (await anon().post('/teacher-registration', form({ email: 'same.person@example.test', password: 'weak' }))).status;
    expect(last).toBe(429); await clearLimits();
  });
  it('answers the same for an email that already has an account and does not create anything', async () => {
    const t = await register(); await clearLimits(); const again = await anon().post('/teacher-registration', form({ email: t.f.email, employeeId: 'EMP-FRESH-1' }));
    expect(again.status).toBe(200); expect(again.body.devCode).toBeUndefined();
    await clearLimits(); expect((await anon().post('/teacher-registration', form({ employeeId: t.f.employeeId }))).status).toBe(409);       // faculty ID is unique
  });
});

describe('registration is transactional and grants nothing', () => {
  it('creates one TEACHER account, one PENDING profile and a PENDING request per selection, audited, and tells the administrators', async () => {
    const t = await register({ assignments: [req(PATH), req(PHARM), req(PATH, B)] });
    const u = await ctx.prisma.user.findUniqueOrThrow({ where: { id: t.userId }, include: { institutions: true, teacherProfile: true } });
    expect(u).toMatchObject({ role: 'TEACHER', active: true }); expect(u.institutions).toHaveLength(0);              // no campus scope from self-selected options
    expect(u.teacherProfile).toMatchObject({ status: 'PENDING', employeeId: t.f.employeeId, department: 'Pathology' });
    expect(t.rows).toHaveLength(3); expect(t.rows.every((r) => r.status === 'PENDING' && r.term === TERM && r.assignedById === t.userId && !r.decidedAt)).toBe(true);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'teacher.registered', entityId: t.userId } })).toBe(1);
    const admin = await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'admin.a@demo.szabmu.invalid' } });
    expect(await ctx.prisma.notification.count({ where: { userId: admin.id, title: 'Teacher registration awaiting approval' } })).toBeGreaterThan(0);
  });
  it('a pending teacher can sign in and see only the approval status; every working route is refused', async () => {
    const t = await register(); const me = await t.c.get('/auth/me');
    expect(me.body.teacher.status).toBe('PENDING'); expect(me.body.permissions.sort()).toEqual(['program.read', 'teacher.self']);
    expect((await t.c.get('/teacher/status')).body).toMatchObject({ status: 'PENDING', requests: { pending: 2 } });
    for (const url of ['/teacher/overview', '/teacher/assignments', '/teacher/students', '/teacher/pools', '/teacher/questions']) { const r = await t.c.get(url); expect(r.status, url).toBe(403); expect(r.body.code, url).toBe('TEACHER_NOT_APPROVED'); }
    expect((await t.c.post('/teacher/pools', { assignmentId: t.path.id, name: 'Nope' })).status).toBe(403);
  });
  it('approving the identity grants nothing: assignments stay pending, so pools, questions and students are all unavailable', async () => {
    const t = await register(); const a = await as(ctx, 'admin.a');
    expect((await a.post(`/admin/teachers/${t.userId}/decision`, { decision: 'APPROVE' })).status).toBe(200);
    expect((await t.c.get('/auth/me')).body.permissions).toContain('teacher.work');
    expect((await t.c.get('/teacher/overview')).body).toEqual({ classes: 0, subjects: 0, mcqs: 0, students: 0 });
    expect((await t.c.get('/teacher/students')).body).toEqual({ total: 0, items: [] });
    expect((await t.c.post('/teacher/pools', { assignmentId: t.path.id, name: 'Pending subject' })).status).toBe(404);
    expect(await t.c.get('/teacher/assignments').then((r) => r.body.every((x: any) => x.status === 'PENDING' && x.studentCount === null))).toBe(true);
  });
});

describe('administrator review', () => {
  it('only teacher.manage roles reach the queue; a campus admin sees only requests naming their own campus', async () => {
    const t = await register({ assignments: [req(PATH), req(PHARM)] }); const onlyB = await register({ assignments: [req(PATH, B)] });
    for (const who of ['lecturer.a', 'examiner', 'cce', 'invigilator.a', 'student.a001']) expect((await (await as(ctx, who)).get('/admin/teachers')).status, who).toBe(403);
    const a = await as(ctx, 'admin.a'); const l = await a.get('/admin/teachers?status=PENDING&pageSize=200');
    expect(l.body.items.map((x: any) => x.userId)).toContain(t.userId); expect(l.body.items.map((x: any) => x.userId)).not.toContain(onlyB.userId);
    expect((await a.get(`/admin/teachers/${onlyB.userId}`)).status).toBe(404); expect((await a.post(`/admin/teachers/${onlyB.userId}/decision`, { decision: 'APPROVE' })).status).toBe(404);
    expect((await a.post(`/admin/teachers/assignments/${onlyB.rows[0]!.id}/decision`, { decision: 'APPROVE' })).status).toBe(404);
    const sa = await as(ctx, 'super.admin'); expect((await sa.get(`/admin/teachers/${onlyB.userId}`)).status).toBe(200);
    const d = (await a.get(`/admin/teachers/${t.userId}`)).body; expect(d.assignments).toHaveLength(2); expect(d).toMatchObject({ employeeId: t.f.employeeId, status: 'PENDING' });
  });
  it('approves and rejects each class-subject separately; a rejection needs a reason; only approved assignments give access; all of it is audited', async () => {
    const t = await register(); const a = await as(ctx, 'admin.a');
    await a.post(`/admin/teachers/${t.userId}/decision`, { decision: 'APPROVE' });
    expect((await a.post(`/admin/teachers/assignments/${t.pharm.id}/decision`, { decision: 'REJECT' })).status).toBe(400);
    expect((await a.post(`/admin/teachers/assignments/${t.pharm.id}/decision`, { decision: 'REJECT', note: 'Not on the Pharmacology panel this term' })).status).toBe(200);
    expect((await a.post(`/admin/teachers/assignments/${t.path.id}/decision`, { decision: 'APPROVE' })).status).toBe(200);
    expect((await a.post(`/admin/teachers/assignments/${t.path.id}/decision`, { decision: 'APPROVE' })).status).toBe(409);        // already decided
    const mine = (await t.c.get('/teacher/assignments')).body;
    expect(mine.find((x: any) => x.course.code === 'MBBS-PATH-4')).toMatchObject({ status: 'APPROVED', term: TERM }); expect(mine.find((x: any) => x.course.code === 'MBBS-PHARM-4')).toMatchObject({ status: 'REJECTED', decisionNote: 'Not on the Pharmacology panel this term' });
    expect((await t.c.get('/teacher/overview')).body).toMatchObject({ classes: 1, subjects: 1, mcqs: 0 });
    expect((await t.c.post('/teacher/pools', { assignmentId: t.pharm.id, name: 'Pharm' })).status).toBe(404);                  // rejected ⇒ no access
    for (const action of ['teacher.approve', 'teacher.assignment_approve', 'teacher.assignment_reject']) expect(await ctx.prisma.auditLog.count({ where: { action, OR: [{ entityId: t.userId }, { entityId: { in: t.rows.map((r) => r.id) } }] } }), action).toBe(1);
    expect(await ctx.prisma.userInstitution.count({ where: { userId: t.userId, institutionId: A } })).toBe(1);
    const rej = await register(); expect((await a.post(`/admin/teachers/${rej.userId}/decision`, { decision: 'REJECT' })).status).toBe(400);
    expect((await a.post(`/admin/teachers/${rej.userId}/decision`, { decision: 'REJECT', note: 'ID could not be verified' })).status).toBe(200);
    expect((await rej.c.get('/auth/me')).body.teacher).toMatchObject({ status: 'REJECTED', reviewNote: 'ID could not be verified' }); expect((await rej.c.get('/teacher/overview')).status).toBe(403);
  });
  it('revoking an assignment removes access immediately in the same session; suspension ends the session; reinstating restores access', async () => {
    const t = await register(); const a = await approveAll(t);
    const pool = (await t.c.post('/teacher/pools', { assignmentId: t.path.id, name: 'Revocation pool' })).body.id as string;
    const q = (await t.c.post(`/teacher/pools/${pool}/questions`, mcq())).body.id as string; expect(q).toBeTruthy();
    expect((await t.c.get('/teacher/students')).body.total).toBeGreaterThan(0);
    expect((await a.post(`/admin/teachers/assignments/${t.path.id}/revoke`, {})).status).toBe(400);                              // reason required
    expect((await a.post(`/admin/teachers/assignments/${t.path.id}/revoke`, { note: 'Reassigned to another lecturer' })).status).toBe(200);
    expect((await t.c.get(`/teacher/questions/${q}`)).status).toBe(404); expect((await t.c.post(`/teacher/pools/${pool}/questions`, mcq())).status).toBe(404);
    expect((await t.c.get('/teacher/pools')).body.map((p: any) => p.id)).not.toContain(pool);
    expect((await t.c.get('/teacher/students?assignmentId=' + t.path.id)).status).toBe(404);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'teacher.assignment_revoke', entityId: t.path.id } })).toBe(1);
    expect(await ctx.prisma.question.count({ where: { id: q } })).toBe(1);                                                        // work is kept, only hidden
    // suspension
    expect((await a.post(`/admin/teachers/${t.userId}/suspend`, { note: 'Under review' })).status).toBe(200);
    expect((await t.c.get('/teacher/overview')).status).toBe(401);                                                                  // sessions ended
    const again = new Client(ctx.app); const l = await again.req('POST', '/auth/login', { email: t.f.email, password: PW }); const sc = l.headers['set-cookie']; again.cookie = String(Array.isArray(sc) ? sc[0] : sc).split(';')[0]!;
    expect((await again.get('/auth/me')).body.teacher.status).toBe('SUSPENDED'); expect((await again.get('/teacher/pools')).status).toBe(403);
    expect((await a.post(`/admin/teachers/${t.userId}/reinstate`, {})).status).toBe(200); expect((await again.get('/teacher/overview')).status).toBe(200);
    for (const action of ['teacher.suspend', 'teacher.reinstate']) expect(await ctx.prisma.auditLog.count({ where: { action, entityId: t.userId } })).toBe(1);
  });
});

describe('MCQ pools', () => {
  it('creates a pool, validates and stores MCQs, and supports edit, duplicate, preview, search/filter, submit and delete', async () => {
    const t = await register(); await approveAll(t);
    const pool = (await t.c.post('/teacher/pools', { assignmentId: t.path.id, name: 'Endocrine basics', description: 'Week 3' })).body.id as string;
    expect((await t.c.get(`/teacher/pools?assignmentId=${t.path.id}`)).body[0]).toMatchObject({ id: pool, name: 'Endocrine basics', course: { code: 'MBBS-PATH-4' }, counts: { total: 0 } });
    expect((await t.c.post(`/teacher/pools/${pool}/questions`, mcq({ options: ['Same', 'Same', 'C', 'D'] }))).status).toBe(400);   // distinct options
    expect((await t.c.post(`/teacher/pools/${pool}/questions`, mcq({ correctIndex: 7 }))).status).toBe(400);
    const q1 = (await t.c.post(`/teacher/pools/${pool}/questions`, mcq())).body; expect(q1).toMatchObject({ status: 'DRAFT', difficulty: 'EASY', topic: 'Endocrine', marks: 1 }); expect(q1.options.filter((o: any) => o.isCorrect)).toHaveLength(1);
    const q2 = (await t.c.post(`/teacher/pools/${pool}/questions`, mcq({ stem: 'Which hormone lowers blood glucose?', options: ['Glucagon', 'Insulin', 'Cortisol', 'Adrenaline', 'Thyroxine'], correctIndex: 1, difficulty: 'MEDIUM', topic: 'Hormones', marks: 2 }))).body; expect(q2.options).toHaveLength(5);
    expect((await t.c.put(`/teacher/questions/${q1.id}`, mcq({ stem: 'Which organ secretes insulin?', difficulty: 'HARD' }))).body).toMatchObject({ stem: 'Which organ secretes insulin?', difficulty: 'HARD', version: 2, status: 'DRAFT' });
    const dup = (await t.c.post(`/teacher/questions/${q1.id}/duplicate`)).body; expect(dup.id).not.toBe(q1.id); expect(dup).toMatchObject({ stem: 'Which organ secretes insulin?', status: 'DRAFT', poolId: pool }); expect(dup.options.find((o: any) => o.isCorrect).text).toBe('Pancreas');
    expect((await t.c.get(`/teacher/questions/${q2.id}`)).body.options.find((o: any) => o.isCorrect).label).toBe('B');        // preview shows the key to the author
    const all = (await t.c.get(`/teacher/questions?poolId=${pool}`)).body; expect(all.total).toBe(3); expect(all.topics).toEqual(expect.arrayContaining(['Endocrine', 'Hormones']));
    expect((await t.c.get(`/teacher/questions?poolId=${pool}&difficulty=MEDIUM`)).body.total).toBe(1); expect((await t.c.get(`/teacher/questions?poolId=${pool}&topic=hormones`)).body.total).toBe(1);
    expect((await t.c.get(`/teacher/questions?poolId=${pool}&search=glucose`)).body.items[0].id).toBe(q2.id);
    expect((await t.c.del(`/teacher/questions/${dup.id}`)).status).toBe(200); expect((await t.c.get(`/teacher/questions?poolId=${pool}`)).body.total).toBe(2);
    const sub = await t.c.post(`/teacher/pools/${pool}/submit`); expect(sub.body.submitted).toBe(2);
    expect((await t.c.get(`/teacher/questions?poolId=${pool}&status=SUBMITTED`)).body.total).toBe(2); expect((await t.c.put(`/teacher/questions/${q1.id}`, mcq())).status).toBe(409);   // locked while under review
    expect((await t.c.del(`/teacher/pools/${pool}`)).status).toBe(409);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'question.submit', entityId: { in: [q1.id, q2.id] } } })).toBe(2);
    expect(await ctx.prisma.notification.count({ where: { title: 'Question pool awaiting review' } })).toBeGreaterThan(0);
  });
  it('is isolated per teacher and per assignment (IDOR): another teacher gets 404 for pools and questions, and cannot write to them', async () => {
    const t1 = await register(); await approveAll(t1); const t2 = await register(); await approveAll(t2);
    const pool = (await t1.c.post('/teacher/pools', { assignmentId: t1.path.id, name: 'Mine' })).body.id as string; const q = (await t1.c.post(`/teacher/pools/${pool}/questions`, mcq())).body.id as string;
    expect((await t2.c.get(`/teacher/questions/${q}`)).status).toBe(404); expect((await t2.c.put(`/teacher/questions/${q}`, mcq())).status).toBe(404); expect((await t2.c.del(`/teacher/questions/${q}`)).status).toBe(404);
    expect((await t2.c.post(`/teacher/pools/${pool}/questions`, mcq())).status).toBe(404); expect((await t2.c.post(`/teacher/pools/${pool}/submit`)).status).toBe(404); expect((await t2.c.get(`/teacher/pools/${pool}/export`)).status).toBe(404);
    expect((await t2.c.post('/teacher/pools', { assignmentId: t1.path.id, name: 'Steal' })).status).toBe(404); expect((await t2.c.get('/teacher/students?assignmentId=' + t1.path.id)).status).toBe(404);
    expect((await t2.c.get('/teacher/questions')).body.items.map((x: any) => x.id)).not.toContain(q);
    // a teacher approved for PATH only cannot use a pool for a PHARM assignment id that belongs to nobody they own
    const t3 = await register({ assignments: [req(PATH)] }); const a = await as(ctx, 'admin.a'); await a.post(`/admin/teachers/${t3.userId}/decision`, { decision: 'APPROVE' }); await a.post(`/admin/teachers/assignments/${t3.rows[0]!.id}/decision`, { decision: 'APPROVE' });
    expect((await t3.c.post('/teacher/pools', { assignmentId: t1.pharm.id, name: 'xx' })).status).toBe(404);
  });
  it('imports validated rows all-or-nothing and exports CSV with formula injection neutralised', async () => {
    const t = await register(); await approveAll(t);
    const pool = (await t.c.post('/teacher/pools', { assignmentId: t.path.id, name: 'Import me' })).body.id as string;
    const good = { statement: 'What is the normal adult heart rate at rest?', options: ['20-30', '60-100', '150-200', '300-400'], correct: 'B', difficulty: 'easy', topic: 'Cardio', marks: 1 };
    const evil = { statement: '=HYPERLINK("http://x","click")', options: ['a1', 'b2', 'c3', 'd4'], correct: 'a', explanation: '@cmd', difficulty: 'Hard', topic: '+1', marks: 2 };
    const bad = await t.c.post(`/teacher/pools/${pool}/import`, { rows: [good, { ...good, correct: 'Z' }] }); expect(bad.status).toBe(400); expect(bad.body.message).toMatch(/Row 3/);
    expect((await t.c.get(`/teacher/questions?poolId=${pool}`)).body.total).toBe(0);                                                  // nothing created
    expect((await t.c.post(`/teacher/pools/${pool}/import`, { rows: [good, evil] })).body.created).toBe(2);
    const ex = (await t.c.get(`/teacher/pools/${pool}/export`)).body; expect(ex.rows).toBe(2); expect(ex.filename).toBe('Import-me.csv'); expect(ex.csv.split('\r\n')[0]).toBe('statement,option_a,option_b,option_c,option_d,option_e,correct,explanation,difficulty,topic,marks,status');
    expect(ex.csv).toContain(`"'=HYPERLINK(""http://x"",""click"")"`); expect(ex.csv).toContain("'@cmd"); expect(ex.csv).toContain(",'+1,");
    expect(await ctx.prisma.auditLog.count({ where: { action: 'pool.export', entityId: pool } })).toBe(1);
  });
  it('keeps the revision already frozen in an examination when the author edits the question afterwards', async () => {
    const t = await register(); await approveAll(t);
    const pool = (await t.c.post('/teacher/pools', { assignmentId: t.path.id, name: 'For paper' })).body.id as string; const q = (await t.c.post(`/teacher/pools/${pool}/questions`, mcq({ stem: 'ORIGINAL stem used in the paper' }))).body.id as string;
    await t.c.post(`/teacher/pools/${pool}/submit`); const ex = await as(ctx, 'examiner'); const cce = await as(ctx, 'cce');
    expect([200, 201]).toContain((await ex.post(`/questions/${q}/review`, { decision: 'APPROVE' })).status);
    const exam = (await ex.post('/exams', { code: `TCH-REV-${++seq}`, title: 'Revision test', courseId: PATH, term: TERM, opensAt: new Date(Date.now() + 86_400_000).toISOString(), closesAt: new Date(Date.now() + 2 * 86_400_000).toISOString(), durationMin: 30, institutionIds: [A] })).body;
    expect([200, 201]).toContain((await ex.put(`/exams/${exam.id}/paper`, { items: [{ questionId: q, marks: 1 }] })).status); await ex.post(`/exams/${exam.id}/paper/submit`); expect([200, 201]).toContain((await cce.post(`/exams/${exam.id}/paper/review`, { decision: 'APPROVE' })).status);
    const frozen = async () => JSON.stringify((await ctx.prisma.examQuestion.findFirstOrThrow({ where: { examId: exam.id, questionId: q } })).snapshot);
    const before = await frozen(); expect(before).toContain('ORIGINAL stem used in the paper');
    expect((await t.c.put(`/teacher/questions/${q}`, mcq({ stem: 'EDITED later by the author' }))).body).toMatchObject({ status: 'DRAFT', version: 2 });   // back to draft for re-review
    expect(await frozen()).toBe(before);
  });
});

describe('students: names only, strictly by approved assignment', () => {
  it('lists only the names of students enrolled in the approved class-subject, with nothing else, and nobody from another campus or subject', async () => {
    const t = await register({ assignments: [req(PATH)] }); const a = await as(ctx, 'admin.a'); await a.post(`/admin/teachers/${t.userId}/decision`, { decision: 'APPROVE' }); await a.post(`/admin/teachers/assignments/${t.rows[0]!.id}/decision`, { decision: 'APPROVE' });
    const r = await t.c.get('/teacher/students?pageSize=200'); expect(r.status).toBe(200);
    const expected = await ctx.prisma.student.findMany({ where: { institutionId: A, status: 'ACTIVE', enrollments: { some: { courseId: PATH, term: TERM, status: 'ENROLLED' } } }, select: { user: { select: { fullName: true } } } });
    expect(r.body.total).toBe(expected.length); expect(r.body.total).toBeGreaterThan(0);
    expect(r.body.items.map((x: any) => x.name).sort()).toEqual(expected.map((e) => e.user.fullName).sort());
    for (const item of r.body.items) expect(Object.keys(item)).toEqual(['name']);
    expect(r.raw).not.toMatch(/@|DMC-|regNo|attendance|email|phone|guardian|address|score|marks|grade|percent|studentId|"id"/i);
    const campusB = await ctx.prisma.student.findMany({ where: { institutionId: B }, select: { user: { select: { fullName: true } } } });
    for (const s of campusB) expect(r.body.items.map((x: any) => x.name)).not.toContain(s.user.fullName);
    const one = expected[0]!.user.fullName.split(' ')[0]!; expect((await t.c.get(`/teacher/students?search=${encodeURIComponent(one)}`)).body.items.every((x: any) => x.name.toLowerCase().includes(one.toLowerCase()))).toBe(true);
    expect((await t.c.get(`/teacher/students?assignmentId=${t.rows[0]!.id}&pageSize=200`)).body.total).toBe(expected.length);
    expect((await t.c.get('/teacher/students?page=0')).status).toBe(400);
  });
  it('excludes withdrawn enrolments and other terms, and never serves student detail routes to a teacher', async () => {
    const t = await register({ assignments: [req(PATH)] }); const a = await as(ctx, 'admin.a'); await a.post(`/admin/teachers/${t.userId}/decision`, { decision: 'APPROVE' }); await a.post(`/admin/teachers/assignments/${t.rows[0]!.id}/decision`, { decision: 'APPROVE' });
    const enr = await ctx.prisma.enrollment.findFirstOrThrow({ where: { courseId: PATH, term: TERM, student: { institutionId: A } }, include: { student: { include: { user: true } } } });
    const before = (await t.c.get('/teacher/students?pageSize=200')).body.total;
    await ctx.prisma.enrollment.update({ where: { id: enr.id }, data: { status: 'WITHDRAWN' } });
    const after = (await t.c.get('/teacher/students?pageSize=200')).body; expect(after.total).toBe(before - 1); expect(after.items.map((x: any) => x.name)).not.toContain(enr.student.user.fullName);
    await ctx.prisma.enrollment.update({ where: { id: enr.id }, data: { status: 'ENROLLED' } });
    for (const url of ['/students', `/students/${enr.studentId}`, '/enrollments?courseId=' + PATH + '&term=' + TERM, '/roster', '/users']) expect([403, 404], url).toContain((await t.c.get(url)).status);
  });
});

describe('boundaries: results, grades and existing roles', () => {
  it('a teacher is refused every result, grading, exam, student-record, certificate and report route', async () => {
    const t = await register(); await approveAll(t); const exam = ctx.seeded.examId;
    const urls = [`/results/exams/${exam}`, `/grading/exams`, `/grading/exams/${exam}/analysis`, '/me/results', '/exams', `/exams/${exam}`, `/exams/${exam}/roster`, '/students', '/enrollments?courseId=' + PATH + '&term=' + TERM, '/reports/dashboard', '/audit', '/questions', '/institutions', '/users', '/course-assignments', '/roster', '/monitor/exams'];
    for (const u of urls) { const r = await t.c.get(u); expect([401, 403, 404], `${u} → ${r.status}`).toContain(r.status); expect(r.raw, u).not.toMatch(/"percent"|"score"|"grade"|"marks"/); }
    expect((await t.c.post(`/results/exams/${exam}/publish`)).status).toBe(403); expect((await t.c.post('/attempts/start', { examId: exam, clientId: 'x' })).status).toBe(403);
  });
  it('the permission matrix gives TEACHER only the baseline signed-in permission and the two teacher permissions, and every route still declares one permission', () => {
    const mine = Object.entries(PERMISSIONS).filter(([, roles]) => (roles as readonly string[]).includes('TEACHER')).map(([p]) => p).sort();
    expect(mine).toEqual(['program.read', 'teacher.self', 'teacher.work']);
    expect(PERMISSIONS['teacher.manage']).toEqual(['SUPER_ADMIN', 'CAMPUS_ADMIN']);
    for (const p of ['result.read_scoped', 'result.read_own', 'grading.review', 'student.read', 'exam.read', 'question.read']) expect((PERMISSIONS as any)[p]).not.toContain('TEACHER');
  });
  it('lecturers, examiners and administrators keep exactly what they had: lecturers still need an APPROVED assignment, pending rows give them nothing', async () => {
    const lect = await as(ctx, 'lecturer.a'); expect((await lect.get('/questions')).status).toBe(200); const mine = (await lect.get('/me/course-assignments')).body; expect((Array.isArray(mine) ? mine : mine.items).length).toBeGreaterThan(0);
    const lec = await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'lecturer.a2@demo.szabmu.invalid' } });
    await ctx.prisma.courseAssignment.create({ data: { userId: lec.id, courseId: ctx.seeded.courses.path.id, institutionId: A, assignedById: lec.id, status: 'PENDING' } });
    const l2 = await as(ctx, 'lecturer.a2'); const pathQs = (await l2.get(`/questions?courseId=${PATH}&pageSize=100`)).body.items; expect(pathQs).toHaveLength(0);   // a PENDING row confers nothing
    expect((await (await as(ctx, 'examiner')).get('/questions')).status).toBe(200); expect((await (await as(ctx, 'cce')).get('/exams')).status).toBe(200);
  });
  it('student-facing paper delivery never carries the answer key', async () => {
    const student = await as(ctx, 'student.a002'); const s = await startExam(ctx, student);
    expect(s.res.raw).not.toMatch(/isCorrect|correctLabel|"explanation"/);
  });
});

describe('teacher profile', () => {
  it('lets the teacher update contact and role details and photo, never name, email, faculty ID or assignments', async () => {
    const t = await register(); await approveAll(t);
    const png = 'data:image/png;base64,' + Buffer.concat([Buffer.from([0x89]), Buffer.from('PNG\r\n\x1a\n'), Buffer.alloc(40)]).toString('base64');
    const r = await t.c.patch('/teacher/profile', { phone: '0300-7654321', designation: 'Professor', photo: png, fullName: 'Hacked', email: 'x@y.z', employeeId: 'EMP-HACK' }); expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ phone: '0300-7654321', designation: 'Professor', fullName: t.f.fullName, email: t.f.email, employeeId: t.f.employeeId }); expect(r.body.photo).toMatch(/^data:image\/png;base64,/);
    expect((await t.c.patch('/teacher/profile', { phone: 'abc' })).status).toBe(400); expect((await t.c.patch('/teacher/profile', { photo: null })).body.photo).toBeNull();
    expect(await ctx.prisma.auditLog.count({ where: { action: 'teacher.profile_updated', entityId: t.userId } })).toBe(2);
  });
});
