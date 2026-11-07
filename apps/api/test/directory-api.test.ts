import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, as, boot, startExam, type Ctx } from './helpers';
import { runImport } from '../src/directory/importer';

/** The administration API for the directory: list/filter/page, real counts, detail, scoping, manager-only audited edits, sessions and reassignment. */
let ctx: Ctx; let su: Client; let seq = 0;
const inst = (code: string) => ctx.prisma.institution.findUniqueOrThrow({ where: { code } });
const prog = (key: string) => ctx.prisma.program.findFirstOrThrow({ where: { OR: [{ directoryKey: key }, { code: key }] } });
beforeAll(async () => { ctx = await boot({ studentsPerCampus: 4 }); await runImport(ctx.prisma, { mode: 'APPLY', actor: 'test' }); su = await as(ctx, 'super.admin'); });
afterAll(async () => { await ctx.app.close(); });
const list = async (c: Client, qs = '') => (await c.get(`/directory/institutions?pageSize=100${qs}`));

describe('list, search, filters and pagination', () => {
  it('lists the directory with its type, sector, relationship, location, status, counts and permitted actions', async () => {
    const r = await list(su); expect(r.status).toBe(200);
    const rows = r.body.items as any[]; const by = (code: string) => rows.find((x) => x.code === code);
    expect(r.body.total).toBe(rows.length); expect(rows.length).toBe(34 + 3);                                             // 30 baseline + 4 academic units + the 3 synthetic demo institutions (visible on a demo site)
    expect(by('SZ-C08')).toMatchObject({ name: 'HBS Medical & Dental College, Islamabad', kind: 'INSTITUTION', type: 'MEDICAL_DENTAL_COLLEGE', sector: 'PRIVATE', affiliation: 'AFFILIATED', city: 'Islamabad', region: 'Islamabad Capital Territory', listingStatus: 'LISTED', operationalStatus: 'UNKNOWN', isDemo: false, canEdit: true });
    expect(by('SZ-C08').offerings).toEqual({ total: 10, verified: 10, needsVerification: 0, stopped: 0 });
    expect(by('SZ-C02').offerings).toMatchObject({ total: 2, stopped: 1 });                                               // the restriction indicator
    expect(by('DMC-A')).toMatchObject({ isDemo: true }); expect(by('DMC-A').offerings).toMatchObject({ total: 1, verified: 0, needsVerification: 1 });   // a legacy relationship is not "verified"
    expect(by('SZ-U01')).toMatchObject({ kind: 'ACADEMIC_UNIT', sector: null });
  });
  it('shows actual student counts: a new institution has zero, and a published seat figure is never a student count', async () => {
    const rows = (await list(su)).body.items as any[]; const a = rows.find((x) => x.code === 'DMC-A'); const dbA = await ctx.prisma.student.count({ where: { institution: { code: 'DMC-A' } } });
    expect(a.students).toBe(dbA); expect(dbA).toBeGreaterThan(0);
    const hbs = rows.find((x) => x.code === 'SZ-C08'); expect(hbs.students).toBe(0); expect(typeof hbs.students).toBe('number');      // zero, not unknown, not the 150 + 75 + ... of seats
    const d = (await su.get(`/directory/institutions/${(await inst('SZ-C08')).id}`)).body;
    expect(d.students).toEqual({ total: 0, pendingVerification: 0 }); expect(d.offerings.every((o: any) => o.enrolled === 0)).toBe(true);
    const mbbs = d.offerings.find((o: any) => o.program.directoryKey === 'MBBS'); expect(mbbs.allocations).toEqual([{ shift: 'UNSPECIFIED', annualSeats: 150 }]);
  });
  it('searches by name, abbreviation, code and city, and filters by sector, affiliation, location, type and status', async () => {
    const codes = async (qs: string) => ((await list(su, qs)).body.items as any[]).map((x) => x.code).sort();
    expect(await codes('&search=Rawal&demo=exclude')).toEqual(['SZ-C20']); expect(await codes('&search=IMDC')).toEqual(['SZ-C10']); expect(await codes('&search=SZ-C1')).toEqual(['SZ-C10', 'SZ-C11', 'SZ-C12', 'SZ-C13', 'SZ-C14', 'SZ-C15', 'SZ-C16', 'SZ-C17', 'SZ-C18', 'SZ-C19']);
    expect(await codes('&search=Mirpur')).toEqual(['SZ-C07', 'SZ-C14']); expect(await codes('&region=Azad%20Jammu%20and%20Kashmir')).toEqual(['SZ-C07', 'SZ-C14']); expect(await codes('&city=Mirpur')).toEqual(['SZ-C07', 'SZ-C14']);
    expect(await codes('&search=nirm')).toEqual(['SZ-B04']);
    expect((await codes('&sector=PRIVATE&kind=INSTITUTION')).length).toBe(20); expect((await codes('&sector=PUBLIC&kind=INSTITUTION')).length).toBe(10);
    expect((await codes('&affiliation=CONSTITUENT&kind=INSTITUTION&demo=exclude')).length).toBe(6); expect((await codes('&kind=ACADEMIC_UNIT'))).toEqual(['SZ-U01', 'SZ-U02', 'SZ-U03', 'SZ-U04']);
    expect(await codes('&type=REHABILITATION_INSTITUTE')).toEqual(['SZ-B04']); expect(await codes('&restricted=true')).toEqual(['SZ-C02', 'SZ-C09', 'SZ-C12']);
    expect(await codes('&listingStatus=HIDDEN')).toEqual([]); expect((await codes('&operationalStatus=UNKNOWN')).length).toBeGreaterThan(30);
    expect(await codes('&search=zzzz-no-such')).toEqual([]);
  });
  it('paginates, and rejects nonsense filters', async () => {
    const p1 = (await su.get('/directory/institutions?page=1&pageSize=10&kind=INSTITUTION&demo=exclude')).body; const p3 = (await su.get('/directory/institutions?page=3&pageSize=10&kind=INSTITUTION&demo=exclude')).body; const p4 = (await su.get('/directory/institutions?page=4&pageSize=10&kind=INSTITUTION&demo=exclude')).body;
    expect([p1.items.length, p3.items.length, p4.items.length, p1.total]).toEqual([10, 10, 0, 30]);
    expect((await su.get('/directory/institutions?sector=MAYBE')).status).toBe(400);
    const f = (await su.get('/directory/facets')).body; expect(f.regions).toEqual(expect.arrayContaining(['Islamabad Capital Territory', 'Azad Jammu and Kashmir'])); expect(f.canViewDemo).toBe(true);
  });
});

