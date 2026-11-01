import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as as login, boot, cid, save, Client, type Ctx } from './helpers';
import { DOMAIN, TERM, asUser } from '../src/seed/seed';
import { ExamsService } from '../src/modules/exams/exams.service';
import { LifecycleService } from '../src/modules/control/lifecycle.service';
import { ExamEventsService } from '../src/modules/control/events.service';
import { JobsService } from '../src/modules/jobs.service';

/**
 * Live exam control, end to end against real PostgreSQL + Redis. Exams are built through the REAL services (create → paper → four-eyes
 * approval → schedule) and driven only through the HTTP API; the database is read to prove what actually happened.
 */
/** Sessions are memoised per account: the sign-in rate limiter (5 per identity) is itself under test elsewhere, and re-login per call would trip it. */
const sessions = new Map<string, Client>();
async function as(c: Ctx, local: string): Promise<Client> { const k = `${local}`; let s = sessions.get(k); if (!s) { s = await login(c, local); sessions.set(k, s); } return s; }
let ctx: Ctx; let A: string; let B: string; let seq = 0;
beforeAll(async () => { ctx = await boot({ studentsPerCampus: 6 }); A = ctx.seeded.institutions.a.id; B = ctx.seeded.institutions.b.id; });
afterAll(async () => { await ctx.app.close(); });

const key = () => `k${++seq}-${Math.random().toString(36).slice(2, 10)}`;
const ago = (ms: number) => new Date(Date.now() - ms);
const ahead = (ms: number) => new Date(Date.now() + ms);

