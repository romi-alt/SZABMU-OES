import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, boot, cid, save, startExam, type Ctx } from './helpers';
import { ExamsService } from '../src/modules/exams/exams.service';

let ctx: Ctx;
let cceId: string;
beforeAll(async () => {
  ctx = await boot();
  cceId = (await ctx.prisma.user.findFirstOrThrow({ where: { email: { startsWith: 'cce@' } } })).id;
});
afterAll(async () => { await ctx.app.close(); });

const reg = (campus: 'A' | 'B', n: number) => `DMC-${campus}-2024-${String(n).padStart(4, '0')}`;
const examId = () => ctx.seeded.examId;
const refresh = () => ctx.app.get(ExamsService).refreshRoster(examId(), cceId);
const setEligibility = (regNo: string, eligibility: 'ELIGIBLE' | 'INELIGIBLE') =>
  ctx.prisma.enrollment.updateMany({ where: { courseId: ctx.seeded.courses.path.id, student: { regNo } }, data: { eligibility } });
const studentId = async (regNo: string) => (await ctx.prisma.student.findFirstOrThrow({ where: { regNo } })).id;
const cand = async (regNo: string) => ctx.prisma.examCandidate.findFirst({ where: { examId: examId(), student: { regNo } } });

describe('B. admission at start (new attempt)', () => {
  it('admits an eligible rostered student and freezes the decision on the attempt', async () => {
    const s = await as(ctx, 'student.a002');
    const { attemptId } = await startExam(ctx, s);
    const a = await ctx.prisma.attempt.findUniqueOrThrow({ where: { id: attemptId } });
    expect(a.admission).toMatchObject({ decision: 'ADMITTED', source: 'ENROLMENT', rosterVersion: 1 });
    expect((a.admission as { enrollmentId: string }).enrollmentId).toBeTruthy();
  });

  it('roster builds are versioned, hash-stamped, approved by the scheduler and immutable', async () => {
    const cce = await as(ctx, 'cce');
    const v = await cce.get(`/exams/${examId()}/roster-versions`);
    expect(v.status).toBe(200);
    expect(v.body[0]).toMatchObject({ version: 1, approvedById: expect.any(String) });
    expect(v.body[0].digest).toMatch(/^[0-9a-f]{64}$/);
    await expect(ctx.prisma.$executeRaw`UPDATE exam_roster_versions SET digest = 'x'`).rejects.toThrow();
    await expect(ctx.prisma.$executeRaw`DELETE FROM exam_roster_versions`).rejects.toThrow();
  });

  it('a roster refresh revokes (never deletes) a student who lost eligibility; start is then denied', async () => {
    const before = await ctx.prisma.examCandidate.count({ where: { examId: examId() } });
    await setEligibility(reg('A', 6), 'INELIGIBLE');
    const r = await refresh();
    expect(r.candidatesRevoked).toBe(1);
    expect(r.rosterVersion).toBe(2);
    expect(await ctx.prisma.examCandidate.count({ where: { examId: examId() } })).toBe(before); // history kept
    expect(await cand(reg('A', 6))).toMatchObject({ status: 'REVOKED', decisionSource: 'ENROLMENT' });
    const s = await as(ctx, 'student.a006');
    const res = await s.post('/attempts/start', { examId: examId(), clientId: cid() });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ADMISSION_REVOKED');
    const list = await s.get('/me/exams');
    expect(list.body.items[0].canStart).toBe(false);
    expect(await ctx.prisma.attempt.count({ where: { student: { regNo: reg('A', 6) } } })).toBe(0);
  });

  it('re-validates local enrolment at start even when the roster was not refreshed', async () => {
    await setEligibility(reg('A', 5), 'INELIGIBLE'); // roster still says ADMITTED
    expect((await cand(reg('A', 5)))!.status).toBe('ADMITTED');
    const res = await (await as(ctx, 'student.a005')).post('/attempts/start', { examId: examId(), clientId: cid() });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('NOT_ELIGIBLE');
  });

  it('denies a restricted (non-ACTIVE) student account', async () => {
    await ctx.prisma.student.update({ where: { id: await studentId(reg('B', 2)) }, data: { status: 'SUSPENDED' } });
    const res = await (await as(ctx, 'student.b002')).post('/attempts/start', { examId: examId(), clientId: cid() });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ACCOUNT_RESTRICTED');
  });

  it('denies a student who is not on the roster at all', async () => {
    const res = await (await as(ctx, 'student.a001')).post('/attempts/start', { examId: examId(), clientId: cid() });
    expect(res.status).toBe(403);
  });
});

