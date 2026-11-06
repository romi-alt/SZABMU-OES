import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ResultsService } from '../src/modules/results/results.service';
import { as, boot, cid, save, startExam, type Ctx } from './helpers';

/**
 * High-stakes failure scenarios from the 2026-11 audit (Phase 10) that had no direct test before.
 * The numbers refer to docs/audits/DATA_INTEGRITY_FINDINGS.md §Failure scenarios.
 */
let ctx: Ctx;
beforeAll(async () => { ctx = await boot({ studentsPerCampus: 8 }); });
afterAll(async () => { await ctx.app.close(); });

describe('Phase 10 failure scenarios', () => {
  it('#10 a student cannot read, save into, heartbeat, submit or get the receipt of another student’s attempt (404, nothing changes)', async () => {
    const owner = await as(ctx, 'student.a002'); const other = await as(ctx, 'student.a003');
    const { attemptId, clientId, questions } = await startExam(ctx, owner);
    expect((await save(owner, attemptId, questions[0]!.id, clientId, 1, 'A')).status).toBe(200);
    const theirs = await startExam(ctx, other);
    expect((await save(other, attemptId, questions[0]!.id, clientId, 2, 'B')).status).toBe(404);
    expect((await save(other, attemptId, questions[0]!.id, theirs.clientId, 2, 'B')).status).toBe(404);
    expect((await other.post(`/attempts/${attemptId}/heartbeat`, { clientId })).status).toBe(404);
    expect((await other.get(`/attempts/${attemptId}/sheet`)).status).toBe(404);
    expect((await other.post(`/attempts/${attemptId}/events`, { clientId, kind: 'TAB_HIDDEN' })).status).toBe(404);
    expect((await other.post(`/attempts/${attemptId}/submit`, { clientId, submitKey: 'k-' + cid() })).status).toBe(404);
    expect((await other.get(`/attempts/${attemptId}/receipt`)).status).toBe(404);
    const sheet = (await owner.get(`/attempts/${attemptId}/sheet`)).body;
    expect(sheet.status).toBe('IN_PROGRESS');
    expect(sheet.answers).toEqual([expect.objectContaining({ examQuestionId: questions[0]!.id, selectedLabel: 'A', revision: 1 })]);
  });

  it('#13 the session ends mid-exam: saves are refused (401), nothing is lost, and after signing in again the attempt resumes with every confirmed answer', async () => {
    const s = await as(ctx, 'student.a004'); const { attemptId, clientId, questions } = await startExam(ctx, s);
    expect((await save(s, attemptId, questions[0]!.id, clientId, 1, 'C')).status).toBe(200);
    expect((await save(s, attemptId, questions[1]!.id, clientId, 1, 'D')).status).toBe(200);
    expect((await s.post('/auth/logout')).status).toBe(200);
    expect((await save(s, attemptId, questions[2]!.id, clientId, 1, 'A')).status).toBe(401);
    const again = await as(ctx, 'student.a004');
    const resumed = await again.post('/attempts/start', { examId: ctx.seeded.examId, clientId: cid() });
    expect(resumed.status).toBe(200); expect(resumed.body.attempt.id).toBe(attemptId);
    const byQ = new Map((resumed.body.answers as { examQuestionId: string; selectedLabel: string }[]).map((a) => [a.examQuestionId, a.selectedLabel]));
    expect(byQ.get(questions[0]!.id)).toBe('C'); expect(byQ.get(questions[1]!.id)).toBe('D'); expect(byQ.has(questions[2]!.id)).toBe(false);
  });

  it('#7 a submit after the deadline (+grace) is sealed as AUTO_SUBMITTED with only the answers saved in time; later saves are refused', async () => {
    const s = await as(ctx, 'student.a005'); const { attemptId, clientId, questions } = await startExam(ctx, s);
    expect((await save(s, attemptId, questions[0]!.id, clientId, 1, 'B')).status).toBe(200);
    await ctx.prisma.attempt.update({ where: { id: attemptId }, data: { startedAt: new Date(Date.now() - 70 * 60_000), deadlineAt: new Date(Date.now() - 10 * 60_000) } });   // the clock ran out 10 minutes ago (CHECK: deadline after start)
    const late = await save(s, attemptId, questions[1]!.id, clientId, 1, 'C');
    expect(late.status).toBe(409); expect(late.body.code).toMatch(/TIME_EXPIRED|ATTEMPT_CLOSED/);
    const sub = await s.post(`/attempts/${attemptId}/submit`, { clientId, submitKey: 'k-' + cid() });
    expect(sub.status).toBe(200); expect(sub.body.status).toBe('AUTO_SUBMITTED'); expect(sub.body.answered).toBe(1);
    const sealed = await ctx.prisma.attempt.findUniqueOrThrow({ where: { id: attemptId }, include: { answers: true } });
    expect(sealed.status).toBe('AUTO_SUBMITTED'); expect(sealed.answers.map((a) => a.selectedLabel)).toEqual(['B']);
  });

  it('#16/#17 editing a question bank item after the paper was approved changes neither the delivered paper nor any computed result', async () => {
    const s = await as(ctx, 'student.a006'); const { attemptId, clientId, questions } = await startExam(ctx, s);
    const eq = await ctx.prisma.examQuestion.findUniqueOrThrow({ where: { id: questions[0]!.id } });
    const before = eq.snapshot as { stem: string }; const key = eq.correctLabel!;
    expect((await save(s, attemptId, eq.id, clientId, 1, key)).status).toBe(200);
    expect((await s.post(`/attempts/${attemptId}/submit`, { clientId, submitKey: 'k-' + cid() })).status).toBe(200);
    const results = ctx.app.get(ResultsService);
    const g1 = await results.gradeAttempt(attemptId);

    // the examiner rewrites the source question: new stem and a DIFFERENT correct option
    const examiner = await as(ctx, 'examiner');
    const src = (await examiner.get(`/questions/${eq.questionId}`)).body;
    const other = (src.options as { label: string }[]).find((o) => o.label !== key)!.label;
    const upd = await examiner.put(`/questions/${eq.questionId}`, { courseId: src.courseId, type: src.type, vignette: src.vignette ?? undefined, stem: 'Edited after approval: ' + src.stem, difficulty: src.difficulty,
      options: (src.options as { label: string; text: string }[]).map((o) => ({ label: o.label, text: o.text, isCorrect: o.label === other })) });
    expect(upd.status).toBe(200);

    const frozen = await ctx.prisma.examQuestion.findUniqueOrThrow({ where: { id: eq.id } });
    expect((frozen.snapshot as { stem: string }).stem).toBe(before.stem); expect(frozen.correctLabel).toBe(key);   // the paper is unchanged
    const late = await startExam(ctx, await as(ctx, 'student.a007'));                                                   // a candidate starting now gets the approved wording
    expect(late.res.body.questions.find((q: { id: string }) => q.id === eq.id).stem).toBe(before.stem);
    const g2 = await results.gradeAttempt(attemptId);
    expect(g2).toEqual(g1);                                                                                              // regrading gives the same result
  });
});
