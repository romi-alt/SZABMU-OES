import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, boot, type Ctx } from './helpers';

/**
 * UI-002 regression: PATCH /institutions/:id has strict partial-update semantics.
 * Root cause was `instDto.partial()`: zod keeps `.default('CONSTITUENT')` on a partial field, so any PATCH silently rewrote affiliation.
 */
let ctx: Ctx; let B: string; let C: string;
beforeAll(async () => { ctx = await boot({ studentsPerCampus: 4 }); ({ b: { id: B }, c: { id: C } } = ctx.seeded.institutions as Record<'a' | 'b' | 'c', { id: string }>); });
afterAll(async () => { await ctx.app.close(); });
const row = (id: string) => ctx.prisma.institution.findUniqueOrThrow({ where: { id } });
const auditFor = (id: string) => ctx.prisma.auditLog.findMany({ where: { entity: 'institution', entityId: id, action: 'institution.update' }, orderBy: { seq: 'asc' } });

describe('institution PATCH keeps every omitted field unchanged', () => {
  it('seed precondition: DMC-B is AFFILIATED', async () => { expect((await row(B)).affiliation).toBe('AFFILIATED'); });

  it('1/2. deactivating then reactivating an AFFILIATED institution changes only `active`', async () => {
    const sa = await as(ctx, 'super.admin'); const before = await row(B);
    expect((await sa.patch(`/institutions/${B}`, { active: false })).status).toBe(200);
    const off = await row(B); expect(off.active).toBe(false);
    const { active: _a, updatedAt: _u, ...restOff } = off as Record<string, unknown>; const { active: _b, updatedAt: _v, ...restBefore } = before as Record<string, unknown>;
    expect(restOff).toEqual(restBefore);                                                    // every other column identical (affiliation, type, name, code, city…)
    expect((await sa.patch(`/institutions/${B}`, { active: true })).status).toBe(200);
    const on = await row(B); expect(on.active).toBe(true); expect(on.affiliation).toBe('AFFILIATED');
  });

  it('3/4/5. updating name or contact (city) alone, as a partial PATCH, leaves affiliation/type/code untouched', async () => {
    const sa = await as(ctx, 'super.admin'); const before = await row(C);
    expect((await sa.patch(`/institutions/${C}`, { name: 'Demo College of Nursing C (renamed)' })).status).toBe(200);
    expect((await sa.patch(`/institutions/${C}`, { city: 'Karachi' })).status).toBe(200);
    const after = await row(C);
    expect(after.name).toBe('Demo College of Nursing C (renamed)'); expect(after.city).toBe('Karachi');
    expect(after.affiliation).toBe(before.affiliation); expect(after.type).toBe(before.type); expect(after.code).toBe(before.code); expect(after.active).toBe(before.active);
  });

  it('6. an empty PATCH changes nothing and writes no audit entry', async () => {
    const sa = await as(ctx, 'super.admin'); const before = await row(B); const n = (await auditFor(B)).length;
    const r = await sa.patch(`/institutions/${B}`, {}); expect(r.status).toBe(200);
    expect(await row(B)).toEqual(before); expect((await auditFor(B)).length).toBe(n);
    const same = await sa.patch(`/institutions/${B}`, { active: before.active, affiliation: before.affiliation });   // sending the stored values is also a no-op
    expect(same.status).toBe(200); expect((await auditFor(B)).length).toBe(n);
  });

  it('7. affiliation CAN be changed — explicitly, by an authorised user — and nothing else moves', async () => {
    const sa = await as(ctx, 'super.admin'); const before = await row(B);
    expect((await sa.patch(`/institutions/${B}`, { affiliation: 'CONSTITUENT' })).status).toBe(200);
    const after = await row(B); expect(after.affiliation).toBe('CONSTITUENT'); expect(after.name).toBe(before.name); expect(after.active).toBe(before.active);
    expect((await sa.patch(`/institutions/${B}`, { affiliation: 'AFFILIATED' })).status).toBe(200);            // restore for later tests
  });

  it('8. unauthorised roles cannot modify an institution or its affiliation (403) and nothing changes', async () => {
    const before = await row(B);
    for (const who of ['admin.b', 'admin.a', 'examiner', 'cce', 'lecturer.a', 'invigilator.a', 'student.a001']) {
      const c = await as(ctx, who);
      expect((await c.patch(`/institutions/${B}`, { affiliation: 'CONSTITUENT' })).status, who).toBe(403);
      expect((await c.patch(`/institutions/${B}`, { active: false })).status, who).toBe(403);
    }
    expect(await row(B)).toEqual(before);
  });

  it('9. deactivating an institution does not touch its other records or other institutions', async () => {
    const sa = await as(ctx, 'super.admin');
    const snap = async () => ({ students: await ctx.prisma.student.count({ where: { institutionId: C } }), users: await ctx.prisma.userInstitution.count({ where: { institutionId: C } }), others: await ctx.prisma.institution.findMany({ where: { id: { not: C } }, orderBy: { code: 'asc' } }) });
    const before = await snap();
    expect((await sa.patch(`/institutions/${C}`, { active: false })).status).toBe(200);
    expect(await snap()).toEqual(before);
    expect((await sa.patch(`/institutions/${C}`, { active: true })).status).toBe(200);
  });

  it('10. the audit trail records only the fields that really changed, with before/after', async () => {
    const sa = await as(ctx, 'super.admin');
    const n0 = (await auditFor(C)).length;
    await sa.patch(`/institutions/${C}`, { active: false });
    const entries = await auditFor(C); expect(entries.length).toBe(n0 + 1);
    const meta = entries.at(-1)!.meta as { changes: Record<string, { from: unknown; to: unknown }> };
    expect(Object.keys(meta.changes)).toEqual(['active']); expect(meta.changes.active).toEqual({ from: true, to: false });
    await sa.patch(`/institutions/${C}`, { active: true });
    const last = (await auditFor(C)).at(-1)!.meta as { changes: Record<string, unknown> }; expect(Object.keys(last.changes)).toEqual(['active']);
  });

  it('invalid values and unknown ids are refused cleanly', async () => {
    const sa = await as(ctx, 'super.admin'); const before = await row(B);
    expect((await sa.patch(`/institutions/${B}`, { affiliation: 'FRANCHISE' })).status).toBe(400);
    expect((await sa.patch(`/institutions/${B}`, { active: 'no' })).status).toBe(400);
    expect((await sa.patch('/institutions/00000000-0000-4000-8000-000000000000', { active: false })).status).toBe(404);
    expect(await row(B)).toEqual(before);
  });
});
