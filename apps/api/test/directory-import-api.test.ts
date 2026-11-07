import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, as, boot, type Ctx } from './helpers';

/** Super administrators can check and apply the directory import from the browser: dry run first, then apply the exact dataset that was reviewed. */
let ctx: Ctx; let su: Client;
beforeAll(async () => { ctx = await boot({ studentsPerCampus: 2 }); su = await as(ctx, 'super.admin'); });
afterAll(async () => { await ctx.app.close(); });
const real = () => ctx.prisma.institution.count({ where: { code: { startsWith: 'SZ-' } } });

describe('POST /directory/import', () => {
  it('is for institution managers only', async () => {
    for (const who of ['admin.a', 'cce', 'lecturer.a', 'student.a001']) { const c = await as(ctx, who); expect((await c.post('/directory/import', { apply: false })).status, who).toBe(403); }
    expect((await new Client(ctx.app).post('/directory/import', { apply: false })).status).toBe(401);
  });
  it('a check reports what would change and writes nothing', async () => {
    const before = await real(); const r = await su.post('/directory/import', { apply: false }); expect(r.status, r.raw).toBe(200);
    expect(r.body.mode).toBe('DRY_RUN'); expect(r.body.datasetSha256).toMatch(/^[0-9a-f]{64}$/); expect(r.body.counts.institution.create).toBe(34); expect(r.body.counts.offering.create).toBe(98); expect(r.body.lines).toBeUndefined();
    expect(Array.isArray(r.body.discrepancies)).toBe(true); expect(Array.isArray(r.body.unresolved)).toBe(true);
    expect(await real()).toBe(before); expect(before).toBe(0); expect(await ctx.prisma.directoryImportRun.count({ where: { mode: 'APPLY' } })).toBe(0);
  });
  it('applying must name the dataset that was checked, and refuses anything else', async () => {
    expect((await su.post('/directory/import', { apply: true })).status).toBe(400);
    expect((await su.post('/directory/import', { apply: true, datasetSha256: 'a'.repeat(64) })).status).toBe(409);
    expect(await real()).toBe(0);
  });
  it('applies the reviewed dataset, is audited, and a second run changes nothing', async () => {
    const sha = (await su.post('/directory/import', { apply: false })).body.datasetSha256;
    const r = await su.post('/directory/import', { apply: true, datasetSha256: sha }); expect(r.status, r.raw).toBe(200);
    expect(r.body.mode).toBe('APPLY'); expect(r.body.runId).toBeTruthy(); expect(await real()).toBe(34);
    const log = await ctx.prisma.auditLog.findFirstOrThrow({ where: { action: 'directory.import' } }); expect((log.meta as any).runId).toBe(r.body.runId); expect((log.meta as any).mode).toBe('APPLY');
    const again = await su.post('/directory/import', { apply: true, datasetSha256: sha }); expect(again.status).toBe(200); expect(again.body.counts.institution.create).toBe(0); expect(again.body.counts.institution.reuse).toBe(34); expect(await real()).toBe(34);
  });
});
