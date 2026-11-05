import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, as, boot, type Ctx } from './helpers';
import { DEMO_PASSWORD, DOMAIN } from '../src/seed/seed';

let ctx: Ctx;
beforeAll(async () => { ctx = await boot({ studentsPerCampus: 3 }); });
afterAll(async () => { await ctx.app.close(); });

describe('sign-in', () => {
  it('issues an httpOnly, SameSite session cookie and never returns secrets', async () => {
    const c = new Client(ctx.app, 'student.a002');
    const r = await c.login();
    expect(r.status).toBe(200);
    const cookie = String([r.headers['set-cookie']].flat()[0]);
    expect(cookie).toMatch(/oes_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(r.raw).not.toMatch(/passwordHash|argon2/);
    expect(r.body.user.permissions).toContain('exam.sit');
    const me = await c.get('/auth/me');
    expect(me.body.student.regNo).toBe('DMC-A-2024-0002');
  });

  it('gives identical errors for wrong password and unknown account', async () => {
    const a = await new Client(ctx.app, 'student.a002').login('wrong-password-1');
    const b = await new Client(ctx.app, 'nobody.here').login('wrong-password-1');
    expect(a.status).toBe(401); expect(b.status).toBe(401);
    expect(a.body.message).toBe(b.body.message);
  });

  it('locks the account after 5 consecutive failures, even for the correct password', async () => {
    const c = new Client(ctx.app, 'student.a003');
    for (let i = 0; i < 5; i++) expect((await c.login('bad-bad-bad-1')).status).toBe(401);
    const locked = await c.login(DEMO_PASSWORD);
    expect(locked.status).toBe(423);
    await ctx.prisma.user.update({ where: { email: `student.a003@${DOMAIN}` }, data: { lockedUntil: null, failedLogins: 0 } });
    await ctx.kv.flushAll();
    expect((await c.login()).status).toBe(200);
  });

  it('throttles credential stuffing per identity (429)', async () => {
    const c = new Client(ctx.app, 'stuffing.target');
    let last = 0;
    for (let i = 0; i < 25; i++) last = (await c.login('x-wrong-pass-' + i)).status;
    expect(last).toBe(429);
    await ctx.kv.flushAll();
  });

  it('logout revokes the session server-side, even if the cookie is replayed', async () => {
    const c = await as(ctx, 'lecturer.a');
    const stolen = c.cookie;
    expect((await c.post('/auth/logout')).status).toBe(200);
    const thief = new Client(ctx.app); thief.cookie = stolen;
    expect((await thief.get('/auth/me')).status).toBe(401);
  });

  it('rejects tampered, empty and expired session tokens', async () => {
    const c = await as(ctx, 'lecturer.a');
    const bad = new Client(ctx.app); bad.cookie = c.cookie + 'x';
    expect((await bad.get('/auth/me')).status).toBe(401);
    expect((await new Client(ctx.app).get('/auth/me')).status).toBe(401);
    await ctx.prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    await ctx.kv.flushAll();
    expect((await c.get('/auth/me')).status).toBe(401);
  });
});

describe('password recovery (OTP → token → reset)', () => {
  const email = `student.b002@${DOMAIN}`;
  it('does not reveal whether an address is registered', async () => {
    const known = await new Client(ctx.app).post('/auth/forgot', { email });
    const unknown = await new Client(ctx.app).post('/auth/forgot', { email: `ghost@${DOMAIN}` });
    expect(known.status).toBe(200); expect(unknown.status).toBe(200);
    expect(known.body.message).toBe(unknown.body.message);
  });

  it('completes the flow, enforces policy and history, single-use token, signs out other devices', async () => {
    const anon = new Client(ctx.app);
    const other = await as(ctx, 'student.b002'); // another device
    const f = await anon.post('/auth/forgot', { email });
    const code = f.body.devCode as string; // only exposed because DEV_EXPOSE_CODES=true in tests
    expect(code).toMatch(/^\d{6}$/);
    const mail = await ctx.prisma.outboundMessage.findFirst({ where: { toEmail: email }, orderBy: { createdAt: 'desc' } });
    expect(mail?.body).toContain(code);
    // wrong code
    expect((await anon.post('/auth/verify-code', { email, code: code === '000000' ? '111111' : '000000' })).status).toBe(400);
    const v = await anon.post('/auth/verify-code', { email, code });
    expect(v.status).toBe(200);
    const token = v.body.resetToken;
    expect((await anon.post('/auth/reset', { resetToken: token, newPassword: 'short' })).status).toBe(400);
    // weak attempt consumed the token (GETDEL) → need a fresh one, so request again
    const f2 = await anon.post('/auth/forgot', { email });
    const v2 = await anon.post('/auth/verify-code', { email, code: f2.body.devCode });
    expect((await anon.post('/auth/reset', { resetToken: v2.body.resetToken, newPassword: DEMO_PASSWORD })).status).toBe(400); // reuse of current password
    const f3 = await anon.post('/auth/forgot', { email });
    const v3 = await anon.post('/auth/verify-code', { email, code: f3.body.devCode });
    const strong = 'Brand-New-Passw0rd!x';
    expect((await anon.post('/auth/reset', { resetToken: v3.body.resetToken, newPassword: strong })).status).toBe(200);
    expect((await anon.post('/auth/reset', { resetToken: v3.body.resetToken, newPassword: 'Another-Passw0rd!y' })).status).toBe(400); // single use
    expect((await other.get('/auth/me')).status).toBe(401); // other device signed out
    expect((await new Client(ctx.app, 'student.b002').login(DEMO_PASSWORD)).status).toBe(401);
    expect((await new Client(ctx.app, 'student.b002').login(strong)).status).toBe(200);
  });

  it('limits OTP guessing to 5 attempts per code', async () => {
    const anon = new Client(ctx.app);
    const f = await anon.post('/auth/forgot', { email: `student.a002@${DOMAIN}` });
    const real = f.body.devCode as string;
    const wrong = real === '123456' ? '654321' : '123456';
    for (let i = 0; i < 5; i++) await anon.post('/auth/verify-code', { email: `student.a002@${DOMAIN}`, code: wrong });
    expect((await anon.post('/auth/verify-code', { email: `student.a002@${DOMAIN}`, code: real })).status).toBe(400);
  });
});

describe('provisioning & forced password change', () => {
  it('admin-created accounts must change the temporary password before anything else', async () => {
    const admin = await as(ctx, 'admin.a');
    const inst = ctx.seeded.institutions.a.id;
    const r = await admin.post('/users', { email: `new.lecturer@${DOMAIN}`, fullName: 'New Lecturer (demo)', role: 'LECTURER', institutionIds: [inst] });
    expect(r.status).toBe(201);
    const tmp = r.body.temporaryPassword as string;
    const u = new Client(ctx.app, 'new.lecturer');
    expect((await u.login(tmp)).status).toBe(200);
    const blocked = await u.get('/dashboard');
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect((await u.post('/auth/change-password', { currentPassword: tmp, newPassword: 'Lecturer-New-Passw0rd!' })).status).toBe(200);
    expect((await u.get('/dashboard')).status).toBe(200);
  });

  it('profile update only touches permitted fields', async () => {
    const s = await as(ctx, 'student.a002');
    const r = await s.patch('/auth/profile', { phone: '+92 300 1234567', address: 'Synthetic Street 1', fullName: 'Hacked Name', regNo: 'HACKED' });
    expect(r.status).toBe(200);
    const me = await s.get('/auth/me');
    expect(me.body.phone).toBe('+92 300 1234567');
    expect(me.body.fullName).not.toBe('Hacked Name');
    expect(me.body.student.regNo).toBe('DMC-A-2024-0002');
  });
});