describe('C. active examination: decision is frozen', () => {
  it('a started attempt keeps saving, resuming and submitting after eligibility is lost and the roster refreshed', async () => {
    const s = await as(ctx, 'student.a003');
    const first = await startExam(ctx, s);
    const q = first.questions[0]!;
    expect((await save(s, first.attemptId, q.id, first.clientId, 1, 'A')).status).toBe(200);

    await setEligibility(reg('A', 3), 'INELIGIBLE');
    const r = await refresh();
    expect(r.candidatesRevoked).toBe(2); // a005 (ineligible) and b002 (suspended) had not started; a003 has → untouched
    expect(await cand(reg('A', 3))).toMatchObject({ status: 'ADMITTED' });

    expect((await save(s, first.attemptId, q.id, first.clientId, 2, 'B')).status).toBe(200);
    const again = await startExam(ctx, s, cid()); // resume from another tab/device: no re-evaluation
    expect(again.attemptId).toBe(first.attemptId);
    const a = await ctx.prisma.attempt.findUniqueOrThrow({ where: { id: first.attemptId } });
    expect(a.admission).toMatchObject({ decision: 'ADMITTED', source: 'ENROLMENT' }); // snapshot not rewritten
    const submit = await s.post(`/attempts/${first.attemptId}/submit`, { clientId: again.clientId, submitKey: 'k-' + cid() });
    expect(submit.status).toBe(200);
  });

  it('saves do not query academic records (no enrolment/candidate reads on the save path)', async () => {
    const src = (await import('node:fs')).readFileSync(require.resolve('../src/modules/delivery/delivery.service.ts'), 'utf8');
    const saveFn = src.slice(src.indexOf('async saveAnswer'), src.indexOf('async heartbeat'));
    expect(saveFn).not.toMatch(/enrollment|examCandidate|eligib/i);
  });
});