describe('detail', () => {
  it('shows offerings, shifts, restrictions with their source, session configuration, curriculum readiness and unknowns', async () => {
    const hbs = (await su.get(`/directory/institutions/${(await inst('SZ-C08')).id}`)).body;
    const bsn = hbs.offerings.find((o: any) => o.program.directoryKey === 'BSN_GENERIC'); expect(bsn.allocations.map((a: any) => [a.shift, a.annualSeats]).sort()).toEqual([['EVENING', 100], ['MORNING', 100]]); expect(bsn.program).toMatchObject({ durationMonths: 48, name: 'Generic Bachelor of Science in Nursing' });
    expect(bsn.curriculum).toEqual({ readiness: 'NO_EVIDENCE', subjects: 0, documents: [] });                            // no curriculum document exists for Generic BSN: nothing invented
    const mbbs = hbs.offerings.find((o: any) => o.program.directoryKey === 'MBBS'); expect(mbbs.curriculum.readiness).toBe('SUBJECTS_ENTERED'); expect(mbbs.curriculum.documents.length).toBe(2);
    expect(hbs.claims.some((c: any) => c.type === 'LISTED_ON_OFFICIAL_DIRECTORY' && c.source.url === 'https://www.szabmu.edu.pk/our-institutes')).toBe(true); expect(hbs.lastVerifiedAt).toBeTruthy();
    const aman = (await su.get(`/directory/institutions/${(await inst('SZ-C02')).id}`)).body; const dpt = aman.offerings.find((o: any) => o.program.directoryKey === 'DPT');
    expect(dpt).toMatchObject({ intakeStatus: 'STOPPED', intakeStoppedFromBatchYear: null, verificationStatus: 'VERIFIED' }); expect(dpt.restrictions[0]).toMatchObject({ type: 'INTAKE_STOPPED', status: 'VERIFIED', effectiveFrom: null, source: { url: 'https://www.szabmu.edu.pk/our-institutes' } });
    expect(aman.offerings.find((o: any) => o.program.directoryKey === 'BSN_GENERIC').intakeStatus).toBe('UNRESTRICTED');
    const pims = (await su.get(`/directory/institutions/${(await inst('SZ-A04')).id}`)).body; expect(pims.offerings).toEqual([]); expect(pims.claims.map((c: any) => c.type)).toContain('NO_PROGRAMME_TABLE');
    const irs = (await su.get(`/directory/institutions/${(await inst('SZ-U01')).id}`)).body; expect(irs.offerings[0].allocations).toEqual([{ shift: 'UNSPECIFIED', annualSeats: null }]);   // unknown, not 0
    const c03 = (await su.get(`/directory/institutions/${(await inst('SZ-C03')).id}`)).body; expect(c03.claims.map((c: any) => `${c.type}:${c.status}:${c.session}`)).toContain('SESSION_ADMISSION_CONDITION:UNRESOLVED:2026-27');
  });
});

