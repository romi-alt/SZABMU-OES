import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, hotp, totpAt, verifyTotp } from '../src/common/totp';
import { open, seal } from '../src/common/secretbox';
import { as, boot, type Ctx, Client } from './helpers';
import { DEMO_PASSWORD, DOMAIN } from '../src/seed/seed';

describe('TOTP primitives (RFC 6238 / RFC 4226 vectors)', () => {
  const SECRET = Buffer.from('12345678901234567890');
  it('HOTP matches RFC 4226 appendix D', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((c) => hotp(SECRET, c))).toEqual(['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489']);
  });
  it('TOTP matches RFC 6238 appendix B (SHA-1, 8 digits) at the published instants', () => {
    const b32 = base32Encode(SECRET);
    expect(totpAt(b32, 59_000, 8)).toBe('94287082'); expect(totpAt(b32, 1_111_111_109_000, 8)).toBe('07081804'); expect(totpAt(b32, 2_000_000_000_000, 8)).toBe('69279037');
  });
  it('base32 round-trips; replay and out-of-window codes are rejected; ±1 step tolerated', () => {
    const s = base32Encode(Buffer.from('abcdefghijklmnopqrst')); expect(base32Decode(s).toString()).toBe('abcdefghijklmnopqrst');
    const now = 1_700_000_000_000; const code = totpAt(s, now); const step = Math.floor(now / 30000);
    expect(verifyTotp(s, code, now, null)).toBe(step);
    expect(verifyTotp(s, code, now, step)).toBeNull();                  // same step again: replay
    expect(verifyTotp(s, code, now, step - 5)).toBe(step);
    expect(verifyTotp(s, totpAt(s, now - 30_000), now, null)).toBe(step - 1);   // slight clock drift ok
    expect(verifyTotp(s, totpAt(s, now - 120_000), now, null)).toBeNull();      // 4 steps old
    expect(verifyTotp(s, '12345', now, null)).toBeNull(); expect(verifyTotp(s, 'abcdef', now, null)).toBeNull();
  });
  it('secret box is authenticated encryption (tamper and wrong key fail)', () => {
    const boxed = seal('JBSWY3DPEHPK3PXP', 'k'.repeat(40)); expect(boxed).not.toContain('JBSWY3DP'); expect(open(boxed, 'k'.repeat(40))).toBe('JBSWY3DPEHPK3PXP');
    expect(() => open(boxed, 'x'.repeat(40))).toThrow(); expect(() => open(boxed.slice(0, -2) + 'AA', 'k'.repeat(40))).toThrow();
  });
});

