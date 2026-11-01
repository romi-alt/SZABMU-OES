import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, boot, cid, save, startExam, type Ctx } from './helpers';

let ctx: Ctx;
beforeAll(async () => { ctx = await boot(); });
afterAll(async () => { await ctx.app.close(); });

const label = (i: number) => 'ABCDE'[i % 4]!;

describe('start / resume', () => {
  it('requires the student to be on the roster; ineligible student cannot start', async () => {
    const ineligible = await as(ctx, 'student.a001'); // seeded with 62% attendance → excluded from roster
    const r = await ineligible.post('/attempts/start', { examId: ctx.seeded.examId, clientId: cid() });
    expect(r.status).toBe(403);
  });

  it('never ships the answer key to the browser', async () => {
    const s = await as(ctx, 'student.a002');
    const { res } = await startExam(ctx, s);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toMatch(/correctLabel|isCorrect|explanation/);
    expect(res.body.questions).toHaveLength(12);
    expect(res.body.attempt.deadlineAt).toBeTruthy();
  });

  it('is idempotent under concurrent double-start (one attempt, same order)', async () => {
    const s = await as(ctx, 'student.a003');
    const c = cid();
    const rs = await Promise.all(Array.from({ length: 8 }, () => s.post('/attempts/start', { examId: ctx.seeded.examId, clientId: c })));
    expect(rs.every((r) => r.status === 200)).toBe(true);
    expect(new Set(rs.map((r) => r.body.attempt.id)).size).toBe(1);
    expect(new Set(rs.map((r) => r.body.questions.map((q: any) => q.id).join())).size).toBe(1);
    expect(await ctx.prisma.attempt.count({ where: { student: { regNo: 'DMC-A-2024-0003' } } })).toBe(1);
  });

  it('question order is stable across reloads and differs between candidates', async () => {
    const a = await as(ctx, 'student.a004'); const b = await as(ctx, 'student.a005');
    const a1 = await startExam(ctx, a); const a2 = await startExam(ctx, a, cid());
    const b1 = await startExam(ctx, b);
    const ids = (x: typeof a1) => x.questions.map((q) => q.id).join();
    expect(ids(a1)).toBe(ids(a2));
    expect(ids(a1)).not.toBe(ids(b1));
  });
});

