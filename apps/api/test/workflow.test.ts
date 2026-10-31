import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, as, boot, cid, save, startExam, type Ctx } from './helpers';
import { JobsService } from '../src/modules/jobs.service';
import { DOMAIN } from '../src/seed/seed';

let ctx: Ctx; let examId: string;
const sat: Record<string, { c: Client; attemptId: string; clientId: string }> = {};
beforeAll(async () => { ctx = await boot({ studentsPerCampus: 6 }); examId = ctx.seeded.examId; });
afterAll(async () => { await ctx.app.close(); });

const tick = () => ctx.app.get(JobsService).runTick();

describe('question bank → paper → schedule', () => {
  it('enforces clinical-MCQ and option rules', async () => {
    const l = await as(ctx, 'lecturer.a');
    const base = { courseId: ctx.seeded.courses.path.id, institutionId: ctx.seeded.institutions.a.id, difficulty: 'MEDIUM', stem: 'Which of these is the correct best answer to this stem?' };
    const opts = (n: number, correct = 1) => Array.from({ length: n }, (_, i) => ({ label: 'ABCDE'[i], text: `Option ${i}`, isCorrect: i < correct }));
    expect((await l.post('/questions', { ...base, type: 'CLINICAL_MCQ', options: opts(4) })).status).toBe(400);            // missing vignette
    expect((await l.post('/questions', { ...base, type: 'MCQ', options: opts(3) })).status).toBe(400);                      // too few options
    expect((await l.post('/questions', { ...base, type: 'MCQ', options: opts(4, 2) })).status).toBe(400);                   // two correct
    expect((await l.post('/questions', { ...base, type: 'MCQ', options: opts(4, 0) })).status).toBe(400);                   // none correct
    const ok = await l.post('/questions', { ...base, type: 'CLINICAL_MCQ', vignette: 'A 52-year-old presents with progressive dyspnoea and bilateral basal crackles.', options: opts(5) });
    expect(ok.status).toBe(201);
    expect(ok.body.status).toBe('DRAFT');
  });

  it('only approved, in-course questions may be placed on a paper; approval freezes an immutable snapshot', async () => {
    const examiner = await as(ctx, 'examiner'); const cce = await as(ctx, 'cce');
    const draft = await ctx.prisma.question.findFirstOrThrow({ where: { status: 'DRAFT' } });
    const ex = await examiner.post('/exams', { code: 'FREEZE-1', title: 'Freeze test', courseId: ctx.seeded.courses.path.id, term: '2026-SPRING', opensAt: new Date(Date.now() + 86400000), closesAt: new Date(Date.now() + 2 * 86400000), durationMin: 30, institutionIds: [ctx.seeded.institutions.a.id] });
    expect((await examiner.put(`/exams/${ex.body.id}/paper`, { items: [{ questionId: draft.id, marks: 1 }] })).status).toBe(400);
    const pharmQ = ctx.seeded.questionIds.PHARM[0]!;
    expect((await examiner.put(`/exams/${ex.body.id}/paper`, { items: [{ questionId: pharmQ, marks: 1 }] })).status).toBe(400); // wrong course
    const qid = ctx.seeded.questionIds.PATH[0]!;
    expect((await examiner.put(`/exams/${ex.body.id}/paper`, { items: [{ questionId: qid, marks: 3 }] })).status).toBe(200);
    expect((await examiner.post(`/exams/${ex.body.id}/paper/submit`)).status).toBe(201);
    expect((await examiner.post(`/exams/${ex.body.id}/paper/review`, { decision: 'APPROVE' })).status).toBe(403); // submitter ≠ approver
    expect((await cce.post(`/exams/${ex.body.id}/paper/review`, { decision: 'APPROVE' })).status).toBe(201);
    // editing the bank afterwards must not alter the approved paper
    const lec = await as(ctx, 'lecturer.a');
    const q = await ctx.prisma.question.findUniqueOrThrow({ where: { id: qid }, include: { options: true } });
    const upd = await lec.put(`/questions/${qid}`, { courseId: q.courseId, institutionId: q.institutionId, type: q.type, vignette: q.vignette, stem: 'EDITED STEM that should never reach the frozen paper', difficulty: q.difficulty, options: q.options.sort((a, b) => a.label.localeCompare(b.label)).map((o) => ({ label: o.label, text: o.text, isCorrect: o.isCorrect })) });
    expect(upd.status).toBe(200);
    expect(upd.body.status).toBe('DRAFT'); expect(upd.body.version).toBe(2);
    const eq = await ctx.prisma.examQuestion.findFirstOrThrow({ where: { examId: ex.body.id } });
    expect((eq.snapshot as any).stem).not.toContain('EDITED');
    expect(eq.correctLabel).toBeTruthy();
    // paper locked after approval
    expect((await examiner.put(`/exams/${ex.body.id}/paper`, { items: [{ questionId: qid, marks: 1 }] })).status).toBe(409);
    // restore the question for later tests
    await ctx.prisma.question.update({ where: { id: qid }, data: { status: 'APPROVED' } });
  });

  it('schedule builds the roster from eligible enrolments only and applies accommodations', async () => {
    const roster = await (await as(ctx, 'examiner')).get(`/exams/${examId}/roster`);
    expect(roster.body).toHaveLength(10); // 12 students − 2 below the 75% attendance threshold
    expect(roster.body.find((r: any) => r.regNo === 'DMC-A-2024-0001')).toBeUndefined();
    const adminA = await as(ctx, 'admin.a');
    const s = await ctx.prisma.student.findFirstOrThrow({ where: { regNo: 'DMC-A-2024-0005' } });
    expect((await adminA.patch(`/exams/${examId}/candidates/${s.id}`, { extraTimeMin: 15, accommodation: 'Synthetic: extra time' })).status).toBe(200);
    const stuB = await ctx.prisma.student.findFirstOrThrow({ where: { regNo: 'DMC-B-2024-0005' } });
    expect((await adminA.patch(`/exams/${examId}/candidates/${stuB.id}`, { extraTimeMin: 15 })).status).toBe(404);
  });
  it('condoning attendance is CCE-only and puts the student on the roster after refresh', async () => {
    const adminA = await as(ctx, 'admin.a'); const cce = await as(ctx, 'cce');
    const e = await ctx.prisma.enrollment.findFirstOrThrow({ where: { courseId: ctx.seeded.courses.path.id, student: { regNo: 'DMC-A-2024-0001' } } });
    expect((await adminA.post(`/enrollments/${e.id}/condone`, { note: 'Medical leave certified' })).status).toBe(403);
    expect((await adminA.patch(`/enrollments/${e.id}/attendance`, { attendancePct: 80 })).body.eligibility).toBe('ELIGIBLE');
    await adminA.patch(`/enrollments/${e.id}/attendance`, { attendancePct: 60 });
    expect((await cce.post(`/enrollments/${e.id}/condone`, { note: 'Medical leave certified' })).body.eligibility).toBe('CONDONED');
    const { ExamsService } = await import('../src/modules/exams/exams.service');
    expect((await ctx.app.get(ExamsService).refreshRoster(examId, (await ctx.prisma.user.findFirstOrThrow({ where: { email: { startsWith: 'cce@' } } })).id)).candidatesAdded).toBe(1);
  });
});

