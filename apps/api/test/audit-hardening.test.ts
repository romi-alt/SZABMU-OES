import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sessionCookieOptions } from '../src/common/auth';
import { Client, as, boot, startExam, type Ctx } from './helpers';
import { DOMAIN } from '../src/seed/seed';

/** Regression tests for findings of the 2026-11 full-system audit (docs/audits/SECURITY_FINDINGS.md). */

describe('SEC-01: the session cookie carries Secure whenever the site is served over HTTPS', () => {
  it('production, an HTTPS request, or all-https origins → Secure; plain-http local development → not Secure', () => {
    expect(sessionCookieOptions({ NODE_ENV: 'production', WEB_ORIGIN: 'http://localhost:3000' }, {}).secure).toBe(true);
    // the live demo: API runs with NODE_ENV=development behind HTTPS
    expect(sessionCookieOptions({ NODE_ENV: 'development', WEB_ORIGIN: 'https://szabmu.site,https://dashboard.szabmu.site' }, { protocol: 'http' }).secure).toBe(true);
    expect(sessionCookieOptions({ NODE_ENV: 'development', WEB_ORIGIN: 'http://localhost:3000' }, { protocol: 'https' }).secure).toBe(true);
    expect(sessionCookieOptions({ NODE_ENV: 'development', WEB_ORIGIN: 'http://localhost:3000' }, { protocol: 'http' }).secure).toBe(false);
    expect(sessionCookieOptions({ NODE_ENV: 'development', WEB_ORIGIN: 'https://szabmu.site,http://localhost:3000' }, { protocol: 'http' }).secure).toBe(false);
  });
  it('keeps httpOnly, SameSite=Lax and path / on every variant', () => {
    const o = sessionCookieOptions({ NODE_ENV: 'development', WEB_ORIGIN: 'http://localhost:3000' }, {}, new Date(0));
    expect(o).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/', expires: new Date(0) });
  });
});

describe('SEC-02: integrity events are bounded and rate-limited', () => {
  let ctx: Ctx;
  beforeAll(async () => { ctx = await boot({ studentsPerCampus: 6 }); });
  afterAll(async () => { await ctx.app.close(); });

  it('rejects oversized or nested detail, accepts the normal event, and throttles a flood', async () => {
    const s = await as(ctx, 'student.b004'); const { attemptId, clientId } = await startExam(ctx, s);
    const url = `/attempts/${attemptId}/events`;
    expect((await s.post(url, { clientId, kind: 'TAB_HIDDEN', detail: { blob: 'x'.repeat(5000) } })).status).toBe(400);
    expect((await s.post(url, { clientId, kind: 'TAB_HIDDEN', detail: { nested: { a: 1 } } })).status).toBe(400);
    expect((await s.post(url, { clientId, kind: 'TAB_HIDDEN', detail: Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`k${i}`, i])) })).status).toBe(400);
    const ok = await s.post(url, { clientId, kind: 'TAB_HIDDEN' }); expect(ok.status).toBe(200); expect(ok.body).toEqual({ ok: true });
    let limited = 0;
    for (let i = 0; i < 70; i++) if ((await s.post(url, { clientId, kind: 'TAB_VISIBLE' })).status === 429) limited++;
    expect(limited).toBeGreaterThan(0);
    // the attempt itself is unaffected: answers still save
    const q = (await s.post('/attempts/start', { examId: ctx.seeded.examId, clientId })).body.questions[0];
    expect((await s.put(`/attempts/${attemptId}/answers/${q.id}`, { clientId, revision: 1, selectedLabel: 'A', state: 'ANSWERED', markedForReview: false, visited: true })).status).toBe(200);
  });
});

