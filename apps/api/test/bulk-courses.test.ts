import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, as, boot, type Ctx } from './helpers';
import { runImport } from '../src/directory/importer';

/** Bulk-adding a programme's subjects (curriculum entry): preview first, nothing invented, duplicates skipped, audited, and teachers then see the subjects. */
let ctx: Ctx; let su: Client; let progId: string; let progCode: string;
beforeAll(async () => {
  ctx = await boot({ studentsPerCampus: 2 }); await runImport(ctx.prisma, { mode: 'APPLY', actor: 'test' }); su = await as(ctx, 'super.admin');
  const p = await ctx.prisma.program.findFirstOrThrow({ where: { directoryKey: 'BS_MLT' } }); progId = p.id; progCode = p.code;
});
afterAll(async () => { await ctx.app.close(); });
const rows = [{ semester: 1, title: 'Anatomy' }, { semester: 1, title: 'Physiology', code: 'MLT-PHY-101', credits: 4 }, { semester: 2, title: 'Biochemistry' }];
const bulk = (c: Client, body: unknown, id = progId) => c.post(`/programs/${id}/courses/bulk`, body);

describe('POST /programs/:id/courses/bulk', () => {
  it('is for the roles that manage programmes (super administrator, Controller of Examinations) only', async () => {
    for (const who of ['admin.a', 'lecturer.a', 'examiner', 'student.a001']) expect((await bulk(await as(ctx, who), { rows, dryRun: true })).status, who).toBe(403);
    expect((await bulk(await as(ctx, 'cce'), { rows, dryRun: true })).status).toBe(200);        // the Controller of Examinations also manages programmes
    expect((await bulk(new Client(ctx.app), { rows, dryRun: true })).status).toBe(401);
  });
  it('a preview says what would be added and writes nothing', async () => {
    const before = await ctx.prisma.course.count({ where: { programId: progId } });
    const r = await bulk(su, { rows, dryRun: true }); expect(r.status, r.raw).toBe(200);
    expect(r.body).toMatchObject({ dryRun: true, created: 0, wouldCreate: 3, skipped: [] }); expect(r.body.preview.map((p: any) => p.title)).toEqual(['Anatomy', 'Physiology', 'Biochemistry']);
    expect(await ctx.prisma.course.count({ where: { programId: progId } })).toBe(before);
  });
  it('adds the subjects: supplied codes and credits are kept, missing ones are marked, not invented; audited', async () => {
    const r = await bulk(su, { rows, dryRun: false }); expect(r.status, r.raw).toBe(200); expect(r.body.created).toBe(3);
    const made = await ctx.prisma.course.findMany({ where: { programId: progId }, orderBy: [{ semester: 'asc' }, { title: 'asc' }] });
    const by = (t: string) => made.find((c) => c.title === t)!;
    expect(by('Physiology')).toMatchObject({ code: 'MLT-PHY-101', credits: 4, semester: 1, isDemo: false });
    expect(by('Anatomy').code).toMatch(new RegExp(`^${progCode}-S1-\\d{2}$`)); expect(by('Anatomy').credits).toBe(0);      // an internal reference and "credits not recorded", never a made-up 3
    expect(by('Biochemistry').semester).toBe(2);
    const log = await ctx.prisma.auditLog.findFirstOrThrow({ where: { action: 'course.bulk_create' } }); expect((log.meta as any).count).toBe(3); expect((log.meta as any).programId).toBe(progId);
  });
  it('running it again skips what already exists; a taken code is reported, not overwritten', async () => {
    const again = await bulk(su, { rows, dryRun: false }); expect(again.status).toBe(200); expect(again.body.created).toBe(0); expect(again.body.skipped.map((s: any) => s.reason)).toEqual(['ALREADY_EXISTS', 'ALREADY_EXISTS', 'ALREADY_EXISTS']);
    const clash = await bulk(su, { rows: [{ semester: 3, title: 'Immunology', code: 'MLT-PHY-101' }], dryRun: false }); expect(clash.status).toBe(200); expect(clash.body.created).toBe(0); expect(clash.body.skipped[0].reason).toBe('CODE_TAKEN');
  });
  it('rejects bad input without writing: semester range, empty title, too many rows, a repeat inside the list, an unknown programme', async () => {
    const n = await ctx.prisma.course.count();
    for (const bad of [{ rows: [{ semester: 13, title: 'X1' }] }, { rows: [{ semester: 1, title: ' ' }] }, { rows: [] }, { rows: Array.from({ length: 201 }, (_, i) => ({ semester: 1, title: `Subject ${i}` })) }]) expect((await bulk(su, { ...bad, dryRun: false })).status).toBe(400);
    const dup = await bulk(su, { rows: [{ semester: 4, title: 'Pathology' }, { semester: 4, title: 'pathology' }], dryRun: false }); expect(dup.status).toBe(200); expect(dup.body.created).toBe(1); expect(dup.body.skipped[0].reason).toBe('REPEATED_IN_LIST');
    expect((await bulk(su, { rows, dryRun: true }, '00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect(await ctx.prisma.course.count()).toBe(n + 1);
  });
  it('the subjects reach teachers: the registration catalog lists them for the programme', async () => {
    const t = (await new Client(ctx.app).get('/teacher-registration/catalog')).body;
    expect(t.courses.filter((c: any) => c.programId === progId).map((c: any) => c.title)).toEqual(expect.arrayContaining(['Anatomy', 'Physiology', 'Biochemistry']));
  });
});