describe('sitting → grading → approval → publication', () => {
  const plan: [string, 'all' | 'half' | 'none' | 'skip'][] = [['student.a002', 'all'], ['student.a003', 'half'], ['student.a004', 'none'], ['student.b002', 'all'], ['student.b003', 'half'], ['student.b004', 'skip']];
  it('students sit the exam and submit', async () => {
    for (const [user, mode] of plan) {
      const c = await as(ctx, user);
      const { attemptId, clientId, questions } = await startExam(ctx, c);
      sat[user] = { c, attemptId, clientId };
      const eqs = await ctx.prisma.examQuestion.findMany({ where: { examId } });
      const key = new Map(eqs.map((q) => [q.id, q.correctLabel!]));
      let rev = 1;
      for (const [i, q] of questions.entries()) {
        const correct = key.get(q.id)!; const wrong = correct === 'A' ? 'B' : 'A';
        const pick = mode === 'all' ? correct : mode === 'none' ? wrong : mode === 'half' ? (i % 2 === 0 ? correct : wrong) : null;
        if (pick) expect((await save(c, attemptId, q.id, clientId, rev++, pick)).status).toBe(200);
      }
      const sheet = await c.get(`/attempts/${attemptId}/sheet`);
      const sub = await c.post(`/attempts/${attemptId}/submit`, { clientId, submitKey: `k-${user}-0001`, expected: sheet.body.answers.map((a: any) => ({ examQuestionId: a.examQuestionId, revision: a.revision, selectedLabel: a.selectedLabel })) });
      expect(sub.status, sub.raw).toBe(200);
      expect(sub.body.status).toBe('SUBMITTED');
    }
  });

  it('the exam stays open while the window runs; after close the lifecycle tick grades, marks absentees and moves to RESULT_PENDING', async () => {
    const early = await tick();
    expect(early.pending).toBe(0);
    await ctx.prisma.exam.update({ where: { id: examId }, data: { closesAt: new Date(Date.now() - 1000), opensAt: new Date(Date.now() - 3600_000) } });
    const t = await tick();
    expect(t.graded).toBeGreaterThanOrEqual(0);
    const exam = await ctx.prisma.exam.findUniqueOrThrow({ where: { id: examId } });
    expect(exam.status).toBe('RESULT_PENDING');
    const res = await ctx.prisma.result.findMany({ where: { examId }, include: { student: true } });
    const by = (reg: string) => res.find((r) => r.student.regNo === reg)!;
    expect(by('DMC-A-2024-0002')).toMatchObject({ rawScore: 24, percent: 100, status: 'PASS' });
    expect(by('DMC-A-2024-0003')).toMatchObject({ rawScore: 12, percent: 50, status: 'PASS' });
    expect(by('DMC-A-2024-0004')).toMatchObject({ rawScore: 0, status: 'FAIL' });
    expect(by('DMC-B-2024-0004')).toMatchObject({ rawScore: 0, status: 'FAIL' }); // sat, answered nothing
    expect(by('DMC-A-2024-0006').status).toBe('ABSENT');
  });

  it('students cannot see results before publication', async () => {
    expect((await sat['student.a002']!.c.get('/me/results')).body).toEqual([]);
  });

  it('item analysis is scoped; only the examiner can void/correct a key, which regrades and resets review', async () => {
    const lec = await as(ctx, 'lecturer.a'); const examiner = await as(ctx, 'examiner');
    const an = await lec.get(`/grading/exams/${examId}/analysis`);
    expect(an.status).toBe(200);
    expect(an.body.candidates).toBe(3); // lecturer.a sees only campus A sitters (a002,a003,a004)
    const q1 = an.body.questions[0];
    expect((await lec.post(`/grading/exams/${examId}/key-actions`, { examQuestionId: q1.examQuestionId, kind: 'VOID', reason: 'Lecturer should not be able to do this' })).status).toBe(403);
    const r = await examiner.post(`/grading/exams/${examId}/key-actions`, { examQuestionId: q1.examQuestionId, kind: 'VOID', reason: 'Ambiguous stem confirmed by panel' });
    expect(r.status).toBe(201);
    expect(r.body.regraded).toBe(6);
    const res = await ctx.prisma.result.findMany({ where: { examId }, include: { student: true } });
    const none = res.find((x) => x.student.regNo === 'DMC-A-2024-0004')!;
    expect(none.rawScore).toBe(2); // voided question awards full marks (2) to every sitter
    expect(res.find((x) => x.student.regNo === 'DMC-A-2024-0002')!.rawScore).toBe(24); // capped at the paper total, no double award
  });

  it('approval chain: lecturer review → examiner approval (blocked by open incident) → publication by a different person', async () => {
    const lec = await as(ctx, 'lecturer.a'); const examiner = await as(ctx, 'examiner'); const cce = await as(ctx, 'cce'); const sup = await as(ctx, 'super.admin');
    expect((await examiner.post(`/results/exams/${examId}/approve`)).status).toBe(409); // lecturer review missing
    expect((await lec.post(`/grading/exams/${examId}/review`, { note: 'Reviewed item analysis' })).status).toBe(200);
    const inv = await as(ctx, 'invigilator.a');
    const inc = await inv.post('/incidents', { examId, institutionId: ctx.seeded.institutions.a.id, type: 'TECHNICAL', severity: 'MEDIUM', description: 'Projector failure in hall; students unaffected.' });
    expect(inc.status).toBe(201);
    const blocked = await examiner.post(`/results/exams/${examId}/approve`);
    expect(blocked.status).toBe(409); expect(blocked.body.code).toBe('OPEN_INCIDENTS');
    expect((await inv.patch(`/incidents/${inc.body.id}`, { status: 'RESOLVED', resolution: 'x' })).status).toBe(403); // invigilators cannot self-resolve
    expect((await examiner.patch(`/incidents/${inc.body.id}`, { status: 'RESOLVED', resolution: 'Hall AV fault only; no candidate impact.' })).status).toBe(200);
    expect((await examiner.post(`/results/exams/${examId}/approve`)).status).toBe(200);
    expect((await examiner.post(`/results/exams/${examId}/publish`)).status).toBe(403);   // role
    // four-eyes: super admin approved-by-examiner? examiner approved; super admin publishes OK; but a super admin who approved cannot publish
    expect((await cce.post(`/results/exams/${examId}/publish`)).status).toBe(200);
    expect((await cce.post(`/results/exams/${examId}/publish`)).status).toBe(409);
    void sup;
  });

  it('after publication: students see their own result and certificate; campus data stays scoped', async () => {
    const a2 = sat['student.a002']!.c;
    const mine = await a2.get('/me/results');
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0]).toMatchObject({ percent: 100, status: 'PASS' });
    expect(JSON.stringify(mine.body)).not.toMatch(/correct|answers/i);
    const cert = await a2.get(`/me/results/${mine.body[0].id}/certificate`);
    expect(cert.status).toBe(200);
    expect(cert.body.serial).toMatch(/^SZABMU\/\d{4}\/\d+$/);
    // a student with FAIL gets no certificate… except the voided question lifted a004 to 2/24 ≈ 8% → FAIL
    const a4 = sat['student.a004']!.c; const r4 = await a4.get('/me/results');
    expect(r4.body[0].status).toBe('FAIL');
    expect((await a4.get(`/me/results/${r4.body[0].id}/certificate`)).status).toBe(404);
    // another student cannot fetch this certificate
    expect((await sat['student.b002']!.c.get(`/me/results/${mine.body[0].id}/certificate`)).status).toBe(404);
    // public verification
    const anon = new Client(ctx.app);
    const v = await anon.get(`/public/verify?serial=${encodeURIComponent(cert.body.serial)}&code=${cert.body.verifyCode}`);
    expect(v.body.valid).toBe(true);
    expect(v.body.holder).toMatch(/^\w+ \w\.( \w\.)*$/); // masked surname
    expect((await anon.get(`/public/verify?serial=${encodeURIComponent(cert.body.serial)}&code=WRONGCODE`)).body.valid).toBe(false);
    // campus admins now see their own campus results only
    const adminA = await as(ctx, 'admin.a'); const adminB = await as(ctx, 'admin.b');
    const ra = await adminA.get(`/results/exams/${examId}`);
    expect(ra.status).toBe(200);
    expect(ra.body.rows.every((r: any) => r.institution === 'DMC-A')).toBe(true);
    expect(ra.body.rows.length).toBeGreaterThan(0);
    expect((await adminB.get(`/results/exams/${examId}`)).body.rows.every((r: any) => r.institution === 'DMC-B')).toBe(true);
    const csv = await adminA.get(`/reports/exams/${examId}/csv`);
    expect(csv.status).toBe(200);
    expect(csv.raw).not.toContain('DMC-B');
    const rep = await adminA.get(`/reports/exams/${examId}`);
    expect(rep.body.available).toBe(true);
    expect(rep.body.byInstitution.map((i: any) => i.code)).toEqual(['DMC-A']);
  });

  it('after publication no key changes are accepted', async () => {
    const examiner = await as(ctx, 'examiner');
    const eq = await ctx.prisma.examQuestion.findFirstOrThrow({ where: { examId } });
    expect((await examiner.post(`/grading/exams/${examId}/key-actions`, { examQuestionId: eq.id, kind: 'VOID', reason: 'Too late to change anything now' })).status).toBe(409);
  });
});

