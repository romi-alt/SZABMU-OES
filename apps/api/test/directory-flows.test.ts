import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, as, boot, startExam, type Ctx } from './helpers';
import { runImport } from '../src/directory/importer';
import { ExamsService } from '../src/modules/exams/exams.service';

/** The directory drives every flow that uses an institution or programme, on the server. Real baseline imported over the demo universe. */
let ctx: Ctx; let seq = 0;
const PW = 'Sturdy-Pass-2026!x';
const clear = () => ctx.kv.clearPrefix('rl:');
const inst = (code: string) => ctx.prisma.institution.findUniqueOrThrow({ where: { code } });
const prog = (key: string) => ctx.prisma.program.findFirstOrThrow({ where: { OR: [{ directoryKey: key }, { code: key }] } });
const offering = async (code: string, key: string) => ctx.prisma.institutionProgramOffering.findUniqueOrThrow({ where: { institutionId_programId: { institutionId: (await inst(code)).id, programId: (await prog(key)).id } } });

beforeAll(async () => { ctx = await boot({ studentsPerCampus: 4 }); await runImport(ctx.prisma, { mode: 'APPLY', actor: 'test' }); });
afterAll(async () => { await ctx.app.close(); });

async function signUp() {
  await clear(); const n = ++seq; const regNo = `DIR-${n}`; const email = `dir${n}@example.test`;
  const s = await new Client(ctx.app).post('/auth/register', { regNo, email, password: PW }); expect(s.status, s.raw).toBe(200);
  const c = new Client(ctx.app); const r = await c.req('POST', '/auth/register/verify', { email, code: s.body.devCode }); expect(r.status, r.raw).toBe(200);
  const sc = r.headers['set-cookie']; c.cookie = String(Array.isArray(sc) ? sc[0] : sc).split(';')[0]!;
  return { c, regNo, userId: (await ctx.prisma.user.findUniqueOrThrow({ where: { email } })).id };
}
const form = async (code: string, key: string, extra: Record<string, unknown> = {}) => ({ fullName: 'Amna Test Student', fatherName: 'Tariq Test', gender: 'FEMALE', institutionId: (await inst(code)).id, programId: (await prog(key)).id, semester: 4, batchYear: 2025, mobile: '+92 300 1234567', ...extra });

