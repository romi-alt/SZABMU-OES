import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, boot, type Ctx } from './helpers';
import { runImport, ImportInProgress } from '../src/directory/importer';
import { parseInstitutesText } from '../src/directory/parse-institutes';
import { verifyDataset } from '../src/directory/verify';
import { OUR_INSTITUTES_SNAPSHOT } from '../src/directory/snapshot-institutes';

/**
 * The institution & programme directory import. EXPECTED is a second, independent transcription of the supplied baseline (not generated from the
 * dataset module), so these tests check the dataset against the brief. "!" marks "NEW ADMISSIONS & INTAKE STOPPED"; M/E are morning/evening shifts.
 */
const EXPECTED: Record<string, string> = {
  'SZ-A01': 'BS_ANESTHESIA 25, BS_MLT 25, BS_VISION 25, BS_RADIOGRAPHY_IMAGING 25, BS_DENTAL_TECH 25, BS_CARDIOVASCULAR_SCIENCES 25',
  'SZ-A02': 'BSN_POST_RN 50, BSN_GENERIC 50', 'SZ-A03': 'MBBS 100', 'SZ-A04': '', 'SZ-A05': 'BDS 50', 'SZ-A06': 'BSN_GENERIC 50',
  'SZ-B01': '', 'SZ-B02': 'BS_MLT 30', 'SZ-B03': 'BSN_GENERIC 50', 'SZ-B04': 'PGD_SPEECH_LANGUAGE_THERAPY 25',
  'SZ-C01': 'DPT 25, BS_DENTAL_TECH 25, BS_MLT 25, BS_RADIOGRAPHY_IMAGING 25, BSN_GENERIC 50',
  'SZ-C02': 'BSN_GENERIC 50, DPT 25!', 'SZ-C03': 'BDS 50',
  'SZ-C04': 'DPT 25, BS_ANESTHESIA 25, BS_CARDIAC_PERFUSION 25, BS_DENTAL_TECH 25, BS_EMERGENCY_CLINICAL_MEDICINE 25, BS_MLT 25, BS_VISION 25, BS_RADIOGRAPHY_IMAGING 25, BS_SURGICAL_TECH 25, BSN_GENERIC 50, BSN_POST_RN 50',
  'SZ-C05': 'DPT 25, BSN_GENERIC 50', 'SZ-C06': 'BSN_GENERIC 50', 'SZ-C07': 'BSN_GENERIC 50',
  'SZ-C08': 'MBBS 150, BDS 75, DPT 25, BS_ANESTHESIA 25, BS_DENTAL_TECH 25, BS_MLT 25, BS_VISION 25, BS_RADIOGRAPHY_IMAGING 25, BSN_GENERIC M100 E100, BSN_POST_RN 50',
  'SZ-C09': 'DPT 25!', 'SZ-C10': 'MBBS 100, BDS 50, DPT 50, BSN_GENERIC 55, BS_MLT 25, BS_ANESTHESIA 25, BS_DENTAL_TECH 25, BS_RADIOGRAPHY_IMAGING 25, BSN_POST_RN 30',
  'SZ-C11': 'BSN_GENERIC 50', 'SZ-C12': 'DPT 25, BS_MLT 25, BSN_GENERIC 50, BSN_POST_RN 50!', 'SZ-C13': 'DPT 25, BSN_GENERIC 100, BS_MLT 25, BS_RADIOGRAPHY_IMAGING 25, BS_ANESTHESIA 25',
  'SZ-C14': 'BS_DENTAL_TECH 35', 'SZ-C15': 'BSN_GENERIC 40', 'SZ-C16': 'BSN_GENERIC 80, BSN_POST_RN 25, BS_MLT 25', 'SZ-C17': 'BSN_POST_RN 50, BSN_GENERIC 75, BS_MLT 25',
  'SZ-C18': 'DPT 25, BSN_GENERIC 50', 'SZ-C19': 'BS_ANESTHESIA 25, BS_MLT 25, BS_RADIOGRAPHY_IMAGING 25, BS_SURGICAL_TECH 25',
  'SZ-C20': 'MBBS 100, BDS 75, DPT 40, BSN_GENERIC M100 E100, BSN_POST_RN 40',
};
const parse = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean).map((x) => {
  const stop = x.endsWith('!'); const t = x.replace('!', '').split(/\s+/); const prog = t[0]!;
  const alloc = t.slice(1).map((a) => (/^M\d+$/.test(a) ? ['MORNING', Number(a.slice(1))] : /^E\d+$/.test(a) ? ['EVENING', Number(a.slice(1))] : ['UNSPECIFIED', Number(a)])) as [string, number][];
  return { prog, alloc, stop };
});

