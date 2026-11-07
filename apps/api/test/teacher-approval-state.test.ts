import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, as, boot, type Ctx } from './helpers';

/**
 * Teacher approval-state matrix. The account (identity) decision and each class-subject decision are separate; access needs BOTH:
 * an APPROVED, active teacher account AND an APPROVED, non-revoked assignment. Enforced on the server on every call.
 */
let ctx: Ctx; let A: string; let PATH: string; let PHARM: string; let PROG: string; let seq = 0;
const TERM = '2026-SPRING'; const PW = 'Sturdy-Pass-2026!x';
const anon = () => new Client(ctx.app);
beforeAll(async () => {
  ctx = await boot({ studentsPerCampus: 4 });
  A = (ctx.seeded.institutions as Record<'a', { id: string }>).a.id; PATH = ctx.seeded.courses.path.id; PHARM = ctx.seeded.courses.pharm.id; PROG = ctx.seeded.programs.mbbs.id;
});
afterAll(async () => { await ctx.app.close(); });

const req = (courseId: string) => ({ institutionId: A, programId: PROG, semester: 4, term: TERM, courseId });
async function register() {
  await ctx.kv.clearPrefix('rl:treg:'); const n = `${Date.now()}${++seq}`;
  const f = { fullName: `Dr State ${n}`, email: `state${n}@example.test`, password: PW, employeeId: `ST-${n}`, department: 'Pathology', designation: 'Assistant Professor', phone: '+92 300 1234567', assignments: [req(PATH), req(PHARM)] };
  const s = await anon().post('/teacher-registration', f); expect(s.status, s.raw).toBe(200);
  expect((await anon().post('/teacher-registration/verify', { email: f.email, code: s.body.devCode })).status).toBe(200);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email: f.email } });
  const c = new Client(ctx.app, ''); const l = await c.req('POST', '/auth/login', { email: f.email, password: PW }); const sc = l.headers['set-cookie']; c.cookie = String(Array.isArray(sc) ? sc[0] : sc).split(';')[0]!;
  const rows = await ctx.prisma.courseAssignment.findMany({ where: { userId: user.id } });
  return { c, userId: user.id, path: rows.find((r) => r.courseId === PATH)!, pharm: rows.find((r) => r.courseId === PHARM)! };
}
const WORKING = ['/teacher/overview', '/teacher/assignments', '/teacher/students', '/teacher/pools', '/teacher/questions'];
const approvedIds = async (c: Client) => ((await c.get('/teacher/assignments')).body as { id: string; status: string }[]).filter((x) => x.status === 'APPROVED').map((x) => x.id);
const refused = async (c: Client) => { for (const u of WORKING) { const r = await c.get(u); expect(r.status, u).toBe(403); expect(r.body.code, u).toBe('TEACHER_NOT_APPROVED'); } };

describe('account pending, assignment pre-approved (the confusing screen)', () => {
  it('status says the ACCOUNT is pending and the approved subject is waiting for it; every working route is refused; approving the account then opens exactly that subject, in the same session', async () => {
    const t = await register(); const a = await as(ctx, 'admin.a');
    expect((await a.post(`/admin/teachers/assignments/${t.path.id}/decision`, { decision: 'APPROVE' })).status).toBe(200);   // pre-approved before the account
    const st = (await t.c.get('/teacher/status')).body;
    expect(st.status).toBe('PENDING'); expect(st.accountStatus).toBe('PENDING');
    expect(st.access).toEqual({ accountApproved: false, activeAssignments: 0 });
    expect(st.requested.find((r: any) => r.id === t.path.id)).toMatchObject({ status: 'APPROVED', effective: 'WAITS_FOR_ACCOUNT' });
    expect(st.requested.find((r: any) => r.id === t.pharm.id)).toMatchObject({ status: 'PENDING', effective: 'PENDING_REVIEW' });
    expect((await t.c.get('/auth/me')).body.permissions.sort()).toEqual(['program.read', 'teacher.self']);
    await refused(t.c);
    expect((await t.c.post('/teacher/pools', { assignmentId: t.path.id, name: 'Too early' })).status).toBe(403);

    expect((await a.post(`/admin/teachers/${t.userId}/decision`, { decision: 'APPROVE' })).status).toBe(200);
    const me = (await t.c.get('/auth/me')).body; expect(me.teacher.status).toBe('APPROVED'); expect(me.permissions).toContain('teacher.work');   // no re-login needed
    const st2 = (await t.c.get('/teacher/status')).body;
    expect(st2.access).toEqual({ accountApproved: true, activeAssignments: 1 });
    expect(st2.requested.find((r: any) => r.id === t.path.id).effective).toBe('ACTIVE');
    expect(st2.requested.find((r: any) => r.id === t.pharm.id).effective).toBe('PENDING_REVIEW');
    expect(await approvedIds(t.c)).toEqual([t.path.id]);
    expect((await t.c.post('/teacher/pools', { assignmentId: t.path.id, name: 'Approved subject' })).status).toBe(201);
    expect((await t.c.post('/teacher/pools', { assignmentId: t.pharm.id, name: 'Still pending subject' })).status).toBe(404);
  });
});

