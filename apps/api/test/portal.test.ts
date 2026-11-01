import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, boot, type Ctx } from './helpers';
import { DEMO_PASSWORD, DOMAIN } from '../src/seed/seed';

/**
 * Two-portal deployment (oes.szabmu.site = student, dashboard.szabmu.site = staff). The reverse proxy sets X-OES-Portal; with
 * PORTAL_ENFORCE=true the API must refuse a role on the wrong portal at sign-in AND on every later request, and fail closed
 * when the header is missing. With the flag off (the default, and every other test file) nothing changes.
 */
const H = (portal: string) => ({ 'x-oes-portal': portal });
let ctx: Ctx; let previous: string | undefined;
beforeAll(async () => { previous = process.env.PORTAL_ENFORCE; process.env.PORTAL_ENFORCE = 'true'; ctx = await boot({ studentsPerCampus: 3 }); });
afterAll(async () => { await ctx.app.close(); if (previous === undefined) delete process.env.PORTAL_ENFORCE; else process.env.PORTAL_ENFORCE = previous; });

const signIn = (local: string, portal?: string) => new Client(ctx.app, local).req('POST', '/auth/login', { email: `${local}@${DOMAIN}`, password: DEMO_PASSWORD }, portal ? H(portal) : {});
const cookieOf = (r: { headers: Record<string, unknown> }) => String([r.headers['set-cookie']].flat()[0] ?? '').split(';')[0]!;
const STAFF = ['examiner', 'cce', 'admin.a', 'lecturer.a', 'invigilator.b'];

describe('sign-in is bound to the portal', () => {
  it('a candidate signs in on the student portal and is refused on the staff portal with the same message as a wrong password', async () => {
    expect((await signIn('student.a002', 'student')).status).toBe(200);
    const wrong = await signIn('student.a002', 'staff');
    const bad = await new Client(ctx.app, 'student.a002').req('POST', '/auth/login', { email: `student.a002@${DOMAIN}`, password: 'wrong-password-1' }, H('staff'));
    expect(wrong.status).toBe(401); expect(wrong.body.code).toBe('INVALID_CREDENTIALS'); expect(wrong.body.message).toBe(bad.body.message);
    expect(wrong.headers['set-cookie']).toBeUndefined();
  });

  it.each(STAFF)('%s signs in on the staff portal and is refused on the student portal', async (local) => {
    expect((await signIn(local, 'staff')).status).toBe(200);
    const r = await signIn(local, 'student');
    expect(r.status).toBe(401); expect(r.body.code).toBe('INVALID_CREDENTIALS'); expect(r.headers['set-cookie']).toBeUndefined();
  });

  it('fails closed: no header, an unknown value or a different case is refused for everyone', async () => {
    for (const local of ['student.a002', 'examiner']) {
      expect((await signIn(local)).status).toBe(401);
      expect((await signIn(local, 'admin')).status).toBe(401);
      expect((await signIn(local, 'Staff')).status).toBe(401);
    }
  });

  it('records the refused attempt in the audit log and counts it', async () => {
    await signIn('student.a002', 'staff');
    const n = await ctx.prisma.auditLog.count({ where: { action: 'auth.login_wrong_portal' } });
    expect(n).toBeGreaterThan(0);
  });
});

describe('a session is only honoured on its own portal', () => {
  it('a candidate session works on the student portal and is rejected (403 WRONG_PORTAL) on the staff portal or without the header', async () => {
    const cookie = cookieOf(await signIn('student.a002', 'student'));
    const c = new Client(ctx.app, 'student.a002'); c.cookie = cookie;
    expect((await c.req('GET', '/auth/me', undefined, H('student'))).status).toBe(200);
    const onStaff = await c.req('GET', '/auth/me', undefined, H('staff'));
    expect(onStaff.status).toBe(403); expect(onStaff.body.code).toBe('WRONG_PORTAL');
    expect((await c.req('GET', '/auth/me')).status).toBe(403);
  });

  it('a staff session works on the staff portal and is rejected on the student portal', async () => {
    const cookie = cookieOf(await signIn('examiner', 'staff'));
    const c = new Client(ctx.app, 'examiner'); c.cookie = cookie;
    expect((await c.req('GET', '/auth/me', undefined, H('staff'))).status).toBe(200);
    expect((await c.req('GET', '/auth/me', undefined, H('student'))).body.code).toBe('WRONG_PORTAL');
  });

  it('public endpoints stay reachable on both portals (health, recovery request)', async () => {
    const c = new Client(ctx.app);
    for (const portal of ['student', 'staff']) {
      expect((await c.req('GET', '/health', undefined, H(portal))).status).toBe(200);
      expect((await c.req('POST', '/auth/forgot', { email: `nobody@${DOMAIN}` }, H(portal))).status).toBe(200);
    }
  });
});