describe('SEC-03/04/05: password reset hardening', () => {
  let ctx: Ctx;
  beforeAll(async () => { ctx = await boot({ studentsPerCampus: 6 }); });
  afterAll(async () => { await ctx.app.close(); });
  const inject = (url: string, payload: unknown, remoteAddress = '127.0.0.1') =>
    ctx.app.getHttpAdapter().getInstance().inject({ method: 'POST', url: `/api${url}`, payload: payload as never, remoteAddress }).then((r) => ({ status: r.statusCode, body: JSON.parse(r.body) }));

  it('SEC-03 a burst of parallel wrong guesses consumes at most 5 attempts, and the right code is then refused', async () => {
    const email = `student.b003@${DOMAIN}`;
    const code = (await inject('/auth/forgot', { email })).body.devCode as string;
    const wrong = Array.from({ length: 30 }, (_, i) => String((Number(code) + 1 + i) % 1_000_000).padStart(6, '0'));
    const rs = await Promise.all(wrong.map((c) => inject('/auth/verify-code', { email, code: c })));
    expect(rs.every((r) => r.status === 400)).toBe(true);
    const row = await ctx.prisma.passwordReset.findFirstOrThrow({ where: { user: { email } }, orderBy: { createdAt: 'desc' } });
    expect(row.attempts).toBeLessThanOrEqual(5);
    expect((await inject('/auth/verify-code', { email, code })).status).toBe(400);
  });

  it('SEC-04 rotating IP addresses cannot mint unlimited codes for one address (and unknown addresses are limited the same way)', async () => {
    for (const email of [`student.b005@${DOMAIN}`, `nobody.here@${DOMAIN}`]) {
      const statuses: number[] = [];
      for (let i = 0; i < 14; i++) statuses.push((await inject('/auth/forgot', { email }, `10.9.${i}.7`)).status);
      expect(statuses.slice(0, 10).every((s) => s === 200), email).toBe(true);
      expect(statuses.slice(10).every((s) => s === 429), email).toBe(true);
    }
  });

  it('SEC-05 the reset audit entry records the account’s real role', async () => {
    const email = `invigilator.b@${DOMAIN}`;
    const code = (await inject('/auth/forgot', { email }, '10.20.0.1')).body.devCode as string;
    const token = (await inject('/auth/verify-code', { email, code }, '10.20.0.1')).body.resetToken as string;
    expect((await inject('/auth/reset', { resetToken: token, newPassword: 'Brand-New-Passw0rd-2026!' }, '10.20.0.1')).status).toBe(200);
    const entry = await ctx.prisma.auditLog.findFirstOrThrow({ where: { action: 'auth.password_reset' }, orderBy: { seq: 'desc' } });
    expect(entry.actorRole).toBe('INVIGILATOR');
  });
});

describe('SEC-06: sign-up verification codes cannot be brute-forced with parallel guesses', () => {
  let ctx: Ctx;
  beforeAll(async () => { ctx = await boot({ studentsPerCampus: 6 }); });
  afterAll(async () => { await ctx.app.close(); });
  const inject = (url: string, payload: unknown, remoteAddress: string) =>
    ctx.app.getHttpAdapter().getInstance().inject({ method: 'POST', url: `/api${url}`, payload: payload as never, remoteAddress }).then((r) => ({ status: r.statusCode, body: JSON.parse(r.body) }));

  it('30 parallel wrong guesses from 30 addresses use up the 5 guesses: the right code no longer works and no account is created', async () => {
    const email = `brute.${Date.now()}@example.test`;
    const s = await inject('/auth/register', { regNo: `BF/${Date.now()}`, email, password: 'Sturdy-Pass-2026!x' }, '10.30.0.1');
    expect(s.status).toBe(200); const code = s.body.devCode as string;
    const wrong = Array.from({ length: 30 }, (_, i) => String((Number(code) + 1 + i) % 1_000_000).padStart(6, '0'));
    const rs = await Promise.all(wrong.map((c, i) => inject('/auth/register/verify', { email, code: c }, `10.31.${i}.9`)));
    expect(rs.every((r) => r.status === 400)).toBe(true);
    expect((await inject('/auth/register/verify', { email, code }, '10.32.0.1')).status).toBe(400);
    expect(await ctx.prisma.user.count({ where: { email } })).toBe(0);
  });

  it('a normal sign-up still works, including after a couple of typos', async () => {
    const email = `normal.${Date.now()}@example.test`;
    const s = await inject('/auth/register', { regNo: `NM/${Date.now()}`, email, password: 'Sturdy-Pass-2026!x' }, '10.33.0.1'); const code = s.body.devCode as string;
    for (const typo of ['000001', '999998']) if (typo !== code) expect((await inject('/auth/register/verify', { email, code: typo }, '10.33.0.1')).status).toBe(400);
    expect((await inject('/auth/register/verify', { email, code }, '10.33.0.1')).status).toBe(200);
  });
});

