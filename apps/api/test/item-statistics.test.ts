import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { itemStatistics } from '@oes/shared';
import { as, boot, cid, save, startExam, type Ctx } from './helpers';

/** T-PSY: item statistics on the analysis endpoint are computed from real sittings, on the effective key, within the caller's campus scope. */
let ctx: Ctx;
beforeAll(async () => { ctx = await boot({ studentsPerCampus: 6 }); });
afterAll(async () => { await ctx.app.close(); });

describe('item analysis statistics', () => {
  it('match an independent computation from the stored answers, report the sample size, and stay campus-scoped', async () => {
    const sitters = ['student.a002', 'student.a003', 'student.a004', 'student.b002', 'student.b003'];
    for (const [k, local] of sitters.entries()) {
      const s = await as(ctx, local); const { attemptId, clientId, questions } = await startExam(ctx, s);
      // candidate k answers the first (5 - k) questions with the key and the rest with a wrong option → a spread of scores
      for (const [i, q] of questions.entries()) {
        const eq = await ctx.prisma.examQuestion.findUniqueOrThrow({ where: { id: q.id } });
        const wrong = q.options.map((o) => o.label).find((l) => l !== eq.correctLabel)!;
        expect((await save(s, attemptId, q.id, clientId, 1, i < 12 - k * 2 ? eq.correctLabel : wrong)).status).toBe(200);
      }
      expect((await s.post(`/attempts/${attemptId}/submit`, { clientId, submitKey: 'k-' + cid() })).status).toBe(200);
    }
    const examiner = await as(ctx, 'examiner');
    const a = (await examiner.get(`/grading/exams/${ctx.seeded.examId}/analysis`)).body;
    expect(a.statistics).toMatchObject({ candidates: 5, items: 12, reliable: false, minCandidates: 30 });

    // independent recomputation straight from the database
    const eqs = await ctx.prisma.examQuestion.findMany({ where: { examId: ctx.seeded.examId }, orderBy: { position: 'asc' } });
    const atts = await ctx.prisma.attempt.findMany({ where: { examId: ctx.seeded.examId, status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] } }, include: { answers: true } });
    const ref = itemStatistics(atts.map((t) => eqs.map((q) => (t.answers.find((x) => x.examQuestionId === q.id)?.selectedLabel === q.correctLabel ? 1 : 0) as 0 | 1)));
    expect(a.statistics.kr20).toBe(ref.kr20); expect(a.statistics.mean).toBe(ref.mean);
    for (const [i, q] of eqs.entries()) {
      const row = a.questions.find((x: { examQuestionId: string }) => x.examQuestionId === q.id);
      expect(row.stats).toMatchObject({ p: ref.items_[i]!.p, d: ref.items_[i]!.d, rpb: ref.items_[i]!.rpb });
      expect(row.stats.flags).toEqual([]);                       // below 30 candidates nothing is flagged
    }

    // a campus-B lecturer sees statistics for campus B's two candidates only
    const lecB = await as(ctx, 'lecturer.b');
    const b = await lecB.get(`/grading/exams/${ctx.seeded.examId}/analysis`);
    expect(b.status).toBe(200); expect(b.body.statistics.candidates).toBe(2); expect(b.body.candidates).toBe(2);

    // students and teachers cannot read it
    expect((await (await as(ctx, 'student.a005')).get(`/grading/exams/${ctx.seeded.examId}/analysis`)).status).toBe(403);
  });
});