describe('answer saving', () => {
  it('persists, then returns the saved answer on resume (survives reload)', async () => {
    const s = await as(ctx, 'student.a006');
    const { attemptId, clientId, questions } = await startExam(ctx, s);
    const r = await save(s, attemptId, questions[0]!.id, clientId, 1, 'B');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ saved: true, revision: 1 });
    const row = await ctx.prisma.attemptAnswer.findFirstOrThrow({ where: { attemptId } });
    expect(row.selectedLabel).toBe('B');
    const resumed = await s.post('/attempts/start', { examId: ctx.seeded.examId, clientId: clientId });
    expect(resumed.body.answers).toEqual([expect.objectContaining({ selectedLabel: 'B', revision: 1, state: 'ANSWERED' })]);
  });

  it('is idempotent: replaying the same revision+payload returns saved without duplicating the journal', async () => {
    const s = await as(ctx, 'student.b002');
    const { attemptId, clientId, questions } = await startExam(ctx, s);
    const q = questions[1]!.id;
    expect((await save(s, attemptId, q, clientId, 1, 'C')).status).toBe(200);
    const again = await save(s, attemptId, q, clientId, 1, 'C');
    expect(again.status).toBe(200);
    expect(again.body.duplicate).toBe(true);
    expect(await ctx.prisma.answerEvent.count({ where: { attemptId } })).toBe(1);
  });

  it('rejects an older or conflicting revision with 409 STALE_REVISION and returns the server state', async () => {
    const s = await as(ctx, 'student.b003');
    const { attemptId, clientId, questions } = await startExam(ctx, s);
    const q = questions[2]!.id;
    await save(s, attemptId, q, clientId, 5, 'A');
    const older = await save(s, attemptId, q, clientId, 3, 'D');
    expect(older.status).toBe(409);
    expect(older.body.code).toBe('STALE_REVISION');
    expect(older.body.server).toMatchObject({ selectedLabel: 'A', revision: 5 });
    const clash = await save(s, attemptId, q, clientId, 5, 'D'); // same revision, different content
    expect(clash.status).toBe(409);
    expect((await ctx.prisma.attemptAnswer.findFirstOrThrow({ where: { attemptId } })).selectedLabel).toBe('A');
  });

  it('out-of-order concurrent writes converge on the highest revision (no lost update)', async () => {
    const s = await as(ctx, 'student.b004');
    const { attemptId, clientId, questions } = await startExam(ctx, s);
    const q = questions[3]!.id;
    const revs = Array.from({ length: 40 }, (_, i) => i + 1).sort(() => Math.random() - 0.5);
    const rs = await Promise.all(revs.map((rev) => save(s, attemptId, q, clientId, rev, label(rev))));
    expect(rs.every((r) => r.status === 200 || (r.status === 409 && r.body.code === 'STALE_REVISION'))).toBe(true);
    const row = await ctx.prisma.attemptAnswer.findFirstOrThrow({ where: { attemptId } });
    expect(row.revision).toBe(40);
    expect(row.selectedLabel).toBe(label(40));
    // every accepted write is journalled in strictly increasing revision order
    const ev = await ctx.prisma.answerEvent.findMany({ where: { attemptId }, orderBy: { id: 'asc' } });
    expect(ev.map((e) => e.revision)).toEqual([...ev.map((e) => e.revision)].sort((a, b) => a - b));
    expect(ev.at(-1)!.revision).toBe(40);
  });

  it('supports the full palette semantics: skip, mark for review, clear', async () => {
    const s = await as(ctx, 'student.b005');
    const { attemptId, clientId, questions } = await startExam(ctx, s);
    const q = questions[0]!.id;
    expect((await save(s, attemptId, q, clientId, 1, null, { state: 'SKIPPED' })).status).toBe(200);
    expect((await save(s, attemptId, q, clientId, 2, 'C', { markedForReview: true })).status).toBe(200);
    expect((await save(s, attemptId, q, clientId, 3, null, { state: 'CLEARED', markedForReview: true })).status).toBe(200);
    const row = await ctx.prisma.attemptAnswer.findFirstOrThrow({ where: { attemptId } });
    expect(row).toMatchObject({ state: 'CLEARED', selectedLabel: null, markedForReview: true, revision: 3 });
  });

  it('validates inputs: label must exist on the question, state/label must agree, ids must belong to the exam', async () => {
    const s = await as(ctx, 'student.b006');
    const { attemptId, clientId, questions } = await startExam(ctx, s);
    const q = questions[0]!.id;
    // make this one question a 4-option item so label E is invalid for it
    await ctx.prisma.$executeRaw`UPDATE exam_questions SET snapshot = jsonb_set(snapshot, '{options}', (snapshot->'options') - 4) WHERE id = ${q}::uuid`;
    expect((await save(s, attemptId, q, clientId, 1, 'E')).status).toBe(400); // label E does not exist on a 4-option question
    expect((await s.put(`/attempts/${attemptId}/answers/${q}`, { clientId, revision: 1, selectedLabel: 'A', state: 'SKIPPED', markedForReview: false, visited: true })).status).toBe(400);
    expect((await s.put(`/attempts/${attemptId}/answers/${q}`, { clientId, revision: 1, selectedLabel: null, state: 'ANSWERED', markedForReview: false, visited: true })).status).toBe(400);
    expect((await save(s, attemptId, '00000000-0000-4000-8000-000000000000', clientId, 1, 'A')).status).toBe(400);
    expect((await save(s, attemptId, q, clientId, 0, 'A')).status).toBe(400);
    expect((await save(s, attemptId, q, clientId, 1, 'A; DROP TABLE attempts;--' as never)).status).toBe(400);
  });
});

describe('stale tabs and takeover', () => {
  it('a second window claiming the attempt makes the first window read-only (SESSION_SUPERSEDED)', async () => {
    const s = await as(ctx, 'student.b006');
    const tab1 = cid(); const tab2 = cid();
    const { attemptId, questions } = await startExam(ctx, s, tab1);
    expect((await save(s, attemptId, questions[0]!.id, tab1, 1, 'A')).status).toBe(200);
    await s.post('/attempts/start', { examId: ctx.seeded.examId, clientId: tab2 });
    const stale = await save(s, attemptId, questions[0]!.id, tab1, 2, 'B');
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('SESSION_SUPERSEDED');
    expect((await save(s, attemptId, questions[0]!.id, tab2, 2, 'B')).status).toBe(200);
    expect((await ctx.prisma.attemptAnswer.findFirstOrThrow({ where: { attemptId } })).selectedLabel).toBe('B');
    const hb = await s.post(`/attempts/${attemptId}/heartbeat`, { clientId: tab1 });
    expect(hb.body.superseded).toBe(true);
  });

  it("another student cannot save into, read or submit someone else's attempt (IDOR)", async () => {
    const victim = await as(ctx, 'student.a002'); const attacker = await as(ctx, 'student.a005');
    const v = await victim.post('/attempts/start', { examId: ctx.seeded.examId, clientId: cid() });
    const attemptId = v.body.attempt.id; const q = v.body.questions[0].id;
    const atk = cid();
    await attacker.post('/attempts/start', { examId: ctx.seeded.examId, clientId: atk });
    expect([404, 409]).toContain((await save(attacker, attemptId, q, atk, 1, 'A')).status);
    expect((await attacker.get(`/attempts/${attemptId}/sheet`)).status).toBe(404);
    expect((await attacker.post(`/attempts/${attemptId}/submit`, { clientId: atk, submitKey: 'attack-key-0001' })).status).toBe(404);
    expect((await attacker.get(`/attempts/${attemptId}/receipt`)).status).toBe(404);
  });
});