interface Opt { controlMode?: 'AUTOMATIC' | 'MANUAL'; timingPolicy?: 'INDIVIDUAL' | 'SYNCHRONIZED'; durationMin?: number; opensAt?: Date; closesAt?: Date; suspendPolicy?: 'FREEZE_CLOCK' | 'CLOCK_CONTINUES' }
/** A scheduled exam built exactly as production builds one. The roster comes from real enrolments. */
async function makeExam(o: Opt = {}) {
  const esvc = ctx.app.get(ExamsService); const code = `CTL-${++seq}-${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
  const rev = await asUser(ctx.prisma, `examiner@${DOMAIN}`); const cceU = await asUser(ctx.prisma, `cce@${DOMAIN}`); const sa = await asUser(ctx.prisma, `super.admin@${DOMAIN}`);
  const exam = await esvc.create(rev, { code, title: `Control ${code}`, courseId: ctx.seeded.courses.path.id, term: TERM, opensAt: o.opensAt ?? ahead(o.timingPolicy === 'SYNCHRONIZED' && o.closesAt ? 60_000 : 3600_000), closesAt: o.closesAt ?? ahead(86400_000), durationMin: o.durationMin ?? 45, passPercent: 50, negativeMarking: 0, shuffleQuestions: true, institutionIds: [A, B], controlMode: o.controlMode ?? 'MANUAL', timingPolicy: o.timingPolicy ?? 'INDIVIDUAL' });
  await esvc.setPaper(sa, exam.id, ctx.seeded.questionIds.PATH.slice(0, 4).map((questionId) => ({ questionId, marks: 2 })));
  await esvc.submitPaper(rev, exam.id); await esvc.reviewPaper(cceU, exam.id, 'APPROVE', 'ok');
  await esvc.schedule(rev, exam.id);
  if (o.suspendPolicy) await ctx.prisma.exam.update({ where: { id: exam.id }, data: { suspendTimePolicy: o.suspendPolicy, controlPolicyApprovedBy: sa.id, controlPolicyApprovedAt: new Date() } });
  return exam.id;
}
const ctl = (id: string, cmd: string) => `/exams/${id}/control/${cmd}`;
const startAs = async (local: string, examId: string) => { const s = await as(ctx, local); const clientId = cid(); const r = await s.post('/attempts/start', { examId, clientId }); return { s, clientId, r, attemptId: r.body?.attempt?.id as string | undefined }; };
const events = (examId: string) => ctx.prisma.examEvent.findMany({ where: { examId }, orderBy: { id: 'asc' } });
const audits = (examId: string) => ctx.prisma.auditLog.findMany({ where: { entityId: examId, action: { startsWith: 'exam.' } }, orderBy: { seq: 'asc' } });
const stateOf = (id: string) => ctx.prisma.exam.findUniqueOrThrow({ where: { id } });
const qids = async (examId: string) => (await ctx.prisma.examQuestion.findMany({ where: { examId }, orderBy: { position: 'asc' } })).map((q) => q.id);
const answer = async (st: { s: Client; clientId: string; attemptId?: string }, q: string, rev: number, label: string | null = 'A') => save(st.s, st.attemptId!, q, st.clientId, rev, label);

describe('1–5 admission', () => {
  let id: string; let cce: Client;
  beforeAll(async () => { id = await makeExam(); cce = await as(ctx, 'cce'); });

  it('nobody can start before admission is opened; the controller opens it (state, event and audit written together)', async () => {
    expect((await startAs('student.a002', id)).r.status).toBe(409);
    const v0 = (await stateOf(id)).stateVersion;
    const r = await cce.post(ctl(id, 'open-admission'), { idempotencyKey: key() });
    expect(r.status).toBe(200); expect(r.body).toMatchObject({ changed: true, state: { status: 'ADMISSION_OPEN' } });
    const ex = await stateOf(id); expect(ex.status).toBe('ADMISSION_OPEN'); expect(ex.stateVersion).toBe(v0 + 1); expect(ex.admissionOpenedAt).toBeTruthy();
    expect((await events(id)).map((e) => [e.type, e.aggregateVersion])).toContainEqual(['ADMISSION_OPENED', v0 + 1]);
    expect((await audits(id)).map((a) => a.action)).toContain('exam.control.open_admission');
  });

  it('opening again is idempotent: no new version, event or audit row', async () => {
    const before = { v: (await stateOf(id)).stateVersion, e: (await events(id)).length, a: (await audits(id)).length };
    const r = await cce.post(ctl(id, 'open-admission'), {});
    expect(r.status).toBe(200); expect(r.body.changed).toBe(false);
    expect({ v: (await stateOf(id)).stateVersion, e: (await events(id)).length, a: (await audits(id)).length }).toEqual(before);
  });

  it('1/2. an eligible student enters and gets the individual deadline; 3. an ineligible one is rejected; opening admission touched no deadline', async () => {
    const t0 = Date.now(); const ok = await startAs('student.a002', id);
    expect(ok.r.status).toBe(200);
    const dl = new Date(ok.r.body.attempt.deadlineAt).getTime(); expect(Math.abs(dl - (t0 + 45 * 60_000))).toBeLessThan(5000);
    expect(ok.r.body.control).toMatchObject({ examStatus: 'ADMISSION_OPEN', suspended: false, timingPolicy: 'INDIVIDUAL' });
    await cce.post(`/exams/${id}/candidates/${(await ctx.prisma.student.findFirstOrThrow({ where: { regNo: 'DMC-B-2024-0003' } })).id}/override`, { decision: 'REVOKE', reason: 'Synthetic: withdrawn by the examination office' });
    const bad = await startAs('student.b003', id); expect(bad.r.status).toBeGreaterThanOrEqual(400);
    expect(bad.attemptId).toBeUndefined(); expect(await ctx.prisma.attempt.count({ where: { examId: id } })).toBe(1);
    expect((await startAs('student.a001', id)).r.status).toBe(403);             // not on the roster at all
  });

  it('4/5. closing admission blocks new entrants but the active attempt keeps saving and can resume', async () => {
    const active = await startAs('student.a002', id);                             // resume with a new tab = claim; fine
    const q = await qids(id); expect((await answer(active, q[0]!, 1)).status).toBe(200);
    const r = await cce.post(ctl(id, 'close-admission'), {});
    expect(r.status).toBe(200); expect(r.body.changed).toBe(true);
    const late = await startAs('student.a003', id); expect(late.r.status).toBe(409); expect(late.r.body.code).toBe('ADMISSION_CLOSED');
    const again = await startAs('student.a002', id); expect(again.r.status).toBe(200);          // already-admitted student may still resume
    expect((await answer(again, q[1]!, 1, 'B')).status).toBe(200);
    expect((await ctx.prisma.attempt.findFirstOrThrow({ where: { examId: id } })).status).toBe('IN_PROGRESS');
    expect((await cce.post(ctl(id, 'close-admission'), {})).body.changed).toBe(false);          // idempotent
    expect((await cce.post(ctl(id, 'open-admission'), {})).body.changed).toBe(true);            // and it can be re-opened
  });

  it('preconditions are checked and ALL failures reported; a DRAFT exam cannot open admission', async () => {
    const draft = await ctx.prisma.exam.create({ data: { code: `DRF-${++seq}`, title: 'Draft', courseId: ctx.seeded.courses.path.id, createdBy: (await ctx.prisma.user.findFirstOrThrow({ where: { role: 'SUPER_ADMIN' } })).id, opensAt: ahead(1e6), closesAt: ahead(2e6), durationMin: 30 } });
    const r = await cce.post(ctl(draft.id, 'open-admission'), {});
    expect(r.status).toBe(409); expect(r.body.code).toBe('BAD_STATE');
    const sched = await ctx.prisma.exam.create({ data: { code: `NOP-${++seq}`, title: 'No paper', courseId: ctx.seeded.courses.path.id, createdBy: (await ctx.prisma.user.findFirstOrThrow({ where: { role: 'SUPER_ADMIN' } })).id, status: 'SCHEDULED', opensAt: ahead(1e6), closesAt: ahead(2e6), durationMin: 30, institutions: { create: [{ institutionId: A }] } } });
    const p = await cce.post(ctl(sched.id, 'open-admission'), {});
    expect(p.status).toBe(409); expect(p.body.code).toBe('PRECONDITION_FAILED');
    expect(p.body.failed).toEqual(expect.arrayContaining(['The question paper is not approved', 'The paper has no questions', 'No candidate roster is assigned']));
  });
});

describe('16/30 authorization: campus staff never gain exam-wide control', () => {
  it('only CCE/Super Admin run commands; examiner may view but not control; campus staff, lecturer and student are refused on every endpoint', async () => {
    const id = await makeExam({ suspendPolicy: 'FREEZE_CLOCK' });
    const cmds: [string, object][] = [['open-admission', {}], ['close-admission', {}], ['start', {}], ['suspend', { scope: 'EXAM', reason: 'A sufficiently long reason', confirm: true }], ['resume', { confirm: true }],
      ['extend', { scope: 'EXAM', minutes: 5, reason: 'A sufficiently long reason', confirm: true, idempotencyKey: 'abcdefgh1' }], ['extend/preview', { scope: 'EXAM', minutes: 5 }], ['close', {}], ['reconcile', {}], ['initiate-scoring', {}], ['policy', { suspendTimePolicy: 'FREEZE_CLOCK' }]];
    for (const who of ['examiner', 'admin.a', 'admin.b', 'invigilator.a', 'lecturer.a', 'student.a002']) {
      const c = await as(ctx, who);
      for (const [cmd, body] of cmds) expect((await c.post(ctl(id, cmd), body)).status, `${who} ${cmd}`).toBe(403);
    }
    const anon = new Client(ctx.app);                                                                  // no session at all
    for (const [cmd, body] of cmds) expect((await anon.post(ctl(id, cmd), body)).status, `anon ${cmd}`).toBe(401);
    expect((await (await as(ctx, 'examiner')).get(`/exams/${id}/control`)).status).toBe(200);        // view-only
    for (const who of ['admin.a', 'invigilator.a', 'lecturer.a', 'student.a002']) expect((await (await as(ctx, who)).get(`/exams/${id}/control`)).status, `${who} view`).toBe(403);
    const examiner = await as(ctx, 'examiner'); expect((await examiner.post(ctl(id, 'policy'), { suspendTimePolicy: 'CLOCK_CONTINUES' })).status).toBe(403);
    expect((await ctx.prisma.exam.findUniqueOrThrow({ where: { id } })).status).toBe('SCHEDULED');    // nothing changed
    expect(await ctx.prisma.examEvent.count({ where: { examId: id } })).toBe(0);
  });
});

describe('6/7 timing policies', () => {
  it('SYNCHRONIZED: candidates wait in the lobby (no attempt, no paper) until START; every candidate then shares ONE deadline', async () => {
    const id = await makeExam({ timingPolicy: 'SYNCHRONIZED', durationMin: 30 }); const cce = await as(ctx, 'cce');
    await cce.post(ctl(id, 'open-admission'), {});
    const wait = await startAs('student.a002', id);
    expect(wait.r.status).toBe(409); expect(wait.r.body.code).toBe('WAITING_FOR_START'); expect(wait.r.body.questions).toBeUndefined();
    expect(await ctx.prisma.attempt.count({ where: { examId: id } })).toBe(0);
    const st = await cce.post(ctl(id, 'start'), {});
    expect(st.body).toMatchObject({ changed: true, state: { status: 'LIVE' } });
    const official = new Date(st.body.officialStartAt).getTime();
    const first = await startAs('student.a002', id); await new Promise((r) => setTimeout(r, 1200)); const second = await startAs('student.b002', id);
    expect(first.r.status).toBe(200); expect(second.r.status).toBe(200);
    const d1 = first.r.body.attempt.deadlineAt; expect(second.r.body.attempt.deadlineAt).toBe(d1);       // joined later, same clock
    expect(new Date(d1).getTime()).toBe(official + 30 * 60_000);
    expect((await cce.post(ctl(id, 'start'), {})).body.changed).toBe(false);                           // idempotent; official start never moves
    expect(new Date((await stateOf(id)).officialStartAt!).getTime()).toBe(official);
  });

  it('SYNCHRONIZED start that would end after the window is refused unless the controller confirms extending the window', async () => {
    const id = await makeExam({ timingPolicy: 'SYNCHRONIZED', durationMin: 20, closesAt: ahead(25 * 60_000) }); const cce = await as(ctx, 'cce');
    await ctx.prisma.exam.update({ where: { id }, data: { closesAt: ahead(10 * 60_000) } });                 // the window shrank after approval: starting now would overrun it
    const r = await cce.post(ctl(id, 'start'), {}); expect(r.status).toBe(409); expect(r.body.code).toBe('WINDOW_TOO_SHORT');
    expect((await stateOf(id)).status).toBe('SCHEDULED');
    const ok = await cce.post(ctl(id, 'start'), { extendWindow: true }); expect(ok.status).toBe(200);
    expect((await stateOf(id)).closesAt.getTime()).toBeGreaterThan(Date.now() + 19 * 60_000);
  });

  it('INDIVIDUAL: START only opens the exam; each candidate gets their own clock from their own start', async () => {
    const id = await makeExam({ durationMin: 20 }); const cce = await as(ctx, 'cce');
    await cce.post(ctl(id, 'start'), {});
    const a = await startAs('student.a002', id); await new Promise((r) => setTimeout(r, 1100)); const b = await startAs('student.b002', id);
    expect(new Date(b.r.body.attempt.deadlineAt).getTime() - new Date(a.r.body.attempt.deadlineAt).getTime()).toBeGreaterThanOrEqual(1000);
  });
});

describe('8–12 suspend and resume', () => {
  let id: string; let cce: Client; let a: Awaited<ReturnType<typeof startAs>>; let b: Awaited<ReturnType<typeof startAs>>; let sealed: Awaited<ReturnType<typeof startAs>>; let q: string[];
  beforeAll(async () => {
    id = await makeExam(); cce = await as(ctx, 'cce'); await cce.post(ctl(id, 'start'), {});
    a = await startAs('student.a002', id); b = await startAs('student.b002', id); sealed = await startAs('student.a003', id); q = await qids(id);
    for (const [i, st] of [a, b, sealed].entries()) { expect((await answer(st, q[0]!, 1, 'ABC'[i]!)).status).toBe(200); }
    expect((await sealed.s.post(`/attempts/${sealed.attemptId}/submit`, { clientId: sealed.clientId, submitKey: 'sealed-before-suspend' })).status).toBe(200);
  });

  it('suspending is refused while the time policy is unapproved; approval needs exam.control.policy and is stamped; it freezes after the exam starts', async () => {
    const r = await cce.post(ctl(id, 'suspend'), { scope: 'EXAM', reason: 'Power failure in the main hall', confirm: true });
    expect(r.status).toBe(409); expect(r.body.code).toBe('POLICY_NOT_APPROVED');
    const fresh = await makeExam(); const p = await cce.post(ctl(fresh, 'policy'), { suspendTimePolicy: 'FREEZE_CLOCK' });
    expect(p.status).toBe(200); const ex = await stateOf(fresh); expect(ex.suspendTimePolicy).toBe('FREEZE_CLOCK'); expect(ex.controlPolicyApprovedBy).toBeTruthy(); expect(ex.controlPolicyApprovedAt).toBeTruthy();
    expect((await audits(fresh)).map((x) => x.action)).toContain('exam.control.policy');
    expect((await cce.post(ctl(id, 'policy'), { suspendTimePolicy: 'FREEZE_CLOCK' })).status).toBe(409);      // started: policy is frozen
    await ctx.prisma.exam.update({ where: { id }, data: { suspendTimePolicy: 'FREEZE_CLOCK', controlPolicyApprovedBy: ex.controlPolicyApprovedBy, controlPolicyApprovedAt: new Date() } });   // approved earlier in this scenario
  });

  it('validation: explicit confirmation and a real reason are required', async () => {
    expect((await cce.post(ctl(id, 'suspend'), { scope: 'EXAM', reason: 'Power failure in the main hall', confirm: false })).status).toBe(400);
    expect((await cce.post(ctl(id, 'suspend'), { scope: 'EXAM', reason: 'short', confirm: true })).status).toBe(400);
    expect((await cce.post(ctl(id, 'suspend'), { scope: 'CAMPUS', reason: 'Power failure in the main hall', confirm: true })).status).toBe(400);   // campus needs institutionId
    expect((await stateOf(id)).status).toBe('LIVE');
  });

  let dlBefore: { a: number; b: number }; let suspensionId: string; let versionAtSuspend: number;
  it('8–10. suspend (whole exam): state, candidates and BACKEND enforcement — saves, submits and new starts are refused; confirmed answers stay', async () => {
    dlBefore = { a: (await ctx.prisma.attempt.findUniqueOrThrow({ where: { id: a.attemptId } })).deadlineAt.getTime(), b: (await ctx.prisma.attempt.findUniqueOrThrow({ where: { id: b.attemptId } })).deadlineAt.getTime() };
    const r = await cce.post(ctl(id, 'suspend'), { scope: 'EXAM', reason: 'Power failure in the main hall', confirm: true, idempotencyKey: key() });
    expect(r.status).toBe(200); expect(r.body).toMatchObject({ changed: true, affected: 2, timePolicy: 'FREEZE_CLOCK', state: { status: 'SUSPENDED' } });
    suspensionId = r.body.suspensionId; versionAtSuspend = (await stateOf(id)).stateVersion;
    const w = await answer(a, q[1]!, 1, 'D'); expect(w.status).toBe(409); expect(w.body.code).toBe('EXAM_SUSPENDED');
    expect((await b.s.post(`/attempts/${b.attemptId}/submit`, { clientId: b.clientId, submitKey: 'during-suspension' })).body.code).toBe('EXAM_SUSPENDED');
    const hb = await a.s.post(`/attempts/${a.attemptId}/heartbeat`, { clientId: a.clientId });
    expect(hb.body).toMatchObject({ suspended: true, examStatus: 'SUSPENDED', status: 'IN_PROGRESS' });
    const resume = await a.s.post('/attempts/start', { examId: id, clientId: a.clientId });                // a reload still works and tells the player it is suspended
    expect(resume.status).toBe(200); expect(resume.body.control).toMatchObject({ suspended: true, examStatus: 'SUSPENDED' });
    expect(resume.body.answers.find((x: { examQuestionId: string }) => x.examQuestionId === q[0])).toMatchObject({ selectedLabel: 'A', revision: 1 });
    expect((await startAs('student.b004', id)).r.body.code).toBe('EXAM_SUSPENDED');                        // nobody new may enter
    expect(await ctx.prisma.attemptAnswer.count({ where: { attemptId: a.attemptId, examQuestionId: q[1] } })).toBe(0);   // the refused write did not land
    expect((await ctx.prisma.attempt.findUniqueOrThrow({ where: { id: sealed.attemptId } })).suspendedAt).toBeNull();     // a sealed attempt is not suspended
    expect((await ctx.prisma.attemptEvent.findMany({ where: { attemptId: a.attemptId, kind: 'SUSPENDED' } })).length).toBe(1);
    expect((await cce.post(ctl(id, 'suspend'), { scope: 'EXAM', reason: 'Power failure in the main hall', confirm: true })).body.changed).toBe(false);   // idempotent
    expect((await ctx.prisma.examSuspension.count({ where: { examId: id } }))).toBe(1);
  });

  it('11/12. resume (FREEZE_CLOCK): each deadline moves by its own paused time, answers intact, saving works, the sealed attempt is untouched', async () => {
    await new Promise((r) => setTimeout(r, 2200));
    const sealedBefore = await ctx.prisma.attempt.findUniqueOrThrow({ where: { id: sealed.attemptId } });
    const r = await cce.post(ctl(id, 'resume'), { confirm: true, note: 'Power restored' });
    expect(r.status).toBe(200); expect(r.body).toMatchObject({ changed: true, resumed: 2, state: { status: 'LIVE' } });
    expect(r.body.pausedSeconds).toBeGreaterThanOrEqual(2);
    const aNow = await ctx.prisma.attempt.findUniqueOrThrow({ where: { id: a.attemptId } });
    expect(aNow.deadlineAt.getTime() - dlBefore.a).toBeGreaterThanOrEqual(2000); expect(aNow.deadlineAt.getTime() - dlBefore.a).toBeLessThan(15_000);
    expect(aNow.suspendedAt).toBeNull(); expect(aNow.suspensionId).toBeNull();
    expect((await answer(a, q[1]!, 1, 'D')).status).toBe(200);
    expect((await ctx.prisma.attemptAnswer.findUniqueOrThrow({ where: { attemptId_examQuestionId: { attemptId: a.attemptId!, examQuestionId: q[0]! } } })).selectedLabel).toBe('A');     // confirmed answer survived
    const sealedAfter = await ctx.prisma.attempt.findUniqueOrThrow({ where: { id: sealed.attemptId } });
    expect(sealedAfter.status).toBe(sealedBefore.status); expect(sealedAfter.receiptCode).toBe(sealedBefore.receiptCode); expect(sealedAfter.deadlineAt).toEqual(sealedBefore.deadlineAt);
    const sus = await ctx.prisma.examSuspension.findUniqueOrThrow({ where: { id: suspensionId } }); expect(sus.resumedAt).toBeTruthy(); expect(sus.pausedSeconds).toBe(r.body.pausedSeconds);
    expect((await stateOf(id)).stateVersion).toBe(versionAtSuspend + 1);
    expect((await cce.post(ctl(id, 'resume'), { confirm: true })).body.changed).toBe(false);                // idempotent
    expect((await b.s.post(`/attempts/${b.attemptId}/heartbeat`, { clientId: b.clientId })).body).toMatchObject({ suspended: false, examStatus: 'LIVE' });
  });

  it('CLOCK_CONTINUES never changes a deadline; the reason it exists is a policy choice, not an accident', async () => {
    const x = await makeExam({ suspendPolicy: 'CLOCK_CONTINUES' }); await cce.post(ctl(x, 'start'), {});
    const s1 = await startAs('student.a004', x); const before = (await ctx.prisma.attempt.findUniqueOrThrow({ where: { id: s1.attemptId } })).deadlineAt.getTime();
    await cce.post(ctl(x, 'suspend'), { scope: 'EXAM', reason: 'Fire drill, whole building', confirm: true }); await new Promise((r) => setTimeout(r, 1500));
    const r = await cce.post(ctl(x, 'resume'), { confirm: true });
    expect(r.body).toMatchObject({ changed: true, pausedSeconds: 0, timePolicy: 'CLOCK_CONTINUES' });
    expect((await ctx.prisma.attempt.findUniqueOrThrow({ where: { id: s1.attemptId } })).deadlineAt.getTime()).toBe(before);
    expect((await stateOf(x)).closesAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('partial scopes: a CAMPUS suspension stops only that campus (including new entrants); a CANDIDATES suspension only the selected ones; each resumes by id', async () => {
    const x = await makeExam({ suspendPolicy: 'FREEZE_CLOCK' }); await cce.post(ctl(x, 'start'), {});
    const sa = await startAs('student.a002', x); const sb = await startAs('student.b002', x); const sc = await startAs('student.a004', x); const xq = await qids(x);
    const cs = await cce.post(ctl(x, 'suspend'), { scope: 'CAMPUS', institutionId: A, reason: 'Campus A network failure', confirm: true });
    expect(cs.body).toMatchObject({ changed: true, affected: 2, state: { status: 'LIVE' } });                    // the exam itself keeps running
    expect((await answer(sa, xq[0]!, 1)).body.code).toBe('EXAM_SUSPENDED'); expect((await answer(sc, xq[0]!, 1)).body.code).toBe('EXAM_SUSPENDED');
    expect((await answer(sb, xq[0]!, 1)).status).toBe(200);                                                     // campus B unaffected
    expect((await startAs('student.a005', x)).r.body.code).toBe('EXAM_SUSPENDED');                              // campus A newcomer blocked
    expect((await startAs('student.b004', x)).r.status).toBe(200);                                              // campus B newcomer fine
    const amb = await cce.post(ctl(x, 'suspend'), { scope: 'CANDIDATES', studentIds: [(await ctx.prisma.attempt.findUniqueOrThrow({ where: { id: sb.attemptId } })).studentId], reason: 'Candidate medical emergency', confirm: true });
    expect(amb.body).toMatchObject({ changed: true, affected: 1 });
    expect((await answer(sb, xq[1]!, 1)).body.code).toBe('EXAM_SUSPENDED');
    const nores = await cce.post(ctl(x, 'resume'), { confirm: true });                                          // two partial suspensions open: ambiguous, refused
    expect(nores.status).toBe(409); expect(nores.body.code).toBe('AMBIGUOUS');
    expect((await cce.post(ctl(x, 'resume'), { confirm: true, suspensionId: cs.body.suspensionId })).body.changed).toBe(true);
    expect((await answer(sa, xq[0]!, 1)).status).toBe(200); expect((await answer(sb, xq[1]!, 1)).body.code).toBe('EXAM_SUSPENDED');   // B-candidate still suspended
    expect((await cce.post(ctl(x, 'resume'), { confirm: true, suspensionId: amb.body.suspensionId })).body.changed).toBe(true);
    expect((await answer(sb, xq[1]!, 1)).status).toBe(200);
  });
});

describe('13–15 extension', () => {
  let id: string; let cce: Client; let a: Awaited<ReturnType<typeof startAs>>; let b: Awaited<ReturnType<typeof startAs>>; let c: Awaited<ReturnType<typeof startAs>>;
  const dl = async (att?: string) => (await ctx.prisma.attempt.findUniqueOrThrow({ where: { id: att } })).deadlineAt.getTime();
  beforeAll(async () => { id = await makeExam(); cce = await as(ctx, 'cce'); await cce.post(ctl(id, 'start'), {}); a = await startAs('student.a002', id); b = await startAs('student.b002', id); c = await startAs('student.a003', id);
    await c.s.post(`/attempts/${c.attemptId}/submit`, { clientId: c.clientId, submitKey: 'ext-sealed' }); });

  it('preview reports who is affected and the new deadlines without changing anything', async () => {
    const before = await dl(a.attemptId);
    const p = await cce.post(ctl(id, 'extend/preview'), { scope: 'EXAM', minutes: 15 });
    expect(p.status).toBe(200); expect(p.body).toMatchObject({ affected: 2, minutes: 15 });
    expect(new Date(p.body.newLatestDeadline).getTime() - new Date(p.body.currentLatestDeadline).getTime()).toBe(15 * 60_000);
    expect(await dl(a.attemptId)).toBe(before);
  });

  it('13/14. selected candidates get exactly +N minutes; others and the sealed attempt do not; 15. a duplicate request is not applied twice', async () => {
    const [a0, b0, c0] = [await dl(a.attemptId), await dl(b.attemptId), await dl(c.attemptId)];
    const k = key(); const sid = (await ctx.prisma.attempt.findUniqueOrThrow({ where: { id: a.attemptId } })).studentId;
    const body = { scope: 'CANDIDATES', studentIds: [sid], minutes: 10, reason: 'Candidate lost 10 minutes to a verified hall disturbance', confirm: true, idempotencyKey: k };
    const r1 = await cce.post(ctl(id, 'extend'), body);
    expect(r1.status).toBe(200); expect(r1.body).toMatchObject({ changed: true, affected: 1, minutes: 10 });
    expect(await dl(a.attemptId)).toBe(a0 + 10 * 60_000); expect(await dl(b.attemptId)).toBe(b0);
    const r2 = await cce.post(ctl(id, 'extend'), body);                                                          // retry with the SAME key
    expect(r2.status).toBe(200); expect(r2.body.replayed).toBe(true); expect(r2.body.affected).toBe(1);
    expect(await dl(a.attemptId)).toBe(a0 + 10 * 60_000);                                                        // not 20
    expect(await ctx.prisma.examExtension.count({ where: { examId: id, idempotencyKey: k } })).toBe(1);
    expect((await ctx.prisma.attemptEvent.findMany({ where: { attemptId: a.attemptId, kind: 'TIME_EXTENDED' } })).length).toBe(1);
    expect((await cce.post(ctl(id, 'resume'), { confirm: true, idempotencyKey: k })).body?.code).toBe('KEY_REUSED');     // a key belongs to one command
    expect(await dl(c.attemptId)).toBe(c0);                                                                       // sealed attempt never reopened
    const sealed = await ctx.prisma.attempt.findUniqueOrThrow({ where: { id: c.attemptId } }); expect(sealed.status).toBe('SUBMITTED');
    const audit = (await audits(id)).filter((x) => x.action === 'exam.control.extend'); expect(audit.length).toBe(1);
    expect(audit[0]!.meta).toMatchObject({ scope: 'CANDIDATES', minutes: 10, affected: 1, approvedBy: expect.any(String), reason: expect.stringContaining('verified hall') });
  });

  it('validation: idempotency key, reason, confirmation and the 240-minute cap are enforced; a campus scope extends only that campus', async () => {
    const ok = { scope: 'EXAM', minutes: 5, reason: 'A sufficiently long reason', confirm: true };
    expect((await cce.post(ctl(id, 'extend'), { ...ok })).status).toBe(400);                                      // key required
    expect((await cce.post(ctl(id, 'extend'), { ...ok, idempotencyKey: key(), confirm: false })).status).toBe(400);
    expect((await cce.post(ctl(id, 'extend'), { ...ok, idempotencyKey: key(), minutes: 241 })).status).toBe(400);
    expect((await cce.post(ctl(id, 'extend'), { ...ok, idempotencyKey: key(), reason: 'short' })).status).toBe(400);
    const [a0, b0] = [await dl(a.attemptId), await dl(b.attemptId)];
    const r = await cce.post(ctl(id, 'extend'), { ...ok, scope: 'CAMPUS', institutionId: B, minutes: 7, idempotencyKey: key() });
    expect(r.body).toMatchObject({ changed: true, affected: 1 }); expect(await dl(b.attemptId)).toBe(b0 + 7 * 60_000); expect(await dl(a.attemptId)).toBe(a0);
    const none = await cce.post(ctl(id, 'extend'), { ...ok, scope: 'CANDIDATES', studentIds: [(await ctx.prisma.attempt.findUniqueOrThrow({ where: { id: c.attemptId } })).studentId], idempotencyKey: key() });
    expect(none.status).toBe(409); expect(none.body.code).toBe('NO_ACTIVE_ATTEMPTS');                              // only a sealed attempt selected
  });

  it('exam-wide scope also moves the window end (late entrants are not cut off)', async () => {
    const before = (await stateOf(id)).closesAt.getTime();
    const r = await cce.post(ctl(id, 'extend'), { scope: 'EXAM', minutes: 20, reason: 'Whole-exam disruption, verified', confirm: true, idempotencyKey: key() });
    expect(r.body.changed).toBe(true); expect((await stateOf(id)).closesAt.getTime()).toBe(before + 20 * 60_000);
    expect((await ctx.prisma.examExtension.findFirstOrThrow({ where: { examId: id, scope: 'EXAM' } })).closesAtAfter!.getTime()).toBe(before + 20 * 60_000);
  });

  it('extension racing automatic submission: either the extension lands and the attempt is NOT sealed, or the attempt is sealed and NOT extended — never both', async () => {
    const x = await makeExam(); await cce.post(ctl(x, 'start'), {});
    const locals = ['student.a002', 'student.a003', 'student.a004', 'student.a005', 'student.a006', 'student.b002', 'student.b004', 'student.b005'];
    const life = ctx.app.get(LifecycleService); const outcomes = { extended: 0, sealed: 0 };
    for (const local of locals) {
      const st = await startAs(local, x); const sid = (await ctx.prisma.attempt.findUniqueOrThrow({ where: { id: st.attemptId } })).studentId;
      await ctx.prisma.$executeRaw`UPDATE attempts SET "startedAt" = clock_timestamp() - interval '3 hours', "deadlineAt" = clock_timestamp() - interval '1 minute' WHERE id = ${st.attemptId}::uuid`;       // expired beyond the grace period
      const [ext] = await Promise.all([cce.post(ctl(x, 'extend'), { scope: 'CANDIDATES', studentIds: [sid], minutes: 10, reason: 'Verified disruption, racing the sweeper', confirm: true, idempotencyKey: key() }), life.reconcileExam(x)]);
      const row = await ctx.prisma.attempt.findUniqueOrThrow({ where: { id: st.attemptId } });
      if (row.status === 'IN_PROGRESS') { expect(ext.status).toBe(200); expect(row.extraTimeMin).toBe(10); expect(row.deadlineAt.getTime()).toBeGreaterThan(Date.now()); outcomes.extended++; }
      else { expect(row.status).toBe('AUTO_SUBMITTED'); expect(row.extraTimeMin).toBe(0); expect(ext.status).toBe(409); outcomes.sealed++; }
      expect((await ctx.prisma.attemptEvent.count({ where: { attemptId: st.attemptId, kind: 'AUTO_SUBMITTED' } }))).toBe(row.status === 'IN_PROGRESS' ? 0 : 1);
    }
    expect(outcomes.extended + outcomes.sealed).toBe(locals.length);
  });
});

describe('17/18 conflicting controllers', () => {
  it('two controllers issue conflicting commands at once: exactly one wins, the other is refused with a clear state, version/event/audit agree', async () => {
    const x = await makeExam({ suspendPolicy: 'FREEZE_CLOCK' }); const c1 = await as(ctx, 'cce'); const c2 = await as(ctx, 'super.admin');
    await c1.post(ctl(x, 'start'), {}); await startAs('student.a002', x);
    for (let round = 0; round < 3; round++) {
      const y = await makeExam({ suspendPolicy: 'FREEZE_CLOCK' }); await c1.post(ctl(y, 'start'), {}); await startAs('student.a002', y);
      const v0 = (await stateOf(y)).stateVersion;
      const [s, cl] = await Promise.all([c1.post(ctl(y, 'suspend'), { scope: 'EXAM', reason: 'Controller one: fire alarm', confirm: true }), c2.post(ctl(y, 'close'), { reason: 'Controller two: end now' })]);
      const ok = [s, cl].filter((r) => r.status === 200 && r.body.changed); const refused = [s, cl].filter((r) => r.status === 409);
      expect(ok.length).toBe(1); expect(refused.length).toBe(1);
      const ex = await stateOf(y); expect(ex.stateVersion).toBe(v0 + 1);
      expect(ex.status).toBe(s.body.changed ? 'SUSPENDED' : 'CLOSING');
      expect((await events(y)).filter((e) => e.aggregateVersion > v0).map((e) => e.type)).toEqual([s.body.changed ? 'EXAM_SUSPENDED' : 'EXAM_CLOSING']);
      expect((await audits(y)).filter((a) => a.action === 'exam.control.suspend' || a.action === 'exam.control.close').length).toBe(1);
    }
    const stale = await c2.post(ctl(x, 'close-admission'), { expectedVersion: 0 });
    expect(stale.status).toBe(409); expect(stale.body.code).toBe('STALE_STATE');
  });
});

describe('25–28 deadlines, close, scoring (MANUAL exam)', () => {
  it('26. an attempt past its deadline is auto-submitted EXACTLY once, even across repeated and concurrent reconciliation', async () => {
    const x = await makeExam(); const cce = await as(ctx, 'cce'); await cce.post(ctl(x, 'start'), {});
    const st = await startAs('student.a002', x); const q = await qids(x); await answer(st, q[0]!, 1, 'C');
    await ctx.prisma.$executeRaw`UPDATE attempts SET "startedAt" = clock_timestamp() - interval '3 hours', "deadlineAt" = clock_timestamp() - interval '1 minute' WHERE id = ${st.attemptId}::uuid`;
    const late = await answer(st, q[1]!, 1, 'B'); expect(late.status).toBe(409); expect(late.body.code).toBe('TIME_EXPIRED');       // the API enforces the deadline with NO worker running
    const life = ctx.app.get(LifecycleService);
    const runs = await Promise.all([life.reconcileExam(x), life.reconcileExam(x), life.reconcileExam(x)]);
    expect(runs.reduce((n, r) => n + r.autoSubmitted, 0)).toBe(1);
    const row = await ctx.prisma.attempt.findUniqueOrThrow({ where: { id: st.attemptId } });
    expect(row.status).toBe('AUTO_SUBMITTED'); expect(row.receiptCode).toMatch(/^RC-/);
    expect(await ctx.prisma.attemptEvent.count({ where: { attemptId: st.attemptId, kind: 'AUTO_SUBMITTED' } })).toBe(1);
    expect((await life.reconcileExam(x)).autoSubmitted).toBe(0);
    expect((await ctx.prisma.attemptAnswer.findUniqueOrThrow({ where: { attemptId_examQuestionId: { attemptId: st.attemptId!, examQuestionId: q[0]! } } })).selectedLabel).toBe('C');
  });

  it('27/28. CLOSE waits for in-progress attempts (CLOSING), then CLOSED; scoring starts only on command and only when valid; the closed exam stays finalized', async () => {
    const x = await makeExam(); const cce = await as(ctx, 'cce'); await cce.post(ctl(x, 'start'), {});
    const s1 = await startAs('student.a002', x); const s2 = await startAs('student.b002', x); const q = await qids(x);
    expect((await cce.post(ctl(x, 'initiate-scoring'), {})).body.code).toBe('BAD_STATE');                          // not closed yet
    await answer(s1, q[0]!, 1, 'A');
    const c = await cce.post(ctl(x, 'close'), {});
    expect(c.body).toMatchObject({ changed: true, inProgress: 2, state: { status: 'CLOSING' } });
    expect((await startAs('student.a004', x)).r.body.code).toBe('ADMISSION_CLOSED');                                // nobody new
    expect((await answer(s1, q[1]!, 1, 'B')).status).toBe(200);                                                      // active attempts continue
    expect((await cce.post(ctl(x, 'initiate-scoring'), {})).body.code).toBe('BAD_STATE');
    expect((await cce.post(ctl(x, 'close'), {})).body.changed).toBe(false);
    expect((await s1.s.post(`/attempts/${s1.attemptId}/submit`, { clientId: s1.clientId, submitKey: 'close-submit-one' })).status).toBe(200);
    await ctx.app.get(LifecycleService).reconcileExam(x); expect((await stateOf(x)).status).toBe('CLOSING');       // s2 still working
    const sub2 = await s2.s.post(`/attempts/${s2.attemptId}/submit`, { clientId: s2.clientId, submitKey: 'close-submit-two' }); expect(sub2.status, JSON.stringify(sub2.body)).toBe(200);
    const rec = await cce.post(ctl(x, 'reconcile'), {}); expect(rec.status).toBe(200);
    expect((await stateOf(x)).status).toBe('CLOSED');
    await ctx.app.get(LifecycleService).runOnce(); expect((await stateOf(x)).status).toBe('CLOSED');                // MANUAL exams do not score by themselves
    expect((await answer(s1, q[2]!, 1, 'D')).body.code).toBe('ATTEMPT_CLOSED'); expect((await startAs('student.a004', x)).r.status).toBe(409);
    const sc = await cce.post(ctl(x, 'initiate-scoring'), {}); expect(sc.body).toMatchObject({ changed: true });
    expect(['SCORING', 'RESULT_PENDING']).toContain((await stateOf(x)).status);
    await ctx.app.get(LifecycleService).reconcileExam(x);
    const done = await stateOf(x); expect(done.status).toBe('RESULT_PENDING');
    const results = await ctx.prisma.result.findMany({ where: { examId: x } }); expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results.some((r) => r.status === 'ABSENT')).toBe(true);                                                  // roster members who never sat
    expect((await cce.post(ctl(x, 'initiate-scoring'), {})).body.code).toBe('BAD_STATE');
    expect((await cce.post(ctl(x, 'suspend'), { scope: 'EXAM', reason: 'Too late for this to work', confirm: true })).status).toBe(409);
  });

  it('CLOSE(force) seals every attempt (reason required), is audited, and survives being finished by reconciliation', async () => {
    const x = await makeExam(); const cce = await as(ctx, 'cce'); await cce.post(ctl(x, 'start'), {});
    const s = [await startAs('student.a002', x), await startAs('student.b002', x), await startAs('student.a004', x)];
    expect((await cce.post(ctl(x, 'close'), { force: true })).status).toBe(400);                                    // reason required
    const r = await cce.post(ctl(x, 'close'), { force: true, reason: 'Examination terminated: paper leak confirmed' });
    expect(r.status).toBe(200);
    await ctx.app.get(LifecycleService).reconcileExam(x);
    expect((await stateOf(x)).status).toBe('CLOSED');
    for (const st of s) { const row = await ctx.prisma.attempt.findUniqueOrThrow({ where: { id: st.attemptId } }); expect(row.status).toBe('AUTO_SUBMITTED'); expect(row.receiptCode).toBeTruthy(); }
    expect(await ctx.prisma.attemptEvent.count({ where: { attemptId: { in: s.map((x1) => x1.attemptId!) }, kind: 'FORCE_SUBMITTED' } })).toBe(3);
    expect((await audits(x)).find((a) => a.action === 'exam.control.close')!.meta).toMatchObject({ force: true, reason: expect.stringContaining('paper leak') });
  });

  it('a suspended exam can only be closed with force (or resumed first)', async () => {
    const x = await makeExam({ suspendPolicy: 'FREEZE_CLOCK' }); const cce = await as(ctx, 'cce'); await cce.post(ctl(x, 'start'), {}); await startAs('student.a002', x);
    await cce.post(ctl(x, 'suspend'), { scope: 'EXAM', reason: 'Incident under investigation', confirm: true });
    expect((await cce.post(ctl(x, 'close'), {})).body.code).toBe('RESUME_OR_FORCE');
    expect((await cce.post(ctl(x, 'close'), { force: true, reason: 'Investigation concluded: terminate' })).status).toBe(200);
    await ctx.app.get(LifecycleService).reconcileExam(x); expect((await stateOf(x)).status).toBe('CLOSED');
  });
});

describe('21 lifecycle reconciler: ownership, multiple workers, backlog, retries', () => {
  it('a database lease gives one owner at a time; a crashed owner’s lease expires and another worker takes over', async () => {
    const a = ctx.app.get(LifecycleService);
    await ctx.prisma.$executeRaw`DELETE FROM lifecycle_leases`;
    const r1 = await a.runOnce(); expect(r1.skipped).toBeUndefined();
    const lease = await ctx.prisma.lifecycleLease.findUniqueOrThrow({ where: { name: 'lifecycle' } }); expect(lease.owner).toBe(a.instance);
    await ctx.prisma.$executeRaw`UPDATE lifecycle_leases SET owner = 'another-host:1:dead', "expiresAt" = clock_timestamp() + interval '20 seconds'`;
    const r2 = await a.runOnce(); expect(r2.skipped).toBe(true);                                                     // someone else owns it
    await ctx.prisma.$executeRaw`UPDATE lifecycle_leases SET "expiresAt" = clock_timestamp() - interval '1 second'`;  // owner crashed: lease expired
    const r3 = await a.runOnce(); expect(r3.skipped).toBeUndefined();
    expect((await ctx.prisma.lifecycleLease.findUniqueOrThrow({ where: { name: 'lifecycle' } })).owner).toBe(a.instance);
    const run = await ctx.prisma.lifecycleRun.findFirstOrThrow({ orderBy: { startedAt: 'desc' } }); expect(run.finishedAt).toBeTruthy(); expect(run.error).toBeNull();
    expect((await a.health()).status).toBe('OK');
  });

  it('a backlog (many expired attempts after an outage) is reconciled in one pass, each attempt sealed exactly once even with concurrent passes', async () => {
    const x = await makeExam(); const cce = await as(ctx, 'cce'); await cce.post(ctl(x, 'start'), {});
    const locals = ['student.a002', 'student.a003', 'student.a004', 'student.a005', 'student.a006', 'student.b002', 'student.b004', 'student.b005', 'student.b006'];
    const att = []; for (const l of locals) att.push((await startAs(l, x)).attemptId!);
    await ctx.prisma.$executeRaw`UPDATE attempts SET "startedAt" = clock_timestamp() - interval '3 hours', "deadlineAt" = clock_timestamp() - interval '10 minutes' WHERE id = ANY(${att}::uuid[])`;
    expect((await ctx.app.get(LifecycleService).health()).expiredBacklog).toBeGreaterThanOrEqual(locals.length);
    const life = ctx.app.get(LifecycleService);
    const runs = await Promise.all([life.reconcileExam(x), life.reconcileExam(x), life.reconcileExam(x), life.reconcileExam(x)]);
    expect(runs.reduce((n, r) => n + r.autoSubmitted, 0)).toBe(locals.length);
    for (const id of att) expect(await ctx.prisma.attemptEvent.count({ where: { attemptId: id, kind: 'AUTO_SUBMITTED' } })).toBe(1);
    expect((await ctx.prisma.attempt.findMany({ where: { id: { in: att } } })).every((a) => a.status === 'AUTO_SUBMITTED' && !!a.receiptCode)).toBe(true);
    expect(new Set((await ctx.prisma.attempt.findMany({ where: { id: { in: att } } })).map((a) => a.receiptCode)).size).toBe(locals.length);
    expect((await stateOf(x)).status).toBe('LIVE');                                                                  // the window is still open, so the exam stays LIVE even with nothing in progress
  });

  it('AUTOMATIC (legacy) exams still open at their window start and close at its end, with events and audit written by the reconciler', async () => {
    const x = await makeExam({ controlMode: 'AUTOMATIC', opensAt: ago(60_000), closesAt: ahead(3600_000) });
    const r = await ctx.app.get(JobsService).runTick(); expect(r.opened).toBeGreaterThanOrEqual(1);
    const ex = await stateOf(x); expect(ex.status).toBe('LIVE'); expect(ex.officialStartAt).toBeTruthy();
    expect((await events(x)).map((e) => e.type)).toContain('EXAM_STARTED');
    expect((await audits(x)).map((a) => a.action)).toContain('exam.lifecycle.start');
    await ctx.prisma.exam.update({ where: { id: x }, data: { opensAt: ago(3600_000), closesAt: ago(1000) } });
    await ctx.app.get(JobsService).runTick();
    expect(['RESULT_PENDING']).toContain((await stateOf(x)).status);
  });

  it('poison attempts stop being retried after a bounded number of failures and are reported by health()', async () => {
    const x = await makeExam(); const cce = await as(ctx, 'cce'); await cce.post(ctl(x, 'start'), {});
    const st = await startAs('student.a002', x);
    await ctx.prisma.$executeRaw`UPDATE attempts SET "startedAt" = clock_timestamp() - interval '3 hours', "deadlineAt" = clock_timestamp() - interval '10 minutes', "lifecycleRetries" = 5, "lifecycleError" = 'simulated' WHERE id = ${st.attemptId}::uuid`;
    const r = await ctx.app.get(LifecycleService).reconcileExam(x);
    expect(r.autoSubmitted).toBe(0); expect((await ctx.prisma.attempt.findUniqueOrThrow({ where: { id: st.attemptId } })).status).toBe('IN_PROGRESS');
    expect(r.poisoned).toBeGreaterThanOrEqual(1); expect((await ctx.app.get(LifecycleService).health()).poisonedAttempts).toBeGreaterThanOrEqual(1);
    expect((await answer(st, (await qids(x))[0]!, 1)).body.code).toBe('TIME_EXPIRED');                                // still cannot write: the API enforces the deadline itself
    await ctx.prisma.$executeRaw`UPDATE attempts SET "lifecycleRetries" = 0 WHERE id = ${st.attemptId}::uuid`;                // an operator clears the poison flag: the next pass recovers it
    expect((await ctx.app.get(LifecycleService).reconcileExam(x)).autoSubmitted).toBe(1);
  });
});

describe('19/22 events, outbox and audit', () => {
  it('every state change wrote exactly one event with a contiguous version and one audit record; the outbox row is append-only', async () => {
    const x = await makeExam({ suspendPolicy: 'FREEZE_CLOCK' }); const cce = await as(ctx, 'cce'); const v0 = (await stateOf(x)).stateVersion;
    const steps: [string, object, string][] = [['open-admission', {}, 'ADMISSION_OPENED'], ['start', {}, 'EXAM_STARTED'], ['suspend', { scope: 'EXAM', reason: 'Audit chain scenario one', confirm: true }, 'EXAM_SUSPENDED'],
      ['resume', { confirm: true }, 'EXAM_RESUMED'], ['extend', { scope: 'EXAM', minutes: 5, reason: 'Audit chain scenario two', confirm: true, idempotencyKey: key() }, 'DEADLINE_EXTENDED'], ['close-admission', {}, 'ADMISSION_CLOSED'], ['close', {}, 'EXAM_CLOSING']];   // a candidate is still in progress, so closing = CLOSING
    for (const [cmd, body] of steps) { const r = await cce.post(ctl(x, cmd), body); expect(r.status, cmd).toBe(200); expect(r.body.changed, cmd).toBe(true); if (cmd === 'open-admission') await startAs('student.a002', x); }
    await cce.post(ctl(x, 'open-admission'), {}); await cce.post(ctl(x, 'start'), {});                              // no-ops on a closed exam must not write anything
    const ev = (await events(x)).filter((e) => e.type !== 'POLICY_CHANGED');
    expect(ev.map((e) => e.type)).toEqual(steps.map((s) => s[2]));
    expect(ev.map((e) => e.aggregateVersion)).toEqual(steps.map((_, i) => v0 + 1 + i));                              // 1:1 with the version counter, no gaps, no repeats
    const au = (await audits(x)).filter((a) => a.action.startsWith('exam.control.'));
    expect(au.map((a) => a.action)).toEqual(['exam.control.open_admission', 'exam.control.start', 'exam.control.suspend', 'exam.control.resume', 'exam.control.extend', 'exam.control.close_admission', 'exam.control.close']);
    expect((await ctx.prisma.exam.findUniqueOrThrow({ where: { id: x } })).stateVersion).toBe(v0 + steps.length);
    expect(au.every((a) => (a.meta as { version: number }).version >= v0 + 1)).toBe(true);
    const chain = await (await as(ctx, 'cce')).get('/audit/verify'); expect(chain.body.brokenAt).toBeNull();
    await expect(ctx.prisma.$executeRaw`DELETE FROM exam_events WHERE "examId" = ${x}::uuid`).rejects.toThrow(/append-only/);
    await expect(ctx.prisma.$executeRaw`UPDATE exam_events SET type = 'FORGED' WHERE "examId" = ${x}::uuid`).rejects.toThrow(/delivery fields/);
  });

  it('a refused or failed command leaves nothing behind (rollback is atomic)', async () => {
    const x = await makeExam(); const cce = await as(ctx, 'cce'); const before = { e: (await events(x)).length, a: (await audits(x)).length, v: (await stateOf(x)).stateVersion };
    expect((await cce.post(ctl(x, 'resume'), { confirm: true })).body.changed).toBe(false);
    expect((await cce.post(ctl(x, 'close'), {})).status).toBe(409);                                                   // SCHEDULED cannot be closed
    expect((await cce.post(ctl(x, 'initiate-scoring'), {})).status).toBe(409);
    expect({ e: (await events(x)).length, a: (await audits(x)).length, v: (await stateOf(x)).stateVersion }).toEqual(before);
  });

  it('outbox publishing delivers PENDING rows to Redis (retry bookkeeping, no duplicates marked twice)', async () => {
    const x = await makeExam(); const cce = await as(ctx, 'cce'); await cce.post(ctl(x, 'open-admission'), {});
    const ev = ctx.app.get(ExamEventsService); const r = await ev.publishPending(500);
    expect(r.failed).toBe(0);
    let rows = await events(x); for (let i = 0; i < 30 && !rows.every((e) => e.deliveryStatus === 'DELIVERED'); i++) { await new Promise((r2) => setTimeout(r2, 100)); rows = await events(x); }   // the post-commit nudge may hold the rows for a moment
    expect(rows.length).toBeGreaterThan(0); expect(rows.every((e) => e.deliveryStatus === 'DELIVERED' && e.deliveredAt)).toBe(true);
    expect((await ev.publishPending(500)).published).toBe(0);                                                          // nothing left; second call is a no-op
  });
});

describe('29 monitoring: bounded, authoritative and campus-scoped', () => {
  let id: string;
  beforeAll(async () => {
    id = await makeExam(); const cce = await as(ctx, 'cce'); await cce.post(ctl(id, 'start'), {});
    const s = await startAs('student.a002', id); await startAs('student.b002', id); await startAs('student.a003', id); const q = await qids(id); await answer(s, q[0]!, 1);
    await (await as(ctx, 'student.a003')).post(`/attempts/${(await ctx.prisma.attempt.findFirstOrThrow({ where: { examId: id, student: { regNo: 'DMC-A-2024-0003' } } })).id}/submit`, { clientId: 'x', submitKey: 'monitor-submit-key' }).catch(() => undefined);
    await ctx.prisma.examInvigilator.createMany({ data: [{ examId: id, userId: (await ctx.prisma.user.findFirstOrThrow({ where: { email: `invigilator.a@${DOMAIN}` } })).id, institutionId: A }, { examId: id, userId: (await ctx.prisma.user.findFirstOrThrow({ where: { email: `invigilator.b@${DOMAIN}` } })).id, institutionId: B }], skipDuplicates: true });
  });

  it('every number is the database’s: the snapshot equals independent counts', async () => {
    const snap = (await (await as(ctx, 'cce')).get(`/invigilation/exams/${id}/snapshot`)).body;
    const db = await ctx.prisma.$queryRaw<{ allocated: number; eligible: number; entered: number; inprog: number; submitted: number }[]>`
      SELECT (SELECT count(*) FROM exam_candidates WHERE "examId" = ${id}::uuid)::int AS allocated, (SELECT count(*) FROM exam_candidates WHERE "examId" = ${id}::uuid AND status = 'ADMITTED')::int AS eligible,
             (SELECT count(*) FROM attempts WHERE "examId" = ${id}::uuid)::int AS entered, (SELECT count(*) FROM attempts WHERE "examId" = ${id}::uuid AND status = 'IN_PROGRESS')::int AS inprog,
             (SELECT count(*) FROM attempts WHERE "examId" = ${id}::uuid AND status IN ('SUBMITTED','AUTO_SUBMITTED'))::int AS submitted`;
    expect(snap.totals).toMatchObject({ allocated: db[0]!.allocated, eligible: db[0]!.eligible, admitted: db[0]!.entered, inProgress: db[0]!.inprog });
    expect(snap.totals.submitted + snap.totals.autoSubmitted).toBe(db[0]!.submitted);
    expect(snap.totals.remaining).toBe(db[0]!.eligible - db[0]!.submitted);
    expect(snap.campuses.map((c: { code: string }) => c.code)).toEqual(['DMC-A', 'DMC-B']);
    expect(snap.freshness).toHaveProperty('computedAt'); expect(typeof snap.cursor).toBe('number'); expect(snap.stateVersion).toBeGreaterThan(0);
  });

  it('30. campus staff see only their campus in snapshot, candidates and the compat monitor; manipulating institutionId never widens', async () => {
    const invA = await as(ctx, 'invigilator.a'); const adminB = await as(ctx, 'admin.b');
    const snap = await invA.get(`/invigilation/exams/${id}/snapshot`); expect(snap.status).toBe(200);
    expect(snap.body.campuses.map((c: { code: string }) => c.code)).toEqual(['DMC-A']); expect(snap.body.scope.universityWide).toBe(false);
    expect(JSON.stringify(snap.body)).not.toMatch(/DMC-B|Demo Medical College B/);
    const cands = await invA.get(`/invigilation/exams/${id}/candidates?institutionId=${B}`);
    expect(cands.status).toBe(200); expect(cands.body.total).toBe(0); expect(cands.body.rows).toEqual([]);                  // out-of-scope id yields nothing, not B’s rows
    const own = await invA.get(`/invigilation/exams/${id}/candidates`); expect(own.body.rows.length).toBeGreaterThan(0);
    expect(own.body.rows.every((r: { institution: string }) => r.institution === 'DMC-A')).toBe(true);
    expect(JSON.stringify(own.body)).not.toContain('DMC-B');
    const b = await adminB.get(`/invigilation/exams/${id}/snapshot`); expect(b.body.campuses.map((c: { code: string }) => c.code)).toEqual(['DMC-B']);
    expect((await invA.get(`/invigilation/exams/${id}/candidates?pageSize=1000`)).status).toBe(400);                         // bounded page size
    const compat = await invA.get(`/invigilation/exams/${id}/monitor`); expect(compat.status).toBe(200); expect(JSON.stringify(compat.body)).not.toContain('DMC-B');
    const unassigned = await as(ctx, 'invigilator.b'); await ctx.prisma.examInvigilator.deleteMany({ where: { examId: id, institutionId: B } });
    expect((await unassigned.get(`/invigilation/exams/${id}/snapshot`)).status).toBe(404);                                      // not assigned to this exam any more
    expect((await (await as(ctx, 'student.a002')).get(`/invigilation/exams/${id}/snapshot`)).status).toBe(403);
    expect((await (await as(ctx, 'lecturer.a')).get(`/invigilation/exams/${id}/candidates`)).status).toBe(403);
  });

  it('candidate detail is paginated and filterable, with last confirmed activity and connection state from real data', async () => {
    const cce = await as(ctx, 'cce');
    const p1 = await cce.get(`/invigilation/exams/${id}/candidates?pageSize=2&page=1`); const p2 = await cce.get(`/invigilation/exams/${id}/candidates?pageSize=2&page=2`);
    expect(p1.body.rows.length).toBe(2); expect(p1.body.total).toBeGreaterThan(2); expect(p2.body.rows[0].regNo).not.toBe(p1.body.rows[0].regNo);
    const ip = await cce.get(`/invigilation/exams/${id}/candidates?status=IN_PROGRESS&pageSize=100`); expect(ip.body.rows.every((r: { status: string }) => r.status === 'IN_PROGRESS')).toBe(true);
    const ns = await cce.get(`/invigilation/exams/${id}/candidates?status=NOT_STARTED&pageSize=100`); expect(ns.body.rows.every((r: { attemptId: string | null }) => r.attemptId === null)).toBe(true);
    const row = (await cce.get(`/invigilation/exams/${id}/candidates?search=DMC-A-2024-0002`)).body.rows[0];
    expect(row).toMatchObject({ regNo: 'DMC-A-2024-0002', status: 'IN_PROGRESS', answered: 1 }); expect(row.lastConfirmedSaveAt).toBeTruthy();
    expect(['ONLINE', 'DISCONNECTED', 'UNKNOWN']).toContain(row.connection);
    expect((await cce.get(`/invigilation/exams/${id}/candidates?search=%25%27%3B--`)).status).toBe(200);                         // hostile search text is data
  });

  it('the control view bundles header, commands, history and health from real state', async () => {
    const v = (await (await as(ctx, 'cce')).get(`/exams/${id}/control`)).body;
    expect(v.exam).toMatchObject({ id, status: 'LIVE', timingPolicy: 'INDIVIDUAL', controlMode: 'MANUAL' }); expect(v.exam.paper).toMatchObject({ status: 'APPROVED', questions: 4 }); expect(v.exam.paper.fingerprint).toBeTruthy();
    expect(v.commands.find((c: { command: string }) => c.command === 'SUSPEND')).toMatchObject({ allowed: false });          // policy not approved on this exam
    expect(v.commands.find((c: { command: string }) => c.command === 'CLOSE')).toMatchObject({ allowed: true });
    expect(v.health).toHaveProperty('lifecycle.status'); expect(v.health).toHaveProperty('outbox.pending'); expect(v.health.redis).toHaveProperty('available');
    expect(v.health.saves.scope).toMatch(/this API instance/);
  });
});
