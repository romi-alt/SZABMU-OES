import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, boot, type Ctx } from './helpers';

/** F2a: possible duplicate questions, within the caller's scope only (deterministic, nothing leaves the system). */
let ctx: Ctx;
beforeAll(async () => { ctx = await boot({ studentsPerCampus: 3 }); });
afterAll(async () => { await ctx.app.close(); });

describe('question duplicates', () => {
  it('finds a reworded copy, respects course access, and is refused to students', async () => {
    const examiner = await as(ctx, 'examiner');
    const src = await ctx.prisma.question.findFirstOrThrow({ where: { course: { code: 'MBBS-PATH-4' }, status: 'APPROVED' }, include: { options: true } });
    const copy = await examiner.post('/questions', {
      courseId: src.courseId, institutionId: src.institutionId, type: src.type, vignette: src.vignette ?? undefined, difficulty: src.difficulty,
      stem: src.stem.replace(/\?$/, '') + ' (revised wording)?',
      options: [...src.options].reverse().map((o, i) => ({ label: 'ABCDE'[i]!, text: o.text, isCorrect: o.isCorrect })),
    });
    expect(copy.status, copy.raw).toBe(201);

    const r = await examiner.get(`/questions/duplicates?courseId=${src.courseId}`);
    expect(r.status).toBe(200); expect(r.body.compared).toBeGreaterThan(1);
    const hit = r.body.pairs.find((p: { a: { id: string }; b: { id: string } }) => [p.a.id, p.b.id].sort().join() === [src.id, copy.body.id].sort().join());
    expect(hit, JSON.stringify(r.body.pairs.slice(0, 3))).toBeTruthy(); expect(hit.score).toBeGreaterThanOrEqual(0.6);
    expect(hit.a).toHaveProperty('stem'); expect(JSON.stringify(r.body)).not.toMatch(/isCorrect|correctLabel/);   // no answer keys in the comparison view

    // lecturer.a2 is assigned only to Pharmacology: the Pathology pair is not visible
    const lec = await as(ctx, 'lecturer.a2');
    const l = await lec.get('/questions/duplicates');
    expect(l.status).toBe(200);
    expect(l.body.pairs.some((p: { a: { id: string }; b: { id: string } }) => [p.a.id, p.b.id].includes(src.id))).toBe(false);

    expect((await (await as(ctx, 'student.a002')).get('/questions/duplicates')).status).toBe(403);
    expect((await examiner.get('/questions/duplicates?threshold=0.1')).status).toBe(400);
  });
});