describe('submission', () => {
  it('seals once: 12 concurrent submits yield one receipt; replays return the identical receipt', async () => {
    const s2 = await as(ctx, 'student.a006');
    const a = await ctx.prisma.attempt.findFirstOrThrow({ where: { student: { regNo: 'DMC-A-2024-0006' } } });
    const cl = a.activeClientId!;
    const rs = await Promise.all(Array.from({ length: 12 }, (_, i) => s2.post(`/attempts/${a.id}/submit`, { clientId: cl, submitKey: `submit-key-${i}-xxxx` })));
    expect(rs.every((r) => r.status === 200)).toBe(true);
    expect(new Set(rs.map((r) => r.body.receiptCode)).size).toBe(1);
    expect(rs.filter((r) => !r.body.replayed)).toHaveLength(1);
    expect(rs[0]!.body.receiptCode).toMatch(/^RC-[0-9A-F]{4}(-[0-9A-F]{4}){3}$/);
    const later = await s2.post(`/attempts/${a.id}/submit`, { clientId: cl, submitKey: 'another-key-9999' });
    expect(later.body.receiptCode).toBe(rs[0]!.body.receiptCode);
    expect(later.body.replayed).toBe(true);
  });

  it('after submission no save is accepted (API and database both refuse)', async () => {
    const s = await as(ctx, 'student.a006');
    const a = await ctx.prisma.attempt.findFirstOrThrow({ where: { student: { regNo: 'DMC-A-2024-0006' } } });
    const eq = await ctx.prisma.examQuestion.findFirstOrThrow({ where: { examId: a.examId } });
    const r = await save(s, a.id, eq.id, a.activeClientId!, 99, 'A');
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('ATTEMPT_CLOSED');
    // Bypass the API entirely: the trigger must still block writes to a sealed sheet.
    await expect(ctx.prisma.$executeRaw`UPDATE attempt_answers SET "selectedLabel" = 'D', state = 'ANSWERED' WHERE "attemptId" = ${a.id}::uuid`).rejects.toThrow(/immutable|finalised/);
    await expect(ctx.prisma.$executeRaw`INSERT INTO attempt_answers ("attemptId","examQuestionId","selectedLabel",state,"markedForReview",visited,revision) VALUES (${a.id}::uuid, ${eq.id}::uuid, 'A', 'ANSWERED', false, true, 500)`).rejects.toThrow(/immutable|finalised/);
    expect((await s.post('/attempts/start', { examId: ctx.seeded.examId, clientId: cid() })).body.code).toBe('ALREADY_SUBMITTED');
  });

  it('a save racing a submit is either fully included in the receipt or rejected — never "saved" yet missing', async () => {
    const s = await as(ctx, 'student.b002');
    const a = await ctx.prisma.attempt.findFirstOrThrow({ where: { student: { regNo: 'DMC-B-2024-0002' } } });
    const cl = a.activeClientId!;
    const eqs = await ctx.prisma.examQuestion.findMany({ where: { examId: a.examId }, orderBy: { position: 'asc' } });
    const savers = eqs.map((q, i) => save(s, a.id, q.id, cl, 10 + i, 'A'));
    const sub = s.post(`/attempts/${a.id}/submit`, { clientId: cl, submitKey: 'race-submit-0001' });
    const results = await Promise.all([...savers, sub]);
    const final = await ctx.prisma.attemptAnswer.findMany({ where: { attemptId: a.id } });
    const acked = results.slice(0, eqs.length).map((r, i) => ({ r, q: eqs[i]! })).filter((x) => x.r.status === 200);
    for (const { q } of acked) expect(final.find((f) => f.examQuestionId === q.id)?.selectedLabel).toBeTruthy(); // every "Saved" is durable
    const att = await ctx.prisma.attempt.findUniqueOrThrow({ where: { id: a.id } });
    const { answerDigest } = await import('@oes/shared/server');
    const am = new Map(final.map((f) => [f.examQuestionId, f]));
    expect(att.answerDigest).toBe(answerDigest(eqs.map((q) => ({ examQuestionId: q.id, selectedLabel: am.get(q.id)?.selectedLabel ?? null, revision: am.get(q.id)?.revision ?? 0 }))));
  });

  it('refuses to seal when the client screen disagrees with the database (ANSWERS_OUT_OF_SYNC)', async () => {
    const s = await as(ctx, 'student.b003');
    const a = await ctx.prisma.attempt.findFirstOrThrow({ where: { student: { regNo: 'DMC-B-2024-0003' } } });
    const stored = await ctx.prisma.attemptAnswer.findMany({ where: { attemptId: a.id } });
    const expected = stored.map((x) => ({ examQuestionId: x.examQuestionId, revision: x.revision, selectedLabel: x.selectedLabel }));
    expected[0] = { ...expected[0]!, selectedLabel: 'E' }; // browser believes something else
    const r = await s.post(`/attempts/${a.id}/submit`, { clientId: a.activeClientId, submitKey: 'sync-check-0001', expected });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('ANSWERS_OUT_OF_SYNC');
    expect((await ctx.prisma.attempt.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('IN_PROGRESS');
    const ok = await s.post(`/attempts/${a.id}/submit`, { clientId: a.activeClientId, submitKey: 'sync-check-0002', expected: stored.map((x) => ({ examQuestionId: x.examQuestionId, revision: x.revision, selectedLabel: x.selectedLabel })) });
    expect(ok.status).toBe(200);
  });

  it('receipt endpoint returns the sealed receipt to the owner only', async () => {
    const s = await as(ctx, 'student.a006'); const other = await as(ctx, 'student.a002');
    const a = await ctx.prisma.attempt.findFirstOrThrow({ where: { student: { regNo: 'DMC-A-2024-0006' } } });
    const r = await s.get(`/attempts/${a.id}/receipt`);
    expect(r.status).toBe(200);
    expect(r.body.receiptCode).toBe(a.receiptCode);
    expect((await other.get(`/attempts/${a.id}/receipt`)).status).toBe(404);
  });
});

describe('server-controlled time', () => {
  it('rejects saves after the deadline+grace and auto-submits on the next lifecycle tick', async () => {
    const s = await as(ctx, 'student.a002');
    const a = await ctx.prisma.attempt.findFirstOrThrow({ where: { student: { regNo: 'DMC-A-2024-0002' } } });
    const eq = await ctx.prisma.examQuestion.findFirstOrThrow({ where: { examId: a.examId } });
    expect((await save(s, a.id, eq.id, a.activeClientId!, 1, 'A')).status).toBe(200);
    // Simulate the clock passing the deadline by moving the deadline into the past (DB clock is the authority).
    await ctx.prisma.$executeRaw`UPDATE attempts SET "startedAt" = now() - interval '2 hours', "deadlineAt" = now() - interval '1 minute' WHERE id = ${a.id}::uuid`;
    const late = await save(s, a.id, eq.id, a.activeClientId!, 2, 'B');
    expect(late.status).toBe(409);
    expect(late.body.code).toBe('TIME_EXPIRED');
    const { JobsService } = await import('../src/modules/jobs.service');
    const stats = await ctx.app.get(JobsService).runTick();
    expect(stats.autoSubmitted).toBeGreaterThanOrEqual(1);
    const done = await ctx.prisma.attempt.findUniqueOrThrow({ where: { id: a.id } });
    expect(done.status).toBe('AUTO_SUBMITTED');
    expect(done.receiptCode).toBeTruthy();
    const row = await ctx.prisma.attemptAnswer.findFirstOrThrow({ where: { attemptId: a.id } });
    expect(row.selectedLabel).toBe('A'); // the late write never landed
  });

  it('heartbeat reports the authoritative deadline and server time', async () => {
    const s = await as(ctx, 'student.a004');
    const a = await ctx.prisma.attempt.findFirstOrThrow({ where: { student: { regNo: 'DMC-A-2024-0004' } } });
    const hb = await s.post(`/attempts/${a.id}/heartbeat`, { clientId: a.activeClientId });
    expect(hb.status).toBe(200);
    expect(new Date(hb.body.deadlineAt).getTime()).toBe(a.deadlineAt.getTime());
    expect(Math.abs(new Date(hb.body.serverNow).getTime() - Date.now())).toBeLessThan(5000);
  });

  it('cannot start before the exam opens or after it closes', async () => {
    await ctx.prisma.exam.update({ where: { id: ctx.seeded.examId }, data: { opensAt: new Date(Date.now() + 3600_000), closesAt: new Date(Date.now() + 7200_000) } });
    const fresh = await as(ctx, 'student.a003');
    await ctx.prisma.attempt.deleteMany({ where: { student: { regNo: 'DMC-A-2024-0003' } } });
    const early = await fresh.post('/attempts/start', { examId: ctx.seeded.examId, clientId: cid() });
    expect(early.status).toBe(409);
    expect(early.body.code).toBe('NOT_OPEN');
    await ctx.prisma.exam.update({ where: { id: ctx.seeded.examId }, data: { opensAt: new Date(Date.now() - 7200_000), closesAt: new Date(Date.now() - 3600_000) } });
    const late = await fresh.post('/attempts/start', { examId: ctx.seeded.examId, clientId: cid() });
    expect(late.body.code).toBe('CLOSED');
  });
});