describe('four-eyes on publication', () => {
  it('the person who gave examiner approval cannot also publish', async () => {
    // fresh exam driven straight to EXAMINER_APPROVED by super admin
    const exam = await ctx.prisma.exam.create({ data: { code: 'FE-1', title: 'FE', courseId: ctx.seeded.courses.path.id, createdBy: (await ctx.prisma.user.findFirstOrThrow({ where: { role: 'SUPER_ADMIN' } })).id, status: 'RESULT_PENDING', opensAt: new Date(Date.now() - 7200_000), closesAt: new Date(Date.now() - 3600_000), durationMin: 30, institutions: { create: [{ institutionId: ctx.seeded.institutions.a.id }] } } });
    const sup = await ctx.prisma.user.findFirstOrThrow({ where: { role: 'SUPER_ADMIN' } });
    await ctx.prisma.resultBatch.create({ data: { examId: exam.id, status: 'EXAMINER_APPROVED', examinerApprovedBy: sup.id, examinerApprovedAt: new Date() } });
    const s = await as(ctx, 'super.admin');
    const r = await s.post(`/results/exams/${exam.id}/publish`);
    expect(r.status).toBe(403);
  });
});

describe('invigilation', () => {
  it('extend time is audited and bounded; force-submit seals with a receipt; incidents flow', async () => {
    // build a second live exam so we have fresh attempts
    const exam = await ctx.prisma.exam.create({ data: { code: 'LIVE-2', title: 'Live 2', courseId: ctx.seeded.courses.path.id, createdBy: (await ctx.prisma.user.findFirstOrThrow({ where: { role: 'SUPER_ADMIN' } })).id, status: 'LIVE', paperStatus: 'APPROVED', opensAt: new Date(Date.now() - 600_000), closesAt: new Date(Date.now() + 86400_000), durationMin: 30, totalMarks: 1, institutions: { create: [{ institutionId: ctx.seeded.institutions.a.id }] } } });
    const q = await ctx.prisma.question.findFirstOrThrow({ where: { status: 'APPROVED', courseId: ctx.seeded.courses.path.id }, include: { options: true } });
    await ctx.prisma.examQuestion.create({ data: { examId: exam.id, questionId: q.id, position: 1, marks: 1, correctLabel: 'A', snapshot: { type: 'MCQ', vignette: null, stem: q.stem, options: q.options.map((o) => ({ label: o.label, text: o.text })) } } });
    const stu = await ctx.prisma.student.findFirstOrThrow({ where: { regNo: 'DMC-A-2024-0006' } });
    await ctx.prisma.examCandidate.create({ data: { examId: exam.id, studentId: stu.id, institutionId: stu.institutionId } });
    const s = await as(ctx, 'student.a006'); const clientId = cid();
    const st = await s.post('/attempts/start', { examId: exam.id, clientId });
    expect(st.status).toBe(200);
    const attemptId = st.body.attempt.id; const before = new Date(st.body.attempt.deadlineAt).getTime();
    await ctx.prisma.examInvigilator.create({ data: { examId: exam.id, userId: (await ctx.prisma.user.findFirstOrThrow({ where: { email: `invigilator.a@${DOMAIN}` } })).id, institutionId: stu.institutionId } });
    const inv = await as(ctx, 'invigilator.a');
    expect((await inv.post(`/invigilation/attempts/${attemptId}/extend`, { minutes: 90, reason: 'way too long' })).status).toBe(400);
    const ext = await inv.post(`/invigilation/attempts/${attemptId}/extend`, { minutes: 10, reason: 'Power outage in hall; verified.' });
    expect(ext.status).toBe(200);
    expect(new Date(ext.body.deadlineAt).getTime() - before).toBe(10 * 60_000);
    expect((await s.post(`/attempts/${attemptId}/heartbeat`, { clientId })).body.deadlineAt).toBe(ext.body.deadlineAt); // student's clock follows the server
    const mon = await inv.get(`/invigilation/exams/${exam.id}/monitor`);
    expect(mon.body.summary).toMatchObject({ candidates: 1, inProgress: 1 });
    expect(mon.body.rows[0].connection).toBe('ONLINE');
    const fs = await inv.post(`/invigilation/attempts/${attemptId}/force-submit`, { reason: 'Misconduct: phone in use, confirmed.' });
    expect(fs.status).toBe(200);
    expect(fs.body.status).toBe('AUTO_SUBMITTED');
    expect(fs.body.receiptCode).toMatch(/^RC-/);
    expect((await inv.post(`/invigilation/attempts/${attemptId}/extend`, { minutes: 5, reason: 'after the fact' })).status).toBe(409);
    const audit = await ctx.prisma.auditLog.findMany({ where: { entityId: attemptId } });
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['attempt.extend_time', 'attempt.force_submit']));
    // candidate lifecycle is journalled on the attempt itself (not in the serialised audit chain)
    const ev = await ctx.prisma.attemptEvent.findMany({ where: { attemptId }, orderBy: { id: 'asc' } });
    expect(ev.map((e) => e.kind)).toEqual(expect.arrayContaining(['STARTED', 'TIME_EXTENDED', 'FORCE_SUBMITTED']));
  });
});

