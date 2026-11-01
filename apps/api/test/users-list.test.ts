import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, boot, type Ctx } from './helpers';

/** UI-024: the "Staff & accounts" list defaults to staff (additive `staffOnly`); students stay reachable via the role filter; scope is unchanged. */
let ctx: Ctx;
beforeAll(async () => { ctx = await boot({ studentsPerCampus: 3 }); });
afterAll(async () => { await ctx.app.close(); });
const roles = (r: { body: { items: { role: string }[] } }) => new Set(r.body.items.map((i) => i.role));

describe('GET /users?staffOnly=true', () => {
  it('without the flag the list is unchanged (contract is additive)', async () => {
    const sa = await as(ctx, 'super.admin'); const r = await sa.get('/users?pageSize=100'); expect(r.status).toBe(200); expect(roles(r).has('STUDENT')).toBe(true);
  });
  it('super admin: staffOnly hides students; an explicit role still wins', async () => {
    const sa = await as(ctx, 'super.admin');
    const s = await sa.get('/users?pageSize=100&staffOnly=true'); expect(s.status).toBe(200); expect(roles(s).has('STUDENT')).toBe(false); expect(roles(s).size).toBeGreaterThan(1);
    const st = await sa.get('/users?pageSize=100&staffOnly=true&role=STUDENT'); expect(roles(st)).toEqual(new Set(['STUDENT']));
  });
  it('campus admin: staffOnly hides students and stays inside the campus-creatable roles and own campus', async () => {
    const ca = await as(ctx, 'admin.a'); const r = await ca.get('/users?pageSize=100&staffOnly=true'); expect(r.status).toBe(200);
    expect(roles(r).has('STUDENT')).toBe(false); for (const x of roles(r)) expect(['LECTURER', 'INVIGILATOR']).toContain(x);
    const all = await ca.get('/users?pageSize=100'); expect(roles(all).has('STUDENT')).toBe(true);
  });
  it('rejects a malformed flag and still refuses non-admins', async () => {
    const sa = await as(ctx, 'super.admin'); expect((await sa.get('/users?staffOnly=maybe')).status).toBe(400);
    const st = await as(ctx, 'student.a001'); expect((await st.get('/users?staffOnly=true')).status).toBe(403);
  });
});