describe('D. manual overrides', () => {
  const body = (decision: 'GRANT' | 'REVOKE', extra: Record<string, unknown> = {}) => ({ decision, reason: 'Documented exceptional decision (synthetic test)', ...extra });

  it('only the CCE / Super Admin may override; campus staff, lecturers, examiners and students are refused', async () => {
    const sid = await studentId(reg('A', 6));
    for (const who of ['admin.a', 'lecturer.a', 'examiner', 'student.a006', 'invigilator.a']) {
      const c = await as(ctx, who);
      expect((await c.post(`/exams/${examId()}/candidates/${sid}/override`, body('GRANT'))).status, who).toBe(403);
    }
    expect(await ctx.prisma.eligibilityOverride.count()).toBe(0);
    expect((await ctx.app.getHttpAdapter().getInstance().inject({ method: 'POST', url: `/api/exams/${examId()}/candidates/${sid}/override`, payload: body('GRANT') })).statusCode).toBe(401);
  });

  it('requires a substantive reason and valid input', async () => {
    const cce = await as(ctx, 'cce'); const sid = await studentId(reg('A', 6));
    expect((await cce.post(`/exams/${examId()}/candidates/${sid}/override`, { decision: 'GRANT', reason: 'short' })).status).toBe(400);
    expect((await cce.post(`/exams/${examId()}/candidates/${sid}/override`, { decision: 'MAYBE', reason: 'long enough reason' })).status).toBe(400);
  });

  it('GRANT re-admits a revoked student: full record kept, override survives later roster refreshes, student can start', async () => {
    const cce = await as(ctx, 'cce'); const sid = await studentId(reg('A', 6));
    const r = await cce.post(`/exams/${examId()}/candidates/${sid}/override`, body('GRANT'));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ oldDecision: 'REVOKED', newDecision: 'ADMITTED', attemptId: null });
    const rec = await ctx.prisma.eligibilityOverride.findFirstOrThrow({ where: { studentId: sid } });
    expect(rec).toMatchObject({ approvedById: cceId, oldDecision: 'REVOKED', newDecision: 'ADMITTED', reason: 'Documented exceptional decision (synthetic test)' });
    expect(rec.createdAt).toBeInstanceOf(Date);
    expect(await cand(reg('A', 6))).toMatchObject({ status: 'ADMITTED', decisionSource: 'OVERRIDE' });

    await refresh(); // enrolment still INELIGIBLE, but the manual decision must not be auto-reverted
    expect(await cand(reg('A', 6))).toMatchObject({ status: 'ADMITTED', decisionSource: 'OVERRIDE' });

    const { attemptId } = await startExam(ctx, await as(ctx, 'student.a006'));
    expect((await ctx.prisma.attempt.findUniqueOrThrow({ where: { id: attemptId } })).admission).toMatchObject({ source: 'OVERRIDE' });
    // no-op repeat is rejected
    expect((await cce.post(`/exams/${examId()}/candidates/${sid}/override`, body('GRANT'))).status).toBe(409);
  });

  it('GRANT can add a student who was never on the roster', async () => {
    const cce = await as(ctx, 'cce'); const sid = await studentId(reg('A', 1));
    const r = await cce.post(`/exams/${examId()}/candidates/${sid}/override`, body('GRANT'));
    expect(r.body).toMatchObject({ oldDecision: 'NOT_ON_ROSTER', newDecision: 'ADMITTED' });
    expect((await (await as(ctx, 'student.a001')).post('/attempts/start', { examId: examId(), clientId: cid() })).status).toBe(200);
  });

  it('REVOKE on an in-progress attempt needs explicit forceSubmit; it then seals the attempt and records the attempt id', async () => {
    const cce = await as(ctx, 'cce'); const s = await as(ctx, 'student.a004'); const sid = await studentId(reg('A', 4));
    const t = await startExam(ctx, s);
    expect((await save(s, t.attemptId, t.questions[0]!.id, t.clientId, 1, 'C')).status).toBe(200);

    const refused = await cce.post(`/exams/${examId()}/candidates/${sid}/override`, body('REVOKE'));
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('ATTEMPT_IN_PROGRESS');
    expect((await ctx.prisma.attempt.findUniqueOrThrow({ where: { id: t.attemptId } })).status).toBe('IN_PROGRESS');
    expect(await ctx.prisma.eligibilityOverride.count({ where: { studentId: sid } })).toBe(0); // nothing half-applied

    const ok = await cce.post(`/exams/${examId()}/candidates/${sid}/override`, body('REVOKE', { forceSubmit: true }));
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ oldDecision: 'ADMITTED', newDecision: 'REVOKED', attemptId: t.attemptId });
    const a = await ctx.prisma.attempt.findUniqueOrThrow({ where: { id: t.attemptId } });
    expect(a.status).not.toBe('IN_PROGRESS');
    expect(a.admission).toMatchObject({ decision: 'ADMITTED' }); // frozen snapshot is history, not rewritten
    expect((await ctx.prisma.eligibilityOverride.findFirstOrThrow({ where: { studentId: sid } })).attemptId).toBe(t.attemptId);
    // the saved answer survived the seal
    expect(await ctx.prisma.attemptAnswer.count({ where: { attemptId: t.attemptId } })).toBe(1);

    // re-entry is impossible: no further saves, no new attempt, no grant after an attempt exists
    expect((await save(s, t.attemptId, t.questions[1]!.id, t.clientId, 1, 'A')).status).not.toBe(200);
    expect((await s.post('/attempts/start', { examId: examId(), clientId: cid() })).status).toBeGreaterThanOrEqual(400);
    expect((await cce.post(`/exams/${examId()}/candidates/${sid}/override`, body('GRANT'))).body.code).toBe('ATTEMPT_EXISTS');
    expect((await cce.post(`/exams/${examId()}/candidates/${sid}/override`, body('REVOKE', { forceSubmit: true }))).body.code).toBe('ATTEMPT_FINISHED');
  });

  it('is scoped: students of a non-participating institution are refused; unknown students 404', async () => {
    const cce = await as(ctx, 'cce');
    const b = ctx.seeded.institutions.b.id; const sid = await studentId(reg('B', 3));
    const link = await ctx.prisma.examInstitution.findFirstOrThrow({ where: { examId: examId(), institutionId: b } });
    await ctx.prisma.examInstitution.deleteMany({ where: { examId: examId(), institutionId: b } }); // campus B no longer participates
    try { expect((await cce.post(`/exams/${examId()}/candidates/${sid}/override`, body('GRANT'))).status).toBe(400); }
    finally { await ctx.prisma.examInstitution.create({ data: { examId: link.examId, institutionId: link.institutionId } }); }
    expect((await cce.post(`/exams/${examId()}/candidates/00000000-0000-4000-8000-000000000000/override`, body('GRANT'))).status).toBe(404);
  });

  it('every override is audited and the override table is append-only with a real old≠new rule', async () => {
    const audit = await ctx.prisma.auditLog.findMany({ where: { action: 'eligibility.override' } });
    expect(audit.length).toBeGreaterThanOrEqual(3);
    await expect(ctx.prisma.$executeRaw`UPDATE eligibility_overrides SET reason = 'tampered tampered'`).rejects.toThrow();
    await expect(ctx.prisma.$executeRaw`DELETE FROM eligibility_overrides`).rejects.toThrow();
    const sid = await studentId(reg('B', 3));
    await expect(ctx.prisma.eligibilityOverride.create({ data: { examId: examId(), studentId: sid, oldDecision: 'ADMITTED', newDecision: 'ADMITTED', reason: 'long enough reason', approvedById: cceId } })).rejects.toThrow();
    const list = await (await as(ctx, 'cce')).get(`/exams/${examId()}/eligibility-overrides`);
    expect(list.status).toBe(200);
    expect(list.body.length).toBeGreaterThanOrEqual(3);
    expect((await (await as(ctx, 'admin.a')).get(`/exams/${examId()}/eligibility-overrides`)).status).toBe(403);
  });
});