let ctx: Ctx; const ACTOR = 'test';
beforeAll(async () => { ctx = await boot({ studentsPerCampus: 3 }); });
afterAll(async () => { await ctx.app.close(); });
const snapshot = async () => ({
  institutions: await ctx.prisma.institution.count(), programs: await ctx.prisma.program.count(), offerings: await ctx.prisma.institutionProgramOffering.count(),
  allocations: await ctx.prisma.offeringAllocation.count(), claims: await ctx.prisma.directoryClaim.count(), sources: await ctx.prisma.directorySource.count(), docs: await ctx.prisma.curriculumDocument.count(),
  courses: await ctx.prisma.course.count(), students: await ctx.prisma.student.count(), roster: await ctx.prisma.rosterEntry.count(),
});

describe('the baseline agrees with the official page', () => {
  it('parses the committed snapshot into the 30 listed institutions and finds no difference from the dataset', () => {
    const page = parseInstitutesText(OUR_INSTITUTES_SNAPSHOT);
    expect(page).toHaveLength(30); expect(page.filter((p) => p.group === 'CONSTITUENT')).toHaveLength(6); expect(page.filter((p) => p.group === 'GOVERNMENT')).toHaveLength(4); expect(page.filter((p) => p.group === 'PRIVATE')).toHaveLength(20);
    expect(verifyDataset(page)).toEqual([]);
    const hbs = page.find((p) => p.name.startsWith('HBS'))!; expect(hbs.offerings.filter((o) => o.programKey === 'BSN_GENERIC').map((o) => [o.shift, o.seats])).toEqual([['MORNING', 100], ['EVENING', 100]]);
    expect(page.flatMap((p) => p.offerings).filter((o) => o.intakeStop)).toHaveLength(3);
    expect(page.flatMap((p) => p.offerings).every((o) => o.programKey !== null)).toBe(true);                               // every label on the page maps to a known programme
  });
  it('reports a difference when the dataset and the page disagree', () => {
    const page = parseInstitutesText(OUR_INSTITUTES_SNAPSHOT.replace('25 seats per annum', '26 seats per annum'));
    expect(verifyDataset(page).length).toBeGreaterThan(0);
  });
});