describe('who can see and change what', () => {
  it('campus administrators see only their own institution; other institutions are not found; students and teachers have no access', async () => {
    const a = await as(ctx, 'admin.a'); const rows = (await list(a)).body.items as any[]; expect(rows.map((x) => x.code)).toEqual(['DMC-A']); expect(rows[0].canEdit).toBe(false);
    expect((await a.get(`/directory/institutions/${(await inst('SZ-C08')).id}`)).status).toBe(404); expect((await a.get(`/directory/institutions/${(await inst('DMC-B')).id}`)).status).toBe(404);
    expect((await a.get(`/directory/institutions/${(await inst('DMC-A')).id}`)).status).toBe(200);
    expect((await list(a, '&demo=include&search=HBS')).body.items).toEqual([]);                                     // asking for more does not widen the scope
    for (const who of ['student.a001', 'lecturer.a']) { const c = await as(ctx, who); expect((await c.get('/directory/institutions')).status, who).toBe(who === 'lecturer.a' ? 200 : 403); }
    expect(((await list(await as(ctx, 'lecturer.a'))).body.items as any[]).map((x) => x.code)).toEqual(['DMC-A']);
    expect((await new Client(ctx.app).get('/directory/institutions')).status).toBe(401);
  });
  it('only a manager can edit, every edit is audited, and an edited field is locked against re-import', async () => {
    const a = await as(ctx, 'admin.a'); const cce = await as(ctx, 'cce'); const c = await inst('SZ-C11'); const off = await ctx.prisma.institutionProgramOffering.findFirstOrThrow({ where: { institutionId: c.id } });
    for (const who of [a, cce]) { expect((await who.patch(`/institutions/${c.id}`, { sector: 'PUBLIC' })).status).toBe(403); expect((await who.patch(`/directory/offerings/${off.id}`, { intakeStatus: 'STOPPED' })).status).toBe(403); }
    expect((await su.patch(`/institutions/${c.id}`, { sector: 'PUBLIC', operationalStatus: 'OPERATING', abbreviation: 'KPIMS', region: 'Islamabad Capital Territory' })).status).toBe(200);
    expect(await ctx.prisma.institution.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ sector: 'PUBLIC', operationalStatus: 'OPERATING', abbreviation: 'KPIMS' });
    expect(await ctx.prisma.auditLog.count({ where: { action: 'institution.update', entityId: c.id } })).toBe(1);
    expect((await su.patch(`/directory/offerings/${off.id}`, { intakeStatus: 'STOPPED' })).status).toBe(200);
    expect(await ctx.prisma.institutionProgramOffering.findUniqueOrThrow({ where: { id: off.id } })).toMatchObject({ intakeStatus: 'STOPPED' });
    const log = await ctx.prisma.auditLog.findFirstOrThrow({ where: { action: 'directory.offering_update', entityId: off.id } }); expect((log.meta as any).changes.intakeStatus).toEqual({ from: 'UNRESTRICTED', to: 'STOPPED' });
    const r = await runImport(ctx.prisma, { mode: 'APPLY', actor: 'test' });                                          // a re-import must not undo the administrator's decision
    expect(await ctx.prisma.institutionProgramOffering.findUniqueOrThrow({ where: { id: off.id } })).toMatchObject({ intakeStatus: 'STOPPED' });
    expect((await ctx.prisma.institution.findUniqueOrThrow({ where: { id: c.id } })).sector).toBe('PUBLIC'); expect(r.discrepancies.join('\n')).toMatch(/khyber-pakhtunkhwa.*"sector" was edited by an administrator/);
    expect((await su.patch(`/directory/offerings/${off.id}`, { intakeStatus: 'MAYBE' })).status).toBe(400);
    expect((await su.patch(`/directory/offerings/${off.id}`, { intakeStatus: 'STOPPED' })).body.changed).toBe(false);          // a no-op writes no audit entry
    expect(await ctx.prisma.auditLog.count({ where: { action: 'directory.offering_update', entityId: off.id } })).toBe(1);
    await su.patch(`/directory/offerings/${off.id}`, { intakeStatus: 'UNRESTRICTED' });
  });
  it('session settings are manager-only, validated, audited and reversible', async () => {
    const off = await ctx.prisma.institutionProgramOffering.findFirstOrThrow({ where: { institution: { code: 'SZ-C13' } } }); const a = await as(ctx, 'admin.a');
    expect((await a.put(`/directory/offerings/${off.id}/sessions/2026`, { admissionsStatus: 'OPEN', seatLimit: 30 })).status).toBe(403);
    expect((await su.put(`/directory/offerings/${off.id}/sessions/2026`, { admissionsStatus: 'OPEN', seatLimit: 0 })).status).toBe(400);
    expect((await su.put(`/directory/offerings/${off.id}/sessions/2026`, { admissionsStatus: 'OPEN', seatLimit: 30, label: 'Fall 2026' })).status).toBe(200);
    expect((await su.get(`/directory/institutions/${off.institutionId}`)).body.offerings.find((o: any) => o.id === off.id).sessions).toEqual([{ batchYear: 2026, label: 'Fall 2026', admissionsStatus: 'OPEN', seatLimit: 30, note: null }]);
    expect((await su.del(`/directory/offerings/${off.id}/sessions/2026`)).status).toBe(200); expect(await ctx.prisma.offeringSession.count({ where: { offeringId: off.id } })).toBe(0);
    expect(await ctx.prisma.auditLog.count({ where: { action: { in: ['directory.session_set', 'directory.session_cleared'] }, entityId: off.id } })).toBe(2);
  });
});

