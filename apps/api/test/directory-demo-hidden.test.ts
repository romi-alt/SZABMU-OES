import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, as, boot, type Ctx } from './helpers';
import { runImport } from '../src/directory/importer';

/** A real site: DEMO_INSTITUTIONS_VISIBLE unset. Synthetic institutions stay in the database (ids intact) but are out of selection and production totals. */
process.env.DEMO_INSTITUTIONS_VISIBLE = 'false';
let ctx: Ctx; let su: Client; let seq = 0; const PW = 'Sturdy-Pass-2026!x';
beforeAll(async () => { ctx = await boot({ studentsPerCampus: 4 }); await runImport(ctx.prisma, { mode: 'APPLY', actor: 'test' }); su = await as(ctx, 'super.admin'); });
afterAll(async () => { await ctx.app.close(); process.env.DEMO_INSTITUTIONS_VISIBLE = 'true'; });
const inst = (code: string) => ctx.prisma.institution.findUniqueOrThrow({ where: { code } });

describe('demo institutions on a real site', () => {
  it('keeps the records but hides them from the default list; an authorised filter still reaches them', async () => {
    expect(await ctx.prisma.institution.count({ where: { isDemo: true } })).toBe(3);
    const def = (await su.get('/directory/institutions?pageSize=100')).body; expect(def.items.some((x: any) => x.isDemo)).toBe(false); expect(def.total).toBe(34);
    const only = (await su.get('/directory/institutions?demo=only')).body; expect(only.items.map((x: any) => x.code).sort()).toEqual(['DMC-A', 'DMC-B', 'DNC-C']);
    expect((await su.get('/directory/institutions?pageSize=100&demo=include')).body.total).toBe(37);
    expect((await su.get(`/directory/institutions/${(await inst('DMC-A')).id}`)).status).toBe(200);
    expect((await su.get('/directory/facets')).body.canViewDemo).toBe(true);
  });
  it('removes demo institutions from student and teacher selection and refuses registration there', async () => {
    const n = ++seq; await ctx.kv.clearPrefix('rl:');
    const s = await new Client(ctx.app).post('/auth/register', { regNo: `HID-${n}`, email: `hid${n}@example.test`, password: PW }); expect(s.status, s.raw).toBe(200);
    const c = new Client(ctx.app); const v = await c.req('POST', '/auth/register/verify', { email: `hid${n}@example.test`, code: s.body.devCode }); expect(v.status).toBe(200);
    const sc = v.headers['set-cookie']; c.cookie = String(Array.isArray(sc) ? sc[0] : sc).split(';')[0]!;
    const cat = (await c.get('/onboarding/catalog')).body; const codes = cat.institutions.map((i: any) => i.code);
    expect(codes).toContain('SZ-C08'); for (const d of ['DMC-A', 'DMC-B', 'DNC-C']) expect(codes).not.toContain(d);
    const demo = await inst('DMC-A'); const mbbs = await ctx.prisma.program.findFirstOrThrow({ where: { code: 'MBBS' } });
    const r = await c.post('/onboarding/complete', { fullName: 'Amna Test Student', fatherName: 'Tariq Test', gender: 'FEMALE', institutionId: demo.id, programId: mbbs.id, semester: 4, batchYear: 2025, mobile: '+92 300 1234567' });
    expect(r.status).toBe(400); expect(r.body.code).toBe('INSTITUTION_NOT_LISTED');
    const tc = (await new Client(ctx.app).get('/teacher-registration/catalog')).body;
    for (const d of ['DMC-A', 'DMC-B', 'DNC-C']) expect(tc.institutions.map((i: any) => i.code)).not.toContain(d);
    expect(tc.courses.filter((x: any) => /^(MBBS|BDS|BSN)-/.test(x.code) && x.isDemo).length).toBe(0);
  });
  it('leaves demo institutions out of the production dashboard totals', async () => {
    const d = (await su.get('/dashboard')).body; expect(d.institutions).toBe(30);
    expect(d.students).toBe(await ctx.prisma.student.count({ where: { institution: { isDemo: false } } }));
    expect(d.students).toBe(0);
  });
});