describe('dry run, apply, rerun', () => {
  it('a dry run reports the plan and writes nothing', async () => {
    const before = await snapshot();
    const r = await runImport(ctx.prisma, { mode: 'DRY_RUN', actor: ACTOR });
    expect(r.counts.institution).toMatchObject({ create: 34, reuse: 0 });                                                   // 30 baseline entries + 4 verified academic units
    expect(r.counts.program!.create).toBe(59); expect(r.counts.program!.update).toBe(1);                                    // MBBS is matched to the existing programme by its exact code
    expect(r.counts.offering!.create).toBe(98); expect(r.counts.allocation!.create).toBe(100);                              // 86 + 12 offerings; 88 + 12 allocation rows
    expect(r.ambiguous.join('\n')).toMatch(/Existing programme BSN .* BSN_GENERIC/);                                         // an existing nursing programme is NOT merged by name similarity
    expect(r.reviewExisting.join('\n')).toMatch(/Demo institution DMC-A/);
    expect(r.discrepancies.filter((d) => d.startsWith('Source check'))).toEqual([]);
    expect(await snapshot()).toEqual(before);                                                                              // nothing persisted
    expect((await ctx.prisma.directoryImportRun.findUniqueOrThrow({ where: { id: r.runId! } })).mode).toBe('DRY_RUN');
  });

  it('apply creates all 30 baseline institutions and every supplied offering, allocation and restriction, and records the run', async () => {
    const r = await runImport(ctx.prisma, { mode: 'APPLY', actor: ACTOR });
    const run = await ctx.prisma.directoryImportRun.findUniqueOrThrow({ where: { id: r.runId! } });
    expect(run).toMatchObject({ mode: 'APPLY', status: 'COMPLETED', actor: ACTOR, version: r.version }); expect(run.datasetSha256).toHaveLength(64); expect(run.finishedAt).toBeTruthy();
    const base = await ctx.prisma.institution.findMany({ where: { code: { startsWith: 'SZ-' }, kind: 'INSTITUTION' }, include: { offerings: { include: { program: true, allocations: true } } } });
    expect(base).toHaveLength(30); expect(base.filter((i) => i.affiliation === 'CONSTITUENT')).toHaveLength(6); expect(base.filter((i) => i.sector === 'PUBLIC')).toHaveLength(10); expect(base.filter((i) => i.sector === 'PRIVATE')).toHaveLength(20);
    expect(base.every((i) => i.directoryKey && i.sourceName && i.listingStatus === 'LISTED' && !i.isDemo && i.operationalStatus === 'UNKNOWN')).toBe(true);
    let offerings = 0; let allocations = 0;
    for (const [code, spec] of Object.entries(EXPECTED)) {
      const inst = base.find((i) => i.code === code)!; expect(inst, code).toBeTruthy(); const want = parse(spec);
      expect(inst.offerings.map((o) => o.program.directoryKey).sort(), code).toEqual(want.map((w) => w.prog).sort());
      for (const w of want) {
        const o = inst.offerings.find((x) => x.program.directoryKey === w.prog)!; offerings++;
        expect(o.allocations.map((a) => [a.shift, a.annualSeats]).sort(), `${code} ${w.prog}`).toEqual(w.alloc.slice().sort()); allocations += o.allocations.length;
        expect(o.intakeStatus, `${code} ${w.prog}`).toBe(w.stop ? 'STOPPED' : 'UNRESTRICTED'); expect(o.verificationStatus).toBe('VERIFIED'); expect(o.intakeStoppedFromBatchYear).toBeNull();   // effective date unknown: not invented
      }
    }
    expect([offerings, allocations]).toEqual([86, 88]);
    // institution-specific restrictions only
    const stopped = await ctx.prisma.institutionProgramOffering.findMany({ where: { intakeStatus: 'STOPPED', institution: { directoryKey: { not: null } } }, include: { institution: true, program: true } });
    expect(stopped.map((s) => `${s.institution.code}/${s.program.directoryKey}`).sort()).toEqual(['SZ-C02/DPT', 'SZ-C09/DPT', 'SZ-C12/BSN_POST_RN']);
    expect(await ctx.prisma.institutionProgramOffering.count({ where: { institution: { code: { in: ['SZ-C02', 'SZ-C12'] } }, intakeStatus: 'UNRESTRICTED' } })).toBe(4);   // the other offerings there stay open (Aman: Generic BSN; Kulsum: DPT, MLT, Generic BSN)
    // hospitals without a table get no programme; NIRM and IRS stay distinct
    expect(await ctx.prisma.institutionProgramOffering.count({ where: { institution: { code: { in: ['SZ-A04', 'SZ-B01'] } } } })).toBe(0);
    expect(await ctx.prisma.institution.count({ where: { code: { in: ['SZ-B04', 'SZ-U01'] } } })).toBe(2);
    // academic units carry unknown seats as NULL, which is not zero
    const irs = await ctx.prisma.offeringAllocation.findFirstOrThrow({ where: { offering: { institution: { code: 'SZ-U01' } } } }); expect(irs.annualSeats).toBeNull();
    const units = await ctx.prisma.institution.findMany({ where: { kind: 'ACADEMIC_UNIT' } }); expect(units).toHaveLength(4);
  });

  it('records programme facts, provenance and unresolved relationships without inventing anything', async () => {
    const p = async (k: string) => ctx.prisma.program.findUniqueOrThrow({ where: { directoryKey: k }, include: { aliases: true } });
    expect(await p('DPT')).toMatchObject({ durationMonths: 60, level: 'UNDERGRADUATE' }); expect(await p('BSN_GENERIC')).toMatchObject({ durationMonths: 48 }); expect(await p('BSN_POST_RN')).toMatchObject({ durationMonths: 24 });
    expect(await p('CHPE')).toMatchObject({ durationMonths: 6 }); expect(await p('MPHIL_PHYSIOLOGY')).toMatchObject({ durationMonths: 24 }); expect(await p('PHD_MOLECULAR_BIOLOGY')).toMatchObject({ durationMonths: 36 });
    expect((await p('BDS')).durationMonths).toBeNull(); expect((await p('BS_VISION')).durationMonths).toBeNull();                       // not established by a source
    expect((await p('BS_DENTAL_TECH')).aliases.map((a) => a.alias)).toEqual(['BS - Dental Hygiene Technology']);                        // source title kept, not merged
    expect(await p('BS_MOLECULAR_BIOLOGY_BIOTECH')).toMatchObject({ verificationStatus: 'NEEDS_VERIFICATION', catalogScope: 'UNIVERSITY_CATALOGUE' });
    const keys = (await ctx.prisma.program.findMany({ select: { directoryKey: true } })).map((x) => x.directoryKey ?? '');   // filtered in JS: SQL LIKE treats "_" as a wildcard
    expect(keys.filter((k) => /^MD_/.test(k))).toHaveLength(17); expect(keys.filter((k) => /^MS_/.test(k))).toHaveLength(11); expect(keys.filter((k) => /^MDS_/.test(k))).toHaveLength(5);
    expect(await ctx.prisma.institutionProgramOffering.count({ where: { program: { directoryKey: { in: keys.filter((k) => /^(MD|MS|MDS)_/.test(k)) } } } })).toBe(0);              // postgraduate catalogue is not attached to PIMS or anyone
    expect(await ctx.prisma.program.findUniqueOrThrow({ where: { code: 'BSN' } })).toMatchObject({ directoryKey: null, verificationStatus: 'LEGACY_UNVERIFIED' });
    // the stop claim has no effective date, and the court-order claim is session-specific and unresolved
    const stop = await ctx.prisma.directoryClaim.findFirstOrThrow({ where: { claimType: 'INTAKE_STOPPED', entityKey: 'aman-medical-institute/DPT' }, include: { source: true } }); expect(stop.effectiveFrom).toBeNull(); expect(stop.source.url).toBe('https://www.szabmu.edu.pk/our-institutes');
    const order = await ctx.prisma.directoryClaim.findFirstOrThrow({ where: { claimType: 'SESSION_ADMISSION_CONDITION' } }); expect(order).toMatchObject({ status: 'UNRESOLVED', sessionLabel: '2026-27', entityKey: 'bashir-college-of-dentistry' });
    const related = await ctx.prisma.directoryClaim.findMany({ where: { claimType: 'RELATED_NAME_UNRESOLVED' } }); expect(related).toHaveLength(3);
    expect(await ctx.prisma.institution.count({ where: { name: { contains: 'Nursing College' }, directoryKey: { not: null }, code: { in: ['SZ-C04', 'SZ-C10', 'SZ-C20'] } } })).toBe(0);   // no separate "nursing" institutions invented
    expect(await ctx.prisma.directoryClaim.count({ where: { claimType: 'HISTORICAL_LISTING_NOT_CURRENT' } })).toBe(2);
    expect(await ctx.prisma.directoryClaim.count({ where: { status: { not: 'VERIFIED' } } })).toBeGreaterThan(5);
  });

  it('no curriculum is fabricated: documents are located, but no course, subject or class is created', async () => {
    expect(await ctx.prisma.curriculumDocument.count()).toBe(49);
    expect(await ctx.prisma.curriculumDocument.count({ where: { program: { directoryKey: 'MBBS' } } })).toBe(2);                                      // years 1-2 and year 3 only
    expect(await ctx.prisma.curriculumDocument.count({ where: { program: { directoryKey: { in: ['BSN_GENERIC', 'BSN_POST_RN', 'BS_MLT', 'BS_ANESTHESIA'] } } } })).toBe(0);
    expect(await ctx.prisma.curriculumDocument.count({ where: { programId: null } })).toBe(6);                                              // listed on the page, not a programme in the catalogue
    expect(await ctx.prisma.course.count({ where: { isDemo: false } })).toBe(0);                                                            // the only courses are the synthetic demo ones
    expect(await ctx.prisma.course.count()).toBe(4);
  });

  it('a rerun creates nothing and changes nothing; existing users and demo records are untouched', async () => {
    const before = await snapshot(); const demo = await ctx.prisma.institution.findMany({ where: { isDemo: true }, select: { id: true, code: true, name: true } });
    const studs = await ctx.prisma.student.findMany({ select: { id: true, institutionId: true, programId: true } });
    const r = await runImport(ctx.prisma, { mode: 'APPLY', actor: ACTOR });
    for (const [e, c] of Object.entries(r.counts)) { expect(c.create, `${e} created again`).toBe(0); expect(c.update, `${e} updated again`).toBe(0); }
    expect(await snapshot()).toEqual(before);
    expect(await ctx.prisma.institution.findMany({ where: { isDemo: true }, select: { id: true, code: true, name: true } })).toEqual(demo);
    expect(await ctx.prisma.student.findMany({ select: { id: true, institutionId: true, programId: true } })).toEqual(studs);
    expect(demo.map((d) => d.code).sort()).toEqual(['DMC-A', 'DMC-B', 'DNC-C']); expect(demo.every((d) => /synthetic/.test(d.name))).toBe(true);        // not renamed into real institutions
  });

  it('two imports at the same moment cannot create duplicates', async () => {
    const before = await snapshot();
    const res = await Promise.allSettled([runImport(ctx.prisma, { mode: 'APPLY', actor: 'a' }), runImport(ctx.prisma, { mode: 'APPLY', actor: 'b' })]);
    expect(res.some((x) => x.status === 'fulfilled')).toBe(true);
    for (const x of res) if (x.status === 'rejected') expect(x.reason).toBeInstanceOf(ImportInProgress);
    expect(await snapshot()).toEqual(before);
  });

  it('an administrator’s edit is locked: a re-import reports it and does not overwrite it', async () => {
    const su = await as(ctx, 'super.admin'); const inst = await ctx.prisma.institution.findUniqueOrThrow({ where: { code: 'SZ-C14' } });
    expect((await su.patch(`/institutions/${inst.id}`, { city: 'Mirpur (corrected by hand)' })).status).toBe(200);
    expect((await ctx.prisma.institution.findUniqueOrThrow({ where: { id: inst.id } })).lockedFields).toEqual(['city']);
    const r = await runImport(ctx.prisma, { mode: 'APPLY', actor: ACTOR });
    expect((await ctx.prisma.institution.findUniqueOrThrow({ where: { id: inst.id } })).city).toBe('Mirpur (corrected by hand)');
    expect(r.discrepancies.join('\n')).toMatch(/mirpur-institute-of-medical-sciences: "city" was edited by an administrator and is kept/); expect(r.counts.institution!.preserved).toBe(1);
  });
});