describe('SEC-06 (teacher path): teacher sign-up codes cannot be brute-forced with parallel guesses', () => {
  let ctx: Ctx; let seq = 0;
  beforeAll(async () => { ctx = await boot({ studentsPerCampus: 3 }); });
  afterAll(async () => { await ctx.app.close(); });
  const inject = (url: string, payload: unknown, remoteAddress: string) =>
    ctx.app.getHttpAdapter().getInstance().inject({ method: 'POST', url: `/api${url}`, payload: payload as never, remoteAddress }).then((r) => ({ status: r.statusCode, body: JSON.parse(r.body) }));
  const form = () => {
    const n = ++seq; const c = ctx.seeded.courses.path.id; const i = (ctx.seeded.institutions as Record<'a', { id: string }>).a.id;
    return { fullName: `Dr Brute Force ${n}`, email: `tbrute${n}.${Date.now()}@example.test`, password: 'Sturdy-Pass-2026!x', employeeId: `BF-${Date.now()}-${n}`, department: 'Pathology', designation: 'Assistant Professor', phone: '+92 300 1234567',
      assignments: [{ institutionId: i, programId: ctx.seeded.programs.mbbs.id, semester: 4, term: '2026-SPRING', courseId: c }] };
  };

  it('30 parallel wrong guesses from 30 addresses use up the 5 guesses: the right code no longer works and no teacher account is created', async () => {
    const f = form(); const s = await inject('/teacher-registration', f, '10.40.0.1');
    expect(s.status).toBe(200); const code = s.body.devCode as string;
    const wrong = Array.from({ length: 30 }, (_, i) => String((Number(code) + 1 + i) % 1_000_000).padStart(6, '0'));
    const rs = await Promise.all(wrong.map((c, i) => inject('/teacher-registration/verify', { email: f.email, code: c }, `10.41.${i}.9`)));
    expect(rs.every((r) => r.status === 400)).toBe(true);
    expect((await inject('/teacher-registration/verify', { email: f.email, code }, '10.42.0.1')).status).toBe(400);
    expect(await ctx.prisma.user.count({ where: { email: f.email } })).toBe(0);
  });

  it('a normal teacher sign-up still works, including after a couple of typos', async () => {
    const f = form(); const s = await inject('/teacher-registration', f, '10.43.0.1'); const code = s.body.devCode as string;
    for (const typo of ['000001', '999998']) if (typo !== code) expect((await inject('/teacher-registration/verify', { email: f.email, code: typo }, '10.43.0.1')).status).toBe(400);
    expect((await inject('/teacher-registration/verify', { email: f.email, code }, '10.43.0.1')).status).toBe(200);
    expect(await ctx.prisma.user.count({ where: { email: f.email, role: 'TEACHER' } })).toBe(1);
  });
});

describe('SEC-07: the second factor cannot be brute-forced with parallel guesses', () => {
  let ctx: Ctx;
  beforeAll(async () => { process.env.MFA_ENFORCE = 'true'; ctx = await boot({ studentsPerCampus: 3 }); });
  afterAll(async () => { await ctx.app.close(); delete process.env.MFA_ENFORCE; });

  it('a burst of 40 parallel wrong codes is capped before verification; afterwards even the right code is refused and the account is locked', async () => {
    const { totpAt } = await import('../src/common/totp');
    const setupClient = new Client(ctx.app, 'cce'); await setupClient.login();
    const secret = (await setupClient.post('/auth/mfa/setup')).body.secret as string;
    expect((await setupClient.post('/auth/mfa/enable', { code: totpAt(secret, Date.now()) })).status).toBe(200);
    await ctx.kv.del(`rl:mfa:${(await ctx.prisma.user.findFirstOrThrow({ where: { email: `cce@${DOMAIN}` } })).id}`);   // enrolment used one try

    const attacker = new Client(ctx.app, 'cce'); expect((await attacker.login()).body.user.mfa).toBe('pending');   // has the password, not the device
    const right = totpAt(secret, Date.now());
    const wrong = Array.from({ length: 40 }, (_, i) => String((Number(right) + 7 + i) % 1_000_000).padStart(6, '0'));
    const rs = await Promise.all(wrong.map((code) => attacker.post('/auth/mfa/verify', { code })));
    expect(rs.every((r) => [401, 423, 429].includes(r.status))).toBe(true);
    expect(rs.filter((r) => r.status === 429).length).toBeGreaterThanOrEqual(30);                    // refused before any code was checked
    const row = await ctx.prisma.user.findFirstOrThrow({ where: { email: `cce@${DOMAIN}` } });
    expect(row.lockedUntil && row.lockedUntil > new Date()).toBe(true);                               // the lockout is reached despite the burst
    expect((await attacker.post('/auth/mfa/verify', { code: right })).status).not.toBe(200);
    expect((await attacker.get('/exams')).status).toBe(403);
  });
});

describe('SEC-08: client address behind a proxy', () => {
  it('TRUST_PROXY accepts true, false or a hop count; a hop count takes the address the trusted proxy saw, not a client-supplied one', async () => {
    const { trustProxySetting } = await import('../src/config');
    const Fastify = (await import('fastify')).default;
    expect([trustProxySetting('true'), trustProxySetting('false')]).toEqual([true, false]);
    const ipWith = async (trustProxy: ReturnType<typeof trustProxySetting>) => {
      const f = Fastify({ trustProxy }); f.get('/ip', async (req) => ({ ip: req.ip }));
      // the client forges "6.6.6.6"; the single real proxy (remote 10.0.0.1) appends the address it actually saw, 203.0.113.9
      const r = await f.inject({ method: 'GET', url: '/ip', remoteAddress: '10.0.0.1', headers: { 'x-forwarded-for': '6.6.6.6, 203.0.113.9' } }); await f.close();
      return (JSON.parse(r.body) as { ip: string }).ip;
    };
    expect(await ipWith(true)).toBe('6.6.6.6');        // trusting every hop: the forged value wins (the SEC-08 problem)
    expect(await ipWith(trustProxySetting('1'))).toBe('203.0.113.9');   // one trusted hop: the address the proxy saw
    expect(await ipWith(trustProxySetting('2'))).toBe('6.6.6.6');       // (two real proxies would each append their own address)
    expect(await ipWith(false)).toBe('10.0.0.1');
  });
});