describe('mixed assignment states after account approval', () => {
  it('approved gives access; pending, rejected and revoked give none, and each says why', async () => {
    const t = await register(); const a = await as(ctx, 'admin.a');
    await a.post(`/admin/teachers/${t.userId}/decision`, { decision: 'APPROVE' });
    await a.post(`/admin/teachers/assignments/${t.path.id}/decision`, { decision: 'APPROVE' });
    expect((await a.post(`/admin/teachers/assignments/${t.pharm.id}/decision`, { decision: 'REJECT', note: 'Not your department' })).status).toBe(200);
    let st = (await t.c.get('/teacher/status')).body;
    expect(st.requested.map((r: any) => [r.id === t.path.id ? 'path' : 'pharm', r.effective]).sort()).toEqual([['path', 'ACTIVE'], ['pharm', 'REJECTED']]);
    expect((await t.c.post('/teacher/pools', { assignmentId: t.pharm.id, name: 'Rejected subject' })).status).toBe(404);
    expect((await a.post(`/admin/teachers/assignments/${t.path.id}/revoke`, { note: 'Reassigned' })).status).toBe(200);
    st = (await t.c.get('/teacher/status')).body;
    expect(st.access).toEqual({ accountApproved: true, activeAssignments: 0 });
    expect(st.requested.find((r: any) => r.id === t.path.id).effective).toBe('REVOKED');
    expect(await approvedIds(t.c)).toEqual([]);
  });
});

describe('rejected and suspended accounts', () => {
  it('a rejected account is refused everywhere even with approved assignments, and can be approved later; suspension and reinstatement switch access off and on', async () => {
    const t = await register(); const a = await as(ctx, 'admin.a');
    await a.post(`/admin/teachers/assignments/${t.path.id}/decision`, { decision: 'APPROVE' });
    expect((await a.post(`/admin/teachers/${t.userId}/decision`, { decision: 'REJECT', note: 'Could not verify identity' })).status).toBe(200);
    const login = async () => { const c = new Client(ctx.app, ''); const u = await ctx.prisma.user.findUniqueOrThrow({ where: { id: t.userId } }); const l = await c.req('POST', '/auth/login', { email: u.email, password: PW }); const sc = l.headers['set-cookie']; c.cookie = String(Array.isArray(sc) ? sc[0] : sc).split(';')[0]!; return c; };
    let c = await login();
    const st = (await c.get('/teacher/status')).body;
    expect(st).toMatchObject({ status: 'REJECTED', accountStatus: 'REJECTED', reviewNote: 'Could not verify identity', access: { accountApproved: false, activeAssignments: 0 } });
    expect(st.requested.find((r: any) => r.id === t.path.id).effective).toBe('ACCOUNT_NOT_APPROVED');
    await refused(c);
    expect((await a.post(`/admin/teachers/${t.userId}/decision`, { decision: 'APPROVE' })).status).toBe(200);
    expect(await approvedIds(c)).toEqual([t.path.id]);
    expect((await a.post(`/admin/teachers/${t.userId}/suspend`, { note: 'Under review' })).status).toBe(200);
    c = await login();
    expect((await c.get('/teacher/status')).body).toMatchObject({ status: 'SUSPENDED', access: { accountApproved: false, activeAssignments: 0 } });
    await refused(c);
    expect((await a.post(`/admin/teachers/${t.userId}/reinstate`, {})).status).toBe(200);
    expect(await approvedIds(c)).toEqual([t.path.id]);
  });
  it('a deactivated account loses access at once even though both decisions are APPROVED', async () => {
    const t = await register(); const a = await as(ctx, 'admin.a');
    await a.post(`/admin/teachers/${t.userId}/decision`, { decision: 'APPROVE' }); await a.post(`/admin/teachers/assignments/${t.path.id}/decision`, { decision: 'APPROVE' });
    expect((await t.c.get('/teacher/assignments')).status).toBe(200);
    const su = await as(ctx, 'super.admin'); expect((await su.patch(`/users/${t.userId}`, { active: false })).status).toBe(200);
    expect((await t.c.get('/teacher/assignments')).status).toBe(401);
  });
});
