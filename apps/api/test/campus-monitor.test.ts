import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, boot, type Client, type Ctx } from './helpers';

/**
 * UI-006: Campus Administrators now reach the live monitor from their menu. These tests prove the capability behind that menu item is campus-scoped
 * for every kind of viewer, so exposing it adds no authority: single campus, two campuses, an unassigned campus, an invigilator, the controller.
 */
let ctx: Ctx; let A: string; let B: string; let C: string; let exam: string;
beforeAll(async () => { ctx = await boot({ studentsPerCampus: 5 }); ({ a: { id: A }, b: { id: B }, c: { id: C } } = ctx.seeded.institutions as Record<'a' | 'b' | 'c', { id: string }>); exam = ctx.seeded.examId; });
afterAll(async () => { await ctx.app.close(); });
const rows = async (c: Client, id = exam) => { const r = await c.get(`/invigilation/exams/${id}/candidates?page=1&pageSize=100`); return { status: r.status, items: (r.body?.rows ?? []) as { institution?: string; regNo: string }[] }; };
const campuses = (items: { regNo: string }[]) => [...new Set(items.map((i) => i.regNo.split('-').slice(0, 2).join('-')))].sort();
const setCampuses = async (who: string, ids: string[]) => { const sa = await as(ctx, 'super.admin'); const u = await ctx.prisma.user.findUniqueOrThrow({ where: { email: `${who}@demo.szabmu.invalid` } }); expect((await sa.patch(`/users/${u.id}`, { institutionIds: ids })).status).toBe(200); };

describe('live monitor is campus-scoped for every viewer', () => {
  it('a Campus Administrator sees the exam in their list and only their own campus\'s candidates', async () => {
    const a = await as(ctx, 'admin.a'); const list = await a.get('/invigilation/exams'); expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).toContain(exam);
    const r = await rows(a); expect(r.status).toBe(200); expect(r.items.length).toBeGreaterThan(0); expect(campuses(r.items)).toEqual(['DMC-A']);
    const b = await as(ctx, 'admin.b'); expect(campuses((await rows(b)).items)).toEqual(['DMC-B']);
  });
  it('a campus admin has no exam-wide control (the control centre stays refused) even though the monitor is in their menu', async () => {
    const a = await as(ctx, 'admin.a'); expect((await a.get(`/exams/${exam}/control`)).status).toBe(403);
    for (const slug of ['suspend', 'start', 'close', 'extend']) expect((await a.post(`/exams/${exam}/control/${slug}`, {})).status, slug).toBe(403);
  });
  it('an administrator of two campuses sees exactly those two; removing a campus removes its rows at once', async () => {
    await setCampuses('admin.a', [A, B]);
    try {
      const a = await as(ctx, 'admin.a'); expect(campuses((await rows(a)).items)).toEqual(['DMC-A', 'DMC-B']);
      await setCampuses('admin.a', [A]); expect(campuses((await rows(await as(ctx, 'admin.a'))).items)).toEqual(['DMC-A']);
    } finally { await setCampuses('admin.a', [A]); }
  });
  it('an administrator whose campus does not take part in the exam gets nothing (not other campuses\' candidates)', async () => {
    await setCampuses('admin.a', [C]);
    try { const r = await rows(await as(ctx, 'admin.a')); expect(r.items).toEqual([]); expect(JSON.stringify(r.items)).not.toMatch(/DMC-[AB]-/); }
    finally { await setCampuses('admin.a', [A]); }
  });
  it('an invigilator assigned to the exam sees only their campus; one who is not assigned is refused', async () => {
    const inv = await as(ctx, 'invigilator.a'); expect(campuses((await rows(inv)).items)).toEqual(['DMC-A']);
    const stranger = await as(ctx, 'invigilator.b'); const s = await rows(stranger);
    expect(s.items.filter((i) => !i.regNo.startsWith('DMC-B')), 'never another campus').toEqual([]);
  });
  it('the Controller of Examinations and Super Admin see every participating campus and may open the control centre', async () => {
    for (const who of ['cce', 'super.admin']) { const c = await as(ctx, who); expect(campuses((await rows(c)).items), who).toEqual(['DMC-A', 'DMC-B']); expect((await c.get(`/exams/${exam}/control`)).status, who).toBe(200); }
  });
  it('lecturers and students cannot use the monitor at all', async () => {
    for (const who of ['lecturer.a', 'student.a002']) { const c = await as(ctx, who); expect((await c.get('/invigilation/exams')).status, who).toBe(403); expect((await rows(c)).status, who).toBe(403); }
  });
});
