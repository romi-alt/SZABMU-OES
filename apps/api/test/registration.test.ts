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

describe('sign-up (registration number + email + password + emailed code)', () => {
  const start = (regNo: string, email: string, password = PW) => anon().post('/auth/register', { regNo, email, password });
  const clear = async () => { const k = await ctx.redis.client.keys('rl:reg:*'); if (k.length) await ctx.redis.client.del(...k); };
  const verify = async (email: string, code: string) => { const c = anon(); const r = await c.req('POST', '/auth/register/verify', { email, code }); const sc = r.headers['set-cookie']; if (sc) c.cookie = String(Array.isArray(sc) ? sc[0] : sc).split(';')[0]!; return { c, r }; };

  it('needs no match against the official register: the code creates a STUDENT account, signs it in, and creates no Student record or enrolment yet', async () => {
    await clear(); const regNo = `SELF-${++seq}`; const email = 'self.signup@example.test';
    const s = await start(regNo, email); expect(s.status).toBe(200); expect(s.body.devCode).toMatch(/^\d{6}$/);
    expect((await anon().post('/auth/login', { email, password: PW })).status).toBe(401);             // no account before the code is entered
    const { c, r } = await verify(email, s.body.devCode); expect(r.status, r.raw).toBe(200); expect(c.cookie).toContain('oes_session');
    const me = await c.get('/auth/me'); expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ role: 'STUDENT', email, studentId: null, student: null, onboarding: { required: true, regNo } });
    const u = await ctx.prisma.user.findUniqueOrThrow({ where: { email }, include: { student: true, studentSignup: true } });
    expect(u.student).toBeNull(); expect(u.studentSignup).toMatchObject({ regNo, completedAt: null }); expect(await ctx.prisma.enrollment.count({ where: { student: { userId: u.id } } })).toBe(0);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'student.signed_up', entityId: u.id } })).toBe(1);
  });

  it('tells the student why no code was sent: number already registered (any case), email in use, or an existing student number — and creates nothing', async () => {
    await clear(); const regNo = `PROBE-${++seq}`; const a = await start(regNo, 'probe1@example.test'); await verify('probe1@example.test', a.body.devCode);
    await clear(); const same = await start(regNo.toLowerCase(), 'probe2@example.test'); expect(same.status).toBe(409); expect(same.body.code).toBe('ALREADY_REGISTERED');
    await clear(); const mail = await start(`PROBE-X-${seq}`, 'probe1@example.test'); expect(mail.status).toBe(409); expect(mail.body.code).toBe('EMAIL_IN_USE');
    await clear(); const existing = await start('DMC-A-2024-0001', 'probe3@example.test'); expect(existing.status).toBe(409); expect(existing.body.code).toBe('ALREADY_REGISTERED');
    expect(await ctx.prisma.user.count({ where: { email: { in: ['probe2@example.test', 'probe3@example.test'] } } })).toBe(0);
  });

  it('checks the code: wrong code, reuse, expiry by attempts, and bad input', async () => {
    await clear(); const email = 'codes@example.test'; const s = await start(`COD-${++seq}`, email);
    const wrong = s.body.devCode === '000000' ? '111111' : '000000';
    expect((await verify(email, wrong)).r.status).toBe(400); expect((await verify(email, s.body.devCode)).r.status).toBe(200); expect((await verify(email, s.body.devCode)).r.status).toBe(400);
    await clear(); const e2 = 'codes2@example.test'; await start(`COD-${++seq}`, e2); for (let i = 0; i < 5; i++) await verify(e2, '123456'); expect((await verify(e2, '123456')).r.status).toBe(400);
    await clear(); expect((await start(`COD-${++seq}`, 'weak@example.test', 'short')).status).toBe(400); expect((await start('x', 'x@example.test')).status).toBe(400); expect((await start(`COD-${++seq}`, 'not-an-email')).status).toBe(400);
    expect((await anon().post('/auth/register/verify', { email: 'x@example.test', code: '12ab56' })).status).toBe(400);
  });

  it('is rate limited per registration number', async () => {
    await clear(); const regNo = `RL-${++seq}`; let last = 200;
    for (let i = 0; i < 7; i++) last = (await start(regNo, `rl${i}@example.test`)).status;
    expect(last).toBe(429); await clear();
  });
});