describe('ambiguous matches are reported, never merged by name', () => {
  it('an existing institution with the same name blocks creation until an explicit link is given', async () => {
    const clash = await ctx.prisma.institution.create({ data: { code: 'OLD-FMC', name: 'Federal Medical College, Islamabad', type: 'MEDICAL_COLLEGE', affiliation: 'CONSTITUENT', city: 'Islamabad' } });
    await ctx.prisma.institution.delete({ where: { code: 'SZ-A03' } }).catch(async () => { await ctx.prisma.institutionProgramOffering.deleteMany({ where: { institution: { code: 'SZ-A03' } } }); await ctx.prisma.directoryClaim.deleteMany({ where: { entityKey: { startsWith: 'federal-medical-college-islamabad' } } }); await ctx.prisma.institution.delete({ where: { code: 'SZ-A03' } }); });
    const dry = await runImport(ctx.prisma, { mode: 'DRY_RUN', actor: ACTOR });
    expect(dry.ambiguous.join('\n')).toMatch(/federal-medical-college-islamabad: an existing institution has the same name \(OLD-FMC\)/);
    expect(await ctx.prisma.institution.count({ where: { directoryKey: 'federal-medical-college-islamabad' } })).toBe(0);                       // not created, not merged
    const linked = await runImport(ctx.prisma, { mode: 'APPLY', actor: ACTOR, link: { 'federal-medical-college-islamabad': 'OLD-FMC' } });
    expect(linked.ambiguous.join('\n')).not.toMatch(/federal-medical-college/);
    expect(await ctx.prisma.institution.findUniqueOrThrow({ where: { id: clash.id } })).toMatchObject({ directoryKey: 'federal-medical-college-islamabad', code: 'OLD-FMC' });   // the administrator's explicit decision, id preserved
  });
});