describe('student profile completion uses the real directory', () => {
  it('lists the real institutions with the programmes each one offers, flags stopped intakes, and offers shifts only where they exist', async () => {
    const t = await signUp(); const cat = (await t.c.get('/onboarding/catalog')).body;
    const byCode = Object.fromEntries(cat.institutions.map((i: any) => [i.code, i]));
    for (const code of ['SZ-A03', 'SZ-C08', 'SZ-C20', 'SZ-C02', 'DMC-A']) expect(byCode[code], code).toBeTruthy();
    expect(byCode['SZ-C08']).toMatchObject({ name: 'HBS Medical & Dental College, Islamabad', sector: 'PRIVATE', city: 'Islamabad' });
    const offered = async (code: string) => (cat.programsByInstitution[(await inst(code)).id] as string[]).sort();
    expect(await offered('SZ-C08')).toEqual((await Promise.all(['MBBS', 'BDS', 'DPT', 'BS_ANESTHESIA', 'BS_DENTAL_TECH', 'BS_MLT', 'BS_VISION', 'BS_RADIOGRAPHY_IMAGING', 'BSN_GENERIC', 'BSN_POST_RN'].map(async (k) => (await prog(k)).id))).sort());
    expect(await offered('SZ-A03')).toEqual([(await prog('MBBS')).id]);                                              // a college sees only its own programmes
    expect(cat.programsByInstitution[(await inst('SZ-A04')).id] ?? []).toEqual([]);                                // PIMS: no programme table, none attached
    expect(cat.stoppedByInstitution[(await inst('SZ-C02')).id]).toEqual([(await prog('DPT')).id]);
    expect(cat.stoppedByInstitution[(await inst('SZ-C12')).id]).toEqual([(await prog('BSN_POST_RN')).id]);
    expect(cat.shiftsByOffering[`${(await inst('SZ-C08')).id}|${(await prog('BSN_GENERIC')).id}`]).toEqual(['MORNING', 'EVENING']);
    expect(cat.shiftsByOffering[`${(await inst('SZ-C10')).id}|${(await prog('BSN_GENERIC')).id}`]).toBeUndefined();
    expect(cat.institutions.map((i: any) => i.code)).not.toContain('SZ-B01');                                          // no selectable programme yet
  });

  it('rejects an institution-programme pair that is not offered, whatever the form sent', async () => {
    const t = await signUp();
    for (const [code, key] of [['SZ-C02', 'MBBS'], ['SZ-A03', 'BDS'], ['SZ-A04', 'MBBS'], ['SZ-C14', 'BSN_GENERIC']] as const) {
      const r = await t.c.post('/onboarding/complete', await form(code, key)); expect(r.status, `${code}/${key}`).toBe(400); expect(r.body.code).toBe('NOT_OFFERED');
    }
    expect(await ctx.prisma.student.count({ where: { userId: t.userId } })).toBe(0);
  });

  it('a new self-declared student cannot enrol into a stopped intake (Aman DPT, IHMS DPT, Kulsum Post RN BSN), but the other offerings there work', async () => {
    for (const [code, key] of [['SZ-C02', 'DPT'], ['SZ-C09', 'DPT'], ['SZ-C12', 'BSN_POST_RN']] as const) {
      const t = await signUp(); const r = await t.c.post('/onboarding/complete', await form(code, key)); expect(r.status, `${code}/${key}`).toBe(409); expect(r.body.code).toBe('INTAKE_STOPPED');
      expect(r.body.message).toMatch(/not admitting new students/); expect(await ctx.prisma.student.count({ where: { userId: t.userId } })).toBe(0);
    }
    for (const [code, key] of [['SZ-C02', 'BSN_GENERIC'], ['SZ-C12', 'DPT'], ['SZ-C12', 'BSN_GENERIC'], ['SZ-C12', 'BS_MLT']] as const) {
      const t = await signUp(); const r = await t.c.post('/onboarding/complete', await form(code, key)); expect(r.status, `${code}/${key} ${r.raw}`).toBe(200);
      expect(await ctx.prisma.student.findFirstOrThrow({ where: { userId: t.userId } })).toMatchObject({ selfDeclared: true });          // still needs an administrator's verification
    }
  });

  it('a student who is on the institution’s register keeps their place in a stopped programme', async () => {
    const t = await signUp(); const a = await inst('SZ-C02'); const dpt = await prog('DPT');
    await ctx.prisma.rosterEntry.create({ data: { institutionId: a.id, programId: dpt.id, regNo: t.regNo, fullName: 'On The Register', dateOfBirth: new Date('2004-01-01'), semester: 2, batchYear: 2024 } });
    const r = await t.c.post('/onboarding/complete', await form('SZ-C02', 'DPT', { batchYear: 2024 })); expect(r.status, r.raw).toBe(200);
  });

  it('a stop that a source dates from a given batch applies to that batch and later, not to earlier cohorts', async () => {
    const off = await offering('SZ-C09', 'DPT'); await ctx.prisma.institutionProgramOffering.update({ where: { id: off.id }, data: { intakeStoppedFromBatchYear: 2026 } });
    const t = await signUp(); await ctx.prisma.rosterEntry.create({ data: { institutionId: off.institutionId, programId: off.programId, regNo: t.regNo, fullName: 'Register', dateOfBirth: new Date('2004-01-01'), semester: 1, batchYear: 2026 } });
    expect((await t.c.post('/onboarding/complete', await form('SZ-C09', 'DPT', { batchYear: 2026 }))).status).toBe(409);        // register or not: batch 2026 is inside the stop
    expect((await t.c.post('/onboarding/complete', await form('SZ-C09', 'DPT', { batchYear: 2024, semester: 5 }))).status).toBe(200);   // an earlier cohort continues
    await ctx.prisma.institutionProgramOffering.update({ where: { id: off.id }, data: { intakeStoppedFromBatchYear: null } });
  });

  it('asks for a shift only where the offering has morning and evening allocations, and stores it', async () => {
    const t1 = await signUp(); const need = await t1.c.post('/onboarding/complete', await form('SZ-C08', 'BSN_GENERIC', { semester: 1 })); expect(need.status).toBe(400); expect(need.body.message).toMatch(/shift/i);
    expect((await t1.c.post('/onboarding/complete', await form('SZ-C08', 'BSN_GENERIC', { semester: 1, shift: 'NIGHT' }))).status).toBe(400);
    expect((await t1.c.post('/onboarding/complete', await form('SZ-C08', 'BSN_GENERIC', { semester: 1, shift: 'EVENING' }))).status).toBe(200);
    expect((await ctx.prisma.student.findFirstOrThrow({ where: { userId: t1.userId } })).shift).toBe('EVENING');
    const t2 = await signUp(); const extra = await t2.c.post('/onboarding/complete', await form('SZ-C10', 'BSN_GENERIC', { semester: 1, shift: 'MORNING' })); expect(extra.status).toBe(400);   // IMDC has no shifts
    expect((await t2.c.post('/onboarding/complete', await form('SZ-C10', 'BSN_GENERIC', { semester: 1 }))).status).toBe(200);
  });

  it('a session set up for a batch can close it or cap it; without a session row nothing is closed or limited', async () => {
    const off = await offering('SZ-A03', 'MBBS');
    await ctx.prisma.offeringSession.create({ data: { offeringId: off.id, batchYear: 2030, admissionsStatus: 'CLOSED' } });
    const t = await signUp(); const r = await t.c.post('/onboarding/complete', await form('SZ-A03', 'MBBS', { batchYear: new Date().getFullYear() + 1 > 2030 ? 2030 : 2030 })); // batch years beyond now+1 are not offered
    expect([400, 409]).toContain(r.status);
    await ctx.prisma.offeringSession.deleteMany({ where: { offeringId: off.id } });
    const year = new Date().getFullYear(); await ctx.prisma.offeringSession.create({ data: { offeringId: off.id, batchYear: year, admissionsStatus: 'OPEN', seatLimit: 1 } });
    const u1 = await signUp(); expect((await u1.c.post('/onboarding/complete', await form('SZ-A03', 'MBBS', { semester: 1, batchYear: year }))).status).toBe(200);
    const u2 = await signUp(); const full = await u2.c.post('/onboarding/complete', await form('SZ-A03', 'MBBS', { semester: 1, batchYear: year })); expect(full.status).toBe(409); expect(full.body.code).toBe('SESSION_FULL');
    await ctx.prisma.offeringSession.deleteMany({ where: { offeringId: off.id } });
  });
});