describe('audit trail', () => {
  it('is hash-chained, append-only at the database level, and tamper-evident', async () => {
    const sup = await as(ctx, 'super.admin');
    const ok = await sup.get('/audit/verify');
    expect(ok.body.brokenAt).toBeNull();
    expect(ok.body.checked).toBeGreaterThan(50);
    await expect(ctx.prisma.$executeRaw`UPDATE audit_logs SET action = 'tampered' WHERE seq = 1`).rejects.toThrow(/append-only/);
    await expect(ctx.prisma.$executeRaw`DELETE FROM audit_logs WHERE seq = 2`).rejects.toThrow(/append-only/);
    await expect(ctx.prisma.$executeRaw`UPDATE answer_events SET "selectedLabel" = 'A'`).rejects.toThrow(/append-only/);
    // a privileged attacker who disables the trigger is still detected by the chain
    await ctx.prisma.$executeRawUnsafe('ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_append_only');
    await ctx.prisma.$executeRawUnsafe(`UPDATE audit_logs SET action = 'forged' WHERE seq = 5`);
    await ctx.prisma.$executeRawUnsafe('ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_append_only');
    const bad = await sup.get('/audit/verify');
    expect(bad.body.brokenAt).toBe('5');
  });
});

describe('database constraints', () => {
  it('reject malformed rows even when the application is bypassed', async () => {
    const q = await ctx.prisma.question.findFirstOrThrow();
    await expect(ctx.prisma.questionOption.create({ data: { questionId: q.id, label: 'Z', text: 'bad label' } })).rejects.toThrow();
    await expect(ctx.prisma.$executeRaw`UPDATE question_options SET "isCorrect" = true WHERE "questionId" = ${q.id}::uuid`).rejects.toThrow(/one_correct|duplicate key/);
    await expect(ctx.prisma.exam.update({ where: { id: examId }, data: { durationMin: 1 } })).rejects.toThrow();
    await expect(ctx.prisma.$executeRaw`UPDATE users SET email = 'UPPER@CASE.TEST' WHERE email = ${`cce@${DOMAIN}`}`).rejects.toThrow();
  });
});
