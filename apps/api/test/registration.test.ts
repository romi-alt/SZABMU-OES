import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, as, boot, type Ctx } from './helpers';

/** Student self-registration against the official register: matching, enumeration safety, email proof, single claim, authorization, scope. */
let ctx: Ctx; let A: string; let B: string; let seq = 100;
beforeAll(async () => { ctx = await boot({ studentsPerCampus: 3 }); ({ a: { id: A }, b: { id: B } } = ctx.seeded.institutions as Record<'a' | 'b' | 'c', { id: string }>); });
afterAll(async () => { await ctx.app.close(); });
const PW = 'Sturdy-Pass-2026!x';
const anon = () => new Client(ctx.app);
const row = (extra: Record<string, unknown> = {}) => ({ regNo: `NEW-A-${++seq}`, fullName: 'Amna Test Student', dateOfBirth: '2004-03-09', programCode: 'MBBS', semester: 2, batchYear: 2025, ...extra });
const load = async (rows: ReturnType<typeof row>[], inst = A, who = 'admin.a') => (await as(ctx, who)).post('/roster/import', { institutionId: inst, rows });

describe('roster import', () => {
  it('a campus admin imports for their own campus; the list shows status but never dates of birth', async () => {
    const r = row(); expect((await load([r])).body.imported).toBe(1);
    const l = await (await as(ctx, 'admin.a')).get(`/roster?search=${r.regNo}`); expect(l.status).toBe(200);
    expect(l.body.items[0]).toMatchObject({ regNo: r.regNo, claimedAt: null }); expect(JSON.stringify(l.body)).not.toContain('2004-03-09');
  });
  it('is refused for another campus, for non-admin roles, and for students', async () => {
    expect((await load([row()], B)).status).toBe(403);
    for (const who of ['lecturer.a', 'examiner', 'student.a001', 'invigilator.a']) expect((await load([row()], A, who)).status, who).toBe(403);
  });
  it('validates: unknown programme, duplicates in file, existing student/roster numbers, bad dates', async () => {
    expect((await load([row({ programCode: 'NOPE' })])).status).toBe(400);
    const d = row(); expect((await load([d, { ...d, fullName: 'Other' }])).status).toBe(400);
    expect((await load([row({ regNo: 'DMC-A-2024-0001' })])).status).toBe(409);                  // already a student
    const r = row(); await load([r]); expect((await load([{ ...r }])).status).toBe(409);        // already on the register
    expect((await load([row({ dateOfBirth: '2999-01-01' })])).status).toBe(400);
    expect((await load([row({ dateOfBirth: '09/03/2004' })])).status).toBe(400);
  });
});

describe('registration flow', () => {
  const start = (r: { regNo: string; dateOfBirth: string }, email: string, password = PW) => anon().post('/auth/register', { regNo: r.regNo, dateOfBirth: r.dateOfBirth, email, password });

  it('matching details + emailed code create a STUDENT bound to the roster entry; the person can then sign in; the entry is claimed', async () => {
    const r = row(); await load([r]); const email = 'amna.new@example.test';
    const s = await start(r, email); expect(s.status).toBe(200); expect(s.body.devCode).toMatch(/^\d{6}$/);
    expect((await anon().post('/auth/login', { email, password: PW })).status).toBe(401);       // no account before the code is entered
    expect((await anon().post('/auth/register/verify', { email, code: s.body.devCode })).status).toBe(200);
    const stu = await ctx.prisma.student.findUniqueOrThrow({ where: { regNo: r.regNo }, include: { user: true } });
    expect(stu.user).toMatchObject({ email, role: 'STUDENT', fullName: r.fullName, mustChangePw: false }); expect(stu).toMatchObject({ institutionId: A, semester: 2, batchYear: 2025 });
    const login = await anon().post('/auth/login', { email, password: PW }); expect(login.status).toBe(200);
    expect((await ctx.prisma.rosterEntry.findUniqueOrThrow({ where: { regNo: r.regNo } })).claimedByUserId).toBe(stu.userId);
    expect(await ctx.prisma.enrollment.count({ where: { studentId: stu.id } })).toBe(0);         // registering grants no enrolment / exam access
    expect(await ctx.prisma.auditLog.count({ where: { action: 'student.self_registered', entityId: stu.userId } })).toBe(1);
  });

  it('answers identically whether or not the details match, so the register cannot be probed', async () => {
    const r = row(); await load([r]);
    const good = await start(r, 'probe.good@example.test'); const wrongDob = await start({ ...r, dateOfBirth: '2004-03-10' }, 'probe.dob@example.test');
    const unknown = await start({ regNo: 'NOPE-0000', dateOfBirth: r.dateOfBirth }, 'probe.none@example.test'); const taken = await start(r, 'student.a001@demo.szabmu.invalid');
    for (const x of [wrongDob, unknown, taken]) { expect(x.status).toBe(good.status); expect(x.body.message).toBe(good.body.message); expect(x.body.devCode).toBeUndefined(); }
    expect(await ctx.prisma.user.count({ where: { email: { startsWith: 'probe.' } } })).toBe(0);
  });

  it('wrong codes are limited to five tries, then the pending registration is destroyed', async () => {
    const r = row(); await load([r]); const email = 'limit@example.test'; const s = await start(r, email);
    const wrong = s.body.devCode === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) expect((await anon().post('/auth/register/verify', { email, code: wrong })).status).toBe(400);
    expect((await anon().post('/auth/register/verify', { email, code: s.body.devCode })).status).toBe(400);
    expect(await ctx.prisma.student.count({ where: { regNo: r.regNo } })).toBe(0);
  });

  it('a code cannot be reused, and an entry can be claimed by only one person even if two registrations were started', async () => {
    const r = row(); await load([r]);
    const a = await start(r, 'race.a@example.test'); const b = await start(r, 'race.b@example.test');
    const [x, y] = await Promise.all([anon().post('/auth/register/verify', { email: 'race.a@example.test', code: a.body.devCode }), anon().post('/auth/register/verify', { email: 'race.b@example.test', code: b.body.devCode })]);
    expect([x.status, y.status].sort()).toEqual([200, 400]);
    expect(await ctx.prisma.student.count({ where: { regNo: r.regNo } })).toBe(1);
    const winner = x.status === 200 ? { email: 'race.a@example.test', code: a.body.devCode } : { email: 'race.b@example.test', code: b.body.devCode };
    expect((await anon().post('/auth/register/verify', winner)).status).toBe(400);
    expect((await start(r, 'race.c@example.test')).body.devCode).toBeUndefined();               // already claimed
  });

  it('enforces the password policy and input validation', async () => {
    const r = row(); await load([r]);
    expect((await start(r, 'weak@example.test', 'short')).status).toBe(400);
    expect((await start(r, 'not-an-email')).status).toBe(400);
    expect((await anon().post('/auth/register', { regNo: r.regNo, email: 'x@example.test', password: PW })).status).toBe(400);
    expect((await anon().post('/auth/register/verify', { email: 'x@example.test', code: '12ab56' })).status).toBe(400);
  });

  it('is rate limited per registration number', async () => {
    const r = row(); await load([r]); let last = 200;
    for (let i = 0; i < 7; i++) last = (await start({ ...r, dateOfBirth: '2004-01-0' + (1 + (i % 8)) }, `rl${i}@example.test`)).status;
    expect(last).toBe(429);
  });
});