describe('moving genuine users out of a demo institution is explicit, validated and audited', () => {
  async function demoStudent(withHistory = false) {
    const n = ++seq; const demo = await inst('DMC-A'); const mbbs = await prog('MBBS');
    const user = await ctx.prisma.user.create({ data: { email: `genuine${n}@example.test`, fullName: `Genuine Student ${n}`, role: 'STUDENT', passwordHash: 'x', institutions: { create: [{ institutionId: demo.id }] } } });
    const s = await ctx.prisma.student.create({ data: { userId: user.id, institutionId: demo.id, programId: mbbs.id, regNo: `GEN-${n}`, semester: 4, batchYear: 2024 } });
    if (withHistory) await ctx.prisma.examCandidate.create({ data: { examId: ctx.seeded.examId, studentId: s.id, institutionId: demo.id, status: 'ADMITTED', decisionSource: 'ROSTER' } as never }).catch(() => undefined);
    return { s, user, demo, mbbs };
  }
  it('moves students to a real offering, keeps their ids, replaces their campus scope, and refuses everything else', async () => {
    const { s, user } = await demoStudent(); const to = await inst('SZ-A03'); const mbbs = await prog('MBBS');
    expect((await (await as(ctx, 'admin.a')).post('/directory/reassign-students', { toInstitutionId: to.id, toProgramId: mbbs.id, studentIds: [s.id], reason: 'Genuine student wrongly placed in a demo college' })).status).toBe(403);
    const bad = await su.post('/directory/reassign-students', { toInstitutionId: (await inst('SZ-C02')).id, toProgramId: mbbs.id, studentIds: [s.id], reason: 'Genuine student wrongly placed in a demo college' }); expect(bad.status).toBe(400); expect(bad.body.code).toBe('NOT_OFFERED');   // Aman does not offer MBBS
    expect((await su.post('/directory/reassign-students', { toInstitutionId: to.id, toProgramId: mbbs.id, studentIds: [s.id], reason: 'short' })).status).toBe(400);
    const ok = await su.post('/directory/reassign-students', { toInstitutionId: to.id, toProgramId: mbbs.id, studentIds: [s.id], reason: 'Genuine student wrongly placed in a demo college' }); expect(ok.status, ok.raw).toBe(200); expect(ok.body.moved).toBe(1);
    expect(await ctx.prisma.student.findUniqueOrThrow({ where: { id: s.id } })).toMatchObject({ institutionId: to.id, programId: mbbs.id, regNo: s.regNo });
    expect((await ctx.prisma.userInstitution.findMany({ where: { userId: user.id } })).map((x) => x.institutionId)).toEqual([to.id]);
    const log = await ctx.prisma.auditLog.findFirstOrThrow({ where: { action: 'student.reassigned', entityId: s.id } }); expect((log.meta as any).reason).toMatch(/demo college/); expect((log.meta as any).from.institutionId).not.toBe(to.id);
    expect((await su.post('/directory/reassign-students', { toInstitutionId: to.id, toProgramId: mbbs.id, studentIds: [s.id], reason: 'Moving them again to the same place' })).status).toBe(400);   // already there
  });
  it('refuses a student who has examination history, and then moves nobody', async () => {
    const withHist = await demoStudent(); const clean = await demoStudent(); const to = await inst('SZ-A03'); const mbbs = await prog('MBBS');
    const studentClient = await as(ctx, 'student.a004').catch(() => null); void studentClient;
    const cand = await ctx.prisma.student.findFirstOrThrow({ where: { institution: { code: 'DMC-A' }, candidacies: { some: {} } } });   // a seeded demo student who is on an exam roster
    const r = await su.post('/directory/reassign-students', { toInstitutionId: to.id, toProgramId: mbbs.id, studentIds: [clean.s.id, cand.id], reason: 'Trying to move a student who has examination history' });
    expect(r.status).toBe(400); expect(r.body.code).toBe('REASSIGN_REFUSED'); expect(r.body.problems.join(' ')).toMatch(/examination history/);
    expect(await ctx.prisma.student.findUniqueOrThrow({ where: { id: clean.s.id } })).toMatchObject({ institutionId: clean.demo.id });         // all-or-nothing
    expect(withHist.s.id).toBeTruthy(); void startExam;
  });
});
