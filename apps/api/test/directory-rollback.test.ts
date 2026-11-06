import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, type Ctx } from './helpers';
import { runImport } from '../src/directory/importer';
import { rollbackRun } from '../src/directory/rollback';

/** Rolling back an import keeps everything created after it: dependents delist an entity instead of deleting it. */
let ctx: Ctx;
beforeAll(async () => { ctx = await boot({ studentsPerCampus: 3 }); });
afterAll(async () => { await ctx.app.close(); });

describe('import rollback', () => {
  it('removes what the import created, restores what it changed, and preserves every record added afterwards', async () => {
    const demoBefore = await ctx.prisma.institution.findMany({ where: { isDemo: true }, orderBy: { code: 'asc' } });
    const mbbsBefore = await ctx.prisma.program.findUniqueOrThrow({ where: { code: 'MBBS' } });
    const run = await runImport(ctx.prisma, { mode: 'APPLY', actor: 'test' });
    const importedInstitutions = await ctx.prisma.institution.count({ where: { directoryKey: { not: null } } }); expect(importedInstitutions).toBe(34);

    // records created AFTER the import
    const hbs = await ctx.prisma.institution.findUniqueOrThrow({ where: { code: 'SZ-C08' } }); const mbbs = await ctx.prisma.program.findUniqueOrThrow({ where: { code: 'MBBS' } });
    const user = await ctx.prisma.user.create({ data: { email: 'after.import@example.test', fullName: 'Added After Import', role: 'STUDENT', passwordHash: 'x', institutions: { create: [{ institutionId: hbs.id }] } } });
    const student = await ctx.prisma.student.create({ data: { userId: user.id, institutionId: hbs.id, programId: mbbs.id, regNo: 'HBS-2026-0001', semester: 1, batchYear: 2026 } });
    const c13 = await ctx.prisma.institution.findUniqueOrThrow({ where: { code: 'SZ-C13' } }); const dpt = await ctx.prisma.program.findUniqueOrThrow({ where: { directoryKey: 'DPT' } });
    const roster = await ctx.prisma.rosterEntry.create({ data: { institutionId: c13.id, programId: dpt.id, regNo: 'MID-DPT-0001', fullName: 'Register Row', dateOfBirth: new Date('2004-01-01'), semester: 2, batchYear: 2025 } });
    const staff = await ctx.prisma.user.create({ data: { email: 'staff.after@example.test', fullName: 'Staff After', role: 'CAMPUS_ADMIN', passwordHash: 'x', institutions: { create: [{ institutionId: (await ctx.prisma.institution.findUniqueOrThrow({ where: { code: 'SZ-C20' } })).id }] } } });
    await ctx.prisma.program.update({ where: { id: mbbs.id }, data: { verificationStatus: 'NEEDS_VERIFICATION' } });              // a later manual decision

    const report = await rollbackRun(ctx.prisma, run.runId!, { apply: false, actor: 'test' });
    expect(report.apply).toBe(false); expect(await ctx.prisma.institution.count({ where: { directoryKey: { not: null } } })).toBe(34);       // report only
    const done = await rollbackRun(ctx.prisma, run.runId!, { apply: true, actor: 'test' });

    // survivors: every record added after the import, with ids and links intact
    expect(await ctx.prisma.student.findUniqueOrThrow({ where: { id: student.id } })).toMatchObject({ institutionId: hbs.id, programId: mbbs.id, regNo: 'HBS-2026-0001' });
    expect(await ctx.prisma.rosterEntry.findUniqueOrThrow({ where: { id: roster.id } })).toMatchObject({ institutionId: c13.id, programId: dpt.id });
    expect(await ctx.prisma.user.findUniqueOrThrow({ where: { id: staff.id } })).toBeTruthy();
    expect(await ctx.prisma.userInstitution.count({ where: { userId: { in: [user.id, staff.id] } } })).toBe(2);
    // the institutions they depend on are kept and delisted, not deleted
    for (const code of ['SZ-C08', 'SZ-C13', 'SZ-C20']) expect((await ctx.prisma.institution.findUniqueOrThrow({ where: { code } })).listingStatus, code).toBe('HIDDEN');
    expect((await ctx.prisma.institutionProgramOffering.findUniqueOrThrow({ where: { institutionId_programId: { institutionId: hbs.id, programId: mbbs.id } } })).verificationStatus).toBe('UNLISTED');
    expect((await ctx.prisma.institutionProgramOffering.findUniqueOrThrow({ where: { institutionId_programId: { institutionId: c13.id, programId: dpt.id } } })).verificationStatus).toBe('UNLISTED');
    expect(done.delisted.join('\n')).toMatch(/institution .*SZ-C08/);
    // the rest of the import is gone
    expect(await ctx.prisma.institution.count({ where: { directoryKey: { not: null } } })).toBe(3 + 0);                                  // exactly the three delisted ones remain
    expect(await ctx.prisma.institution.count({ where: { code: 'SZ-C01' } })).toBe(0);
    expect(await ctx.prisma.institutionProgramOffering.count({ where: { institution: { isDemo: false } } })).toBe(2);                    // only the two with dependents
    expect(await ctx.prisma.directoryClaim.count()).toBe(0); expect(await ctx.prisma.curriculumDocument.count()).toBe(0);
    // what the import changed on existing data is restored, except a later manual change
    const mbbsNow = await ctx.prisma.program.findUniqueOrThrow({ where: { id: mbbs.id } });
    expect(mbbsNow).toMatchObject({ directoryKey: null, name: mbbsBefore.name, verificationStatus: 'NEEDS_VERIFICATION' });                       // key restored; the manual status kept
    expect(done.keptEdited.join('\n')).toMatch(/verificationStatus was changed after the import and is kept/);
    const keptPrograms = await ctx.prisma.program.findMany({ where: { directoryKey: { not: null } } });                                          // only DPT: the register row added after the import uses it
    expect(keptPrograms.map((x) => [x.directoryKey, x.verificationStatus])).toEqual([['DPT', 'UNLISTED']]);
    // demo data is untouched throughout
    expect(await ctx.prisma.institution.findMany({ where: { isDemo: true }, orderBy: { code: 'asc' } })).toEqual(demoBefore);
    expect((await ctx.prisma.directoryImportRun.findMany({ where: { mode: 'ROLLBACK' } })).map((r) => r.status)).toEqual(['COMPLETED', 'COMPLETED']);
  });

  it('only an applied run can be rolled back', async () => {
    const dry = await runImport(ctx.prisma, { mode: 'DRY_RUN', actor: 'test' });
    await expect(rollbackRun(ctx.prisma, dry.runId!, { apply: true, actor: 'test' })).rejects.toThrow(/Only an applied import run/);
  });
});
