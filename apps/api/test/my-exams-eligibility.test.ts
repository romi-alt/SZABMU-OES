import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, boot, type Ctx } from './helpers';

/** UI-051: a candidate who is not eligible is told which examination, why, and the threshold — additively on GET /me/exams. */
let ctx: Ctx;
beforeAll(async () => { ctx = await boot({ studentsPerCampus: 8 }); });
afterAll(async () => { await ctx.app.close(); });

describe('/me/exams notEligible', () => {
  it('lists the live examination for a student whose attendance made them ineligible, with the reason and threshold', async () => {
    const s = await as(ctx, 'student.a001'); const r = await s.get('/me/exams'); expect(r.status).toBe(200);
    expect(r.body.items.some((i: { code: string }) => i.code === 'MBBS-PATH-MT')).toBe(false);          // not on their schedule…
    const n = r.body.notEligible.find((x: { code: string }) => x.code === 'MBBS-PATH-MT'); expect(n, JSON.stringify(r.body.notEligible)).toBeTruthy();   // …but explained
    expect(n.reason).toMatch(/Attendance is \d+(\.\d+)?% — the minimum is 75%\./); expect(n.threshold).toBe(75);
  });
  it('is empty for an admitted student, and the existing fields are unchanged', async () => {
    const s = await as(ctx, 'student.a005'); const r = await s.get('/me/exams'); expect(r.body.notEligible).toEqual([]);
    expect(r.body.items.find((i: { code: string }) => i.code === 'MBBS-PATH-MT')).toMatchObject({ canStart: true, status: 'LIVE' });
  });
  it('shows an admission withdrawn by an administrator with its stated reason', async () => {
    const cce = await as(ctx, 'cce'); const stu = await ctx.prisma.student.findFirstOrThrow({ where: { regNo: 'DMC-A-2024-0005' } });
    const r = await cce.post(`/exams/${ctx.seeded.examId}/candidates/${stu.id}/override`, { decision: 'REVOKE', reason: 'Fee clearance pending — drill reason for the test' });
    expect(r.status, r.raw).toBe(200);
    const s = await as(ctx, 'student.a005'); const m = await s.get('/me/exams'); expect(m.body.notEligible[0]).toMatchObject({ code: 'MBBS-PATH-MT' }); expect(m.body.notEligible[0].reason).toContain('Fee clearance pending');
  });
});