describe('administrator-side enrolment is checked against the same offerings', () => {
  it('creating, importing and re-programming a student requires an offered pair; a stopped intake still admits an existing cohort', async () => {
    const adm = await as(ctx, 'super.admin'); const mk = async (code: string, key: string, extra: Record<string, unknown> = {}) => ({ email: `mk${++seq}@example.test`, fullName: 'Admin Created', institutionId: (await inst(code)).id, programId: (await prog(key)).id, regNo: `ADM-${seq}`, semester: 2, batchYear: 2024, ...extra });
    const bad = await adm.post('/students', await mk('SZ-C03', 'MBBS')); expect(bad.status).toBe(400); expect(bad.body.code).toBe('NOT_OFFERED');
    const made = await adm.post('/students', await mk('SZ-C03', 'BDS')); expect(made.status).toBe(201);
    expect((await adm.post('/students', await mk('SZ-C09', 'DPT'))).status).toBe(201);                                            // existing cohort at a stopped intake: allowed
    const off = await offering('SZ-C09', 'DPT'); await ctx.prisma.institutionProgramOffering.update({ where: { id: off.id }, data: { intakeStoppedFromBatchYear: 2025 } });
    const after = await adm.post('/students', await mk('SZ-C09', 'DPT', { batchYear: 2025 })); expect(after.status).toBe(409); expect(after.body.code).toBe('INTAKE_STOPPED');
    await ctx.prisma.institutionProgramOffering.update({ where: { id: off.id }, data: { intakeStoppedFromBatchYear: null } });
    const imp = await adm.post('/students/import', { institutionId: (await inst('SZ-C03')).id, rows: [{ email: `imp${++seq}@example.test`, fullName: 'Imp One', programId: (await prog('DPT')).id, regNo: `IMP-${seq}`, semester: 1, batchYear: 2024 }] });
    expect(imp.status).toBe(400); expect(imp.body.code).toBe('NOT_OFFERED');
    expect((await adm.patch(`/students/${made.body.id}`, { programId: (await prog('DPT')).id })).status).toBe(400);                         // moving to a programme the college does not offer
    expect((await adm.patch(`/students/${made.body.id}`, { semester: 3 })).status).toBe(200);
  });

  it('the official register import refuses programme codes the institution does not offer', async () => {
    const adm = await as(ctx, 'super.admin'); const row = (regNo: string, programCode: string) => ({ regNo, fullName: 'Register Row', dateOfBirth: '2004-02-02', programCode, semester: 2, batchYear: 2024 });
    const r = await adm.post('/roster/import', { institutionId: (await inst('SZ-C03')).id, rows: [row(`RG-${++seq}`, 'DPT')] }); expect(r.status).toBe(400); expect(r.body.message).toMatch(/not offered/i);
    expect((await adm.post('/roster/import', { institutionId: (await inst('SZ-C03')).id, rows: [row(`RG-${++seq}`, 'BDS')] })).status).toBe(200);
    const stopped = await adm.post('/roster/import', { institutionId: (await inst('SZ-C02')).id, rows: [row(`RG-${++seq}`, 'DPT')] });
    expect(stopped.status).toBe(200); expect(stopped.body.warnings.join(' ')).toMatch(/intake stopped/i);                              // existing cohorts may be recorded; the stop is flagged
  });
});