describe('staff MFA end to end (MFA_ENFORCE=true)', () => {
  let ctx: Ctx;
  beforeAll(async () => { process.env.MFA_ENFORCE = 'true'; ctx = await boot({ studentsPerCampus: 3 }); });
  afterAll(async () => { await ctx.app.close(); delete process.env.MFA_ENFORCE; });

  const secretOf = async (local: string) => {
    const { open: o } = await import('../src/common/secretbox'); const u = await ctx.prisma.user.findFirstOrThrow({ where: { email: `${local}@${DOMAIN}` } });
    return o(u.totpSecretEnc!, process.env.COOKIE_SECRET!);
  };
  // each code can be used once, so tests that need several fresh codes step the clock via the stored lastStep
  const freshCode = async (local: string) => {
    const secret = await secretOf(local); const u = await ctx.prisma.user.findFirstOrThrow({ where: { email: `${local}@${DOMAIN}` } });
    let t = Date.now(); while (verifyTotp(secret, totpAt(secret, t), t, u.totpLastStep) === null) t += 30_000; return totpAt(secret, t);
  };

  it('a privileged role without a second factor can sign in but can do NOTHING except enrol (deny by default)', async () => {
    const cce = new Client(ctx.app, 'cce'); const login = await cce.login();
    expect(login.status).toBe(200); expect(login.body.user.mfa).toBe('enroll');
    for (const url of ['/exams', '/users', '/audit', '/questions', '/dashboard', '/institutions']) {
      const r = await cce.get(url); expect(r.status, url).toBe(403); expect(r.body.code).toBe('MFA_REQUIRED'); expect(r.body.mfa).toBe('enroll');
    }
    const me = await cce.get('/auth/me'); expect(me.status).toBe(200); expect(me.body.mfa).toMatchObject({ enabled: false, state: 'enroll', required: true });
  });

  it('enrol → recovery codes → every other session is signed out → full access', async () => {
    const other = new Client(ctx.app, 'examiner'); await other.login();               // a second device already signed in
    const ex = new Client(ctx.app, 'examiner'); await ex.login();
    const setup = await ex.post('/auth/mfa/setup'); expect(setup.status).toBe(200);
    expect(setup.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\/SZABMU%20OES:examiner/); expect(setup.body.secret).toMatch(/^[A-Z2-7]{32}$/);
    const row = await ctx.prisma.user.findFirstOrThrow({ where: { email: `examiner@${DOMAIN}` } });
    expect(row.totpSecretEnc).not.toContain(setup.body.secret);                         // encrypted at rest
    expect((await ex.post('/auth/mfa/enable', { code: '000000' })).status).toBe(401);   // wrong code does not enable
    expect((await ex.post('/auth/mfa/enable', { code: totpAt(setup.body.secret, Date.now()) })).status).toBe(200);
    const again = await ex.get('/exams'); expect(again.status).toBe(200);
    const row2 = await ctx.prisma.user.findFirstOrThrow({ where: { email: `examiner@${DOMAIN}` } });
    expect(row2.totpEnabledAt).not.toBeNull();
    expect((await ctx.prisma.mfaRecoveryCode.findMany({ where: { userId: row2.id } })).length).toBe(10);
    expect((await other.get('/exams')).status).toBe(401);                                // other session revoked on enabling
  });

  it('after enrolment a new sign-in is PENDING until a valid code is given; codes cannot be replayed; wrong codes lock the account', async () => {
    const ex = new Client(ctx.app, 'examiner'); const l = await ex.login(); expect(l.body.user.mfa).toBe('pending');
    expect((await ex.get('/exams')).body.code).toBe('MFA_REQUIRED');
    expect((await ex.post('/auth/mfa/setup')).status).toBe(409);                         // cannot re-seed while enabled
    expect((await ex.post('/auth/mfa/verify', { code: '123456' })).status).toBe(401);
    const code = await freshCode('examiner');
    expect((await ex.post('/auth/mfa/verify', { code })).status).toBe(200);
    expect((await ex.get('/exams')).status).toBe(200);
    // replaying the same code in a brand-new session fails
    const ex2 = new Client(ctx.app, 'examiner'); await ex2.login();
    expect((await ex2.post('/auth/mfa/verify', { code })).status).toBe(401);
    // five wrong codes ⇒ lockout (shared with password failures)
    for (let i = 0; i < 4; i++) await ex2.post('/auth/mfa/verify', { code: '000001' });
    const locked = await ex2.post('/auth/mfa/verify', { code: await freshCode('examiner') });
    expect(locked.status).toBe(423);
  });

  it('recovery codes work exactly once, are stored hashed, and are audited', async () => {
    await ctx.prisma.user.updateMany({ where: { email: `examiner@${DOMAIN}` }, data: { failedLogins: 0, lockedUntil: null } });
    // the previous test used up the attempt cap as well as the lockout; both expire with time — clear both, as waiting out the window would
    await ctx.kv.del(`rl:mfa:${(await ctx.prisma.user.findFirstOrThrow({ where: { email: `examiner@${DOMAIN}` } })).id}`);
    // mint a known recovery code (hash only is stored, so we create one directly)
    const u = await ctx.prisma.user.findFirstOrThrow({ where: { email: `examiner@${DOMAIN}` } });
    const { sha256 } = await import('../src/common/auth');
    await ctx.prisma.mfaRecoveryCode.create({ data: { userId: u.id, codeHash: sha256('ABCDE12345') } });
    const rc = new Client(ctx.app, 'examiner'); await rc.login();
    const ok = await rc.post('/auth/mfa/verify', { recoveryCode: 'abcde-12345' });
    expect(ok.status).toBe(200); expect(ok.body.recoveryCodesRemaining).toBe(10);
    expect((await rc.get('/exams')).status).toBe(200);
    const rc2 = new Client(ctx.app, 'examiner'); await rc2.login();
    expect((await rc2.post('/auth/mfa/verify', { recoveryCode: 'ABCDE-12345' })).status).toBe(401); // used
    expect((await ctx.prisma.auditLog.findMany({ where: { action: { in: ['mfa.enabled', 'mfa.verified', 'mfa.recovery_used', 'mfa.verify_failed'] } } })).length).toBeGreaterThanOrEqual(4);
    const stored = await ctx.prisma.mfaRecoveryCode.findMany({ where: { userId: u.id } }); expect(stored.every((r) => /^[0-9a-f]{64}$/.test(r.codeHash))).toBe(true);
  });

  it('required roles cannot disable MFA themselves; a Super Administrator reset removes the factor and signs the user out everywhere', async () => {
    await ctx.prisma.user.updateMany({ where: { email: `examiner@${DOMAIN}` }, data: { failedLogins: 0, lockedUntil: null } });
    const ex = new Client(ctx.app, 'examiner'); await ex.login(); await ex.post('/auth/mfa/verify', { code: await freshCode('examiner') });
    expect((await ex.post('/auth/mfa/disable', { password: DEMO_PASSWORD, code: await freshCode('examiner') })).status).toBe(403);
    // privileged account that has enrolled can reset others; examiners and unenrolled users cannot
    expect((await ex.post(`/auth/mfa/reset/${(await ctx.prisma.user.findFirstOrThrow({ where: { email: `cce@${DOMAIN}` } })).id}`)).status).toBe(403);
    const sa = new Client(ctx.app, 'super.admin'); await sa.login();
    expect((await sa.post(`/auth/mfa/reset/${'00000000-0000-4000-8000-000000000000'}`)).body.code).toBe('MFA_REQUIRED'); // SA must enrol first
    const setup = await sa.post('/auth/mfa/setup'); await sa.post('/auth/mfa/enable', { code: totpAt(setup.body.secret, Date.now()) });
    const target = await ctx.prisma.user.findFirstOrThrow({ where: { email: `examiner@${DOMAIN}` } });
    expect((await sa.post(`/auth/mfa/reset/${target.id}`)).status).toBe(200);
    expect((await ex.get('/exams')).status).toBe(401);                                    // signed out everywhere
    const t2 = await ctx.prisma.user.findUniqueOrThrow({ where: { id: target.id } }); expect(t2.totpEnabledAt).toBeNull(); expect(t2.totpSecretEnc).toBeNull();
    expect((await ctx.prisma.auditLog.findMany({ where: { action: 'mfa.reset' } })).length).toBe(1);
  });

  it('students, lecturers and invigilators are not forced to enrol, but may opt in (and opt out)', async () => {
    const st = await as(ctx, 'student.a002'); expect((await st.get('/auth/me')).body.mfa).toMatchObject({ state: 'ok', required: false });
    const lec = await as(ctx, 'lecturer.a'); expect((await lec.get('/questions')).status).toBe(200);
    const setup = await lec.post('/auth/mfa/setup'); expect((await lec.post('/auth/mfa/enable', { code: totpAt(setup.body.secret, Date.now()) })).status).toBe(200);
    const l2 = new Client(ctx.app, 'lecturer.a'); expect((await l2.login()).body.user.mfa).toBe('pending');   // opt-in is honoured on next sign-in
    await l2.post('/auth/mfa/verify', { code: await freshCode('lecturer.a') });
    // a real user waits for the next 30 s step; the test simulates that by clearing the replay marker
    await ctx.prisma.user.updateMany({ where: { email: `lecturer.a@${DOMAIN}` }, data: { totpLastStep: null } });
    const off = await l2.post('/auth/mfa/disable', { password: DEMO_PASSWORD, code: await freshCode('lecturer.a') });
    expect(off.status).toBe(200);
    expect((await new Client(ctx.app, 'lecturer.a').login()).body.user.mfa).toBe('ok');
  });
});
