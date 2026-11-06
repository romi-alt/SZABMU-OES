import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, boot, type Ctx } from './helpers';

/** Audit A-11: terms in use for a course, with exam and (campus-scoped) enrolment counts; read-only. */
let ctx: Ctx;
beforeAll(async () => { ctx = await boot({ studentsPerCampus: 4 }); });
afterAll(async () => { await ctx.app.close(); });

describe('GET /courses/:id/terms', () => {
  it('lists the course terms with counts, scopes enrolment counts to the caller’s campus, and refuses students', async () => {
    const path = await ctx.prisma.course.findFirstOrThrow({ where: { code: 'MBBS-PATH-4' } });
    const all = await ctx.prisma.enrollment.count({ where: { courseId: path.id, term: '2026-SPRING' } });
    const campusA = await ctx.prisma.enrollment.count({ where: { courseId: path.id, term: '2026-SPRING', student: { institution: { code: 'DMC-A' } } } });
    expect(campusA).toBeLessThan(all);

    const cce = (await (await as(ctx, 'cce')).get(`/courses/${path.id}/terms`)).body;
    expect(cce).toEqual([{ term: '2026-SPRING', exams: 1, enrolled: all }]);
    const adminA = await as(ctx, 'admin.a');
    expect((await adminA.get(`/courses/${path.id}/terms`)).body).toEqual([{ term: '2026-SPRING', exams: 1, enrolled: campusA }]);
    expect((await (await as(ctx, 'student.a002')).get(`/courses/${path.id}/terms`)).status).toBe(403);
    expect((await adminA.get('/courses/not-a-uuid/terms')).status).toBe(400);
  });
});