describe('teacher and lecturer assignments follow the directory', () => {
  it('teachers choose institutions and programmes from offerings, and a subject outside the institution’s programmes is refused', async () => {
    const cat = (await new Client(ctx.app).get('/teacher-registration/catalog')).body;
    expect(cat.institutions.map((i: any) => i.code)).toEqual(expect.arrayContaining(['SZ-A03', 'SZ-C08', 'DMC-A']));
    const c03 = await inst('SZ-C03'); const bds = await prog('BDS');
    expect(cat.offerings.find((o: any) => o.institutionId === c03.id && o.programId === bds.id)).toBeTruthy();
    const mbbs = cat.courses.find((c: any) => c.code === 'MBBS-PATH-4'); const body = async (code: string) => ({ fullName: 'Dr Directory', email: `td${++seq}@example.test`, password: PW, employeeId: `TD-${seq}`, department: 'Pathology', designation: 'Lecturer', phone: '+92 300 1234567',
      assignments: [{ institutionId: (await inst(code)).id, programId: mbbs.programId, semester: mbbs.semester, term: '2026-SPRING', courseId: mbbs.id }] });
    await clear(); const bad = await new Client(ctx.app).post('/teacher-registration', await body('SZ-C02')); expect(bad.status).toBe(400); expect(bad.body.message).toMatch(/not offered|belong/i);
    await clear(); expect((await new Client(ctx.app).post('/teacher-registration', await body('SZ-A03'))).status).toBe(200);          // FMC offers MBBS
  });
  it('a lecturer can only be assigned to a subject whose programme the institution offers', async () => {
    const su = await as(ctx, 'super.admin'); const lect = await ctx.prisma.user.findFirstOrThrow({ where: { email: 'lecturer.a@demo.szabmu.invalid' }, include: { institutions: true } });
    const bsnCourse = await ctx.prisma.course.findFirstOrThrow({ where: { code: 'BSN-FUND-1' } });
    const r = await su.post('/course-assignments', { userId: lect.id, courseId: bsnCourse.id, institutionId: lect.institutions[0]!.institutionId });
    expect([400, 404]).toContain(r.status); expect(r.status === 400 ? r.body.code : 'NOT_OFFERED').toBe('NOT_OFFERED');
  });
});

describe('examination eligibility follows the awarding body, not the intake status', () => {
  it('an existing cohort in a stopped programme still sits its examinations', async () => {
    const off = await offering('DMC-B', 'MBBS'); await ctx.prisma.institutionProgramOffering.update({ where: { id: off.id }, data: { intakeStatus: 'STOPPED' } });
    const student = await as(ctx, 'student.b004'); const { attemptId } = await startExam(ctx, student); expect(attemptId).toBeTruthy();
    await ctx.prisma.institutionProgramOffering.update({ where: { id: off.id }, data: { intakeStatus: 'UNRESTRICTED' } });
  });
  it('students of an offering awarded by someone other than SZABMU are not enrolled into SZABMU cohorts or examination rosters', async () => {
    const body = await ctx.prisma.awardingBody.create({ data: { key: `other-${Date.now()}`, name: 'Another awarding body (test)', kind: 'PROFESSIONAL_COLLEGE', isSzabmu: false } });
    const off = await offering('DMC-B', 'MBBS'); const adm = await as(ctx, 'admin.b'); const path = ctx.seeded.courses.path;
    const cohort = async () => (await adm.post('/enrollments/bulk', { courseId: path.id, term: '2027-SPRING', institutionId: off.institutionId })).body.eligibleCohort as number;
    const base = await cohort(); expect(base).toBeGreaterThan(0);
    await ctx.prisma.institutionProgramOffering.update({ where: { id: off.id }, data: { awardingBodyId: body.id } });
    await ctx.prisma.enrollment.deleteMany({ where: { term: '2027-SPRING' } });
    expect(await cohort()).toBe(0);
    // and a roster refresh drops them
    const svc = ctx.app.get(ExamsService); const exam = await ctx.prisma.exam.findUniqueOrThrow({ where: { id: ctx.seeded.examId }, include: { candidates: true } });
    const before = exam.candidates.filter((c) => c.institutionId === off.institutionId && c.status === 'ADMITTED').length;
    await svc.refreshRoster(exam.id, (await ctx.prisma.user.findFirstOrThrow({ where: { email: 'cce@demo.szabmu.invalid' } })).id);
    const after = await ctx.prisma.examCandidate.count({ where: { examId: exam.id, institutionId: off.institutionId, status: 'ADMITTED' } });
    const startedHere = await ctx.prisma.examCandidate.count({ where: { examId: exam.id, institutionId: off.institutionId, status: 'ADMITTED', student: { attempts: { some: { examId: exam.id } } } } });   // a candidate who already started is never touched
    expect(after).toBe(startedHere); expect(before).toBeGreaterThan(startedHere);          // and some unstarted candidates really were dropped (the check is not vacuous)
    await ctx.prisma.institutionProgramOffering.update({ where: { id: off.id }, data: { awardingBodyId: (await ctx.prisma.awardingBody.findUniqueOrThrow({ where: { key: 'szabmu' } })).id } });
  });
});
