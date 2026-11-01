import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { as as login, boot, cid, type Client, type Ctx } from './helpers';
import { DOMAIN, TERM, asUser } from '../src/seed/seed';
import { ExamsService } from '../src/modules/exams/exams.service';

/** Server-Sent Events over a REAL socket: scoping, replay by cursor, de-duplication, caps. */
let ctx: Ctx; let A: string; let B: string; let port = 0; let seq = 0; let examId: string; let cce: Client;
const sessions = new Map<string, Client>();
const as = async (l: string) => { let s = sessions.get(l); if (!s) { s = await login(ctx, l); sessions.set(l, s); } return s; };
const ahead = (ms: number) => new Date(Date.now() + ms);
const ctl = (cmd: string) => `/exams/${examId}/control/${cmd}`;

interface Frame { id?: number; event: string; data: any }
/** Minimal SSE reader: parses frames as they arrive and lets a test wait for one. */
async function open(path: string, cookie: string, headers: Record<string, string> = {}) {
  const ac = new AbortController(); const frames: Frame[] = [];
  const res = await fetch(`http://127.0.0.1:${port}/api${path}`, { headers: { cookie, ...headers }, signal: ac.signal });
  if (!res.ok || !res.body) return { status: res.status, frames, close: () => ac.abort(), waitFor: async () => undefined as Frame | undefined, res };
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
  void (async () => { try { for (;;) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true });
    let i; while ((i = buf.indexOf('\n\n')) >= 0) { const raw = buf.slice(0, i); buf = buf.slice(i + 2); if (raw.startsWith(':') || raw.startsWith('retry')) continue;
      const f: Frame = { event: 'message', data: null }; for (const line of raw.split('\n')) { if (line.startsWith('id: ')) f.id = Number(line.slice(4)); else if (line.startsWith('event: ')) f.event = line.slice(7); else if (line.startsWith('data: ')) f.data = JSON.parse(line.slice(6)); } frames.push(f); } } } catch { /* closed */ } })();
  const waitFor = async (pred: (f: Frame) => boolean, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { const f = frames.find(pred); if (f) return f; await new Promise((r) => setTimeout(r, 40)); } return undefined; };
  return { status: res.status, frames, close: () => ac.abort(), waitFor, res };
}
const quiet = (ms = 900) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  ctx = await boot({ studentsPerCampus: 6 }); await ctx.app.listen(0, '127.0.0.1'); port = (ctx.app.getHttpServer().address() as AddressInfo).port;
  A = ctx.seeded.institutions.a.id; B = ctx.seeded.institutions.b.id; cce = await as('cce');
  const esvc = ctx.app.get(ExamsService); const rev = await asUser(ctx.prisma, `examiner@${DOMAIN}`); const cceU = await asUser(ctx.prisma, `cce@${DOMAIN}`); const sa = await asUser(ctx.prisma, `super.admin@${DOMAIN}`);
  const e = await esvc.create(rev, { code: `STR-${++seq}`, title: 'Stream exam', courseId: ctx.seeded.courses.path.id, term: TERM, opensAt: ahead(3600_000), closesAt: ahead(86400_000), durationMin: 45, passPercent: 50, negativeMarking: 0, shuffleQuestions: true, institutionIds: [A, B], controlMode: 'MANUAL' });
  await esvc.setPaper(sa, e.id, ctx.seeded.questionIds.PATH.slice(0, 3).map((questionId) => ({ questionId, marks: 2 })));
  await esvc.submitPaper(rev, e.id); await esvc.reviewPaper(cceU, e.id, 'APPROVE', 'ok'); await esvc.schedule(rev, e.id); examId = e.id;
  await ctx.prisma.exam.update({ where: { id: examId }, data: { suspendTimePolicy: 'FREEZE_CLOCK', controlPolicyApprovedBy: sa.id, controlPolicyApprovedAt: new Date() } });
  for (const [l, inst] of [['invigilator.a', A], ['invigilator.b', B]] as const) await ctx.prisma.examInvigilator.create({ data: { examId, userId: (await ctx.prisma.user.findFirstOrThrow({ where: { email: `${l}@${DOMAIN}` } })).id, institutionId: inst } });
}, 120_000);
afterAll(async () => { await ctx.app.close(); });

describe('staff stream', () => {
  it('opens with an authoritative stats snapshot, then pushes committed control events with their cursor id', async () => {
    const s = await open(`/invigilation/exams/${examId}/stream`, (await as('cce')).cookie);
    expect(s.status).toBe(200); expect(s.res.headers.get('content-type')).toMatch(/text\/event-stream/); expect(s.res.headers.get('cache-control')).toMatch(/no-transform/);
    const stats = await s.waitFor((f) => f.event === 'stats'); expect(stats?.data).toMatchObject({ examId, status: 'SCHEDULED', scope: { universityWide: true } }); expect(stats!.data.campuses.length).toBe(2);
    expect((await cce.post(ctl('open-admission'), {})).body.changed).toBe(true);
    const ev = await s.waitFor((f) => f.event === 'ADMISSION_OPENED'); expect(ev).toBeTruthy(); expect(typeof ev!.id).toBe('number');
    expect(ev!.data).toMatchObject({ type: 'ADMISSION_OPENED', version: expect.any(Number) });
    const upd = await s.waitFor((f) => f.event === 'stats' && f.data.status === 'ADMISSION_OPEN'); expect(upd).toBeTruthy();            // the snapshot follows the state
    s.close();
  });

  it('a reconnecting client resumes from its cursor: it receives exactly the events it missed, once, in order', async () => {
    const first = await open(`/invigilation/exams/${examId}/stream`, cce.cookie); const base = await first.waitFor((f) => f.event === 'stats'); const cursor = base!.data.cursor as number; first.close();
    expect((await cce.post(ctl('close-admission'), {})).body.changed).toBe(true);          // happens while NOBODY is connected
    expect((await cce.post(ctl('open-admission'), {})).body.changed).toBe(true);
    const back = await open(`/invigilation/exams/${examId}/stream`, cce.cookie, { 'last-event-id': String(cursor) });
    await back.waitFor((f) => f.event === 'ADMISSION_OPENED'); await quiet();
    const missed = back.frames.filter((f) => f.id !== undefined);
    expect(missed.map((f) => f.event)).toEqual(['ADMISSION_CLOSED', 'ADMISSION_OPENED']);
    expect(new Set(missed.map((f) => f.id)).size).toBe(2); expect(missed[0]!.id!).toBeGreaterThan(cursor); expect(missed[0]!.id!).toBeLessThan(missed[1]!.id!);
    const viaQuery = await open(`/invigilation/exams/${examId}/stream?after=${cursor}`, cce.cookie); await viaQuery.waitFor((f) => f.event === 'ADMISSION_OPENED'); await quiet(300);
    expect(viaQuery.frames.filter((f) => f.id !== undefined).length).toBe(2); back.close(); viaQuery.close();
  });

  it('campus scoping: campus staff never receive another campus’s targeted events; exam-wide events reach everyone in scope', async () => {
    await cce.post(ctl('start'), {});
    const sa = await (await as('student.a002')).post('/attempts/start', { examId, clientId: cid() }); const sb = await (await as('student.b002')).post('/attempts/start', { examId, clientId: cid() });
    expect(sa.status).toBe(200); expect(sb.status).toBe(200);
    const invA = await open(`/invigilation/exams/${examId}/stream`, (await as('invigilator.a')).cookie); const invB = await open(`/invigilation/exams/${examId}/stream`, (await as('invigilator.b')).cookie); const all = await open(`/invigilation/exams/${examId}/stream`, cce.cookie);
    await Promise.all([invA, invB, all].map((x) => x.waitFor((f) => f.event === 'stats')));
    const sus = await cce.post(ctl('suspend'), { scope: 'CAMPUS', institutionId: B, reason: 'Campus B network outage', confirm: true }); expect(sus.body.changed).toBe(true);
    expect(await all.waitFor((f) => f.event === 'EXAM_SUSPENDED')).toBeTruthy(); expect(await invB.waitFor((f) => f.event === 'EXAM_SUSPENDED')).toBeTruthy();
    await quiet(1500);
    expect(invA.frames.some((f) => f.event === 'EXAM_SUSPENDED')).toBe(false);                                   // A’s staff do not see B’s targeted event
    expect(JSON.stringify(invA.frames)).not.toMatch(/DMC-B|Demo Medical College B/);
    await cce.post(ctl('resume'), { confirm: true, suspensionId: sus.body.suspensionId });
    expect(await invB.waitFor((f) => f.event === 'EXAM_RESUMED')).toBeTruthy(); await quiet(500); expect(invA.frames.some((f) => f.event === 'EXAM_RESUMED')).toBe(false);
    await cce.post(ctl('extend'), { scope: 'EXAM', minutes: 5, reason: 'Exam-wide extension for the stream test', confirm: true, idempotencyKey: 'stream-ext-0001' });
    expect(await invA.waitFor((f) => f.event === 'DEADLINE_EXTENDED')).toBeTruthy(); expect(await invB.waitFor((f) => f.event === 'DEADLINE_EXTENDED')).toBeTruthy();   // exam-wide: both
    for (const x of [invA, invB, all]) x.close();
  });

  it('authorization: anonymous 401, wrong role 403, unassigned or foreign staff 404; at most 4 concurrent streams per user', async () => {
    expect((await fetch(`http://127.0.0.1:${port}/api/invigilation/exams/${examId}/stream`)).status).toBe(401);
    expect((await open(`/invigilation/exams/${examId}/stream`, (await as('lecturer.a')).cookie)).status).toBe(403);
    expect((await open(`/invigilation/exams/${examId}/stream`, (await as('student.a002')).cookie)).status).toBe(403);
    await ctx.prisma.examInvigilator.deleteMany({ where: { examId, institutionId: B } });
    expect((await open(`/invigilation/exams/${examId}/stream`, (await as('invigilator.b')).cookie)).status).toBe(404);
    const opened = []; for (let i = 0; i < 4; i++) { const o = await open(`/invigilation/exams/${examId}/stream`, (await as('super.admin')).cookie); expect(o.status).toBe(200); opened.push(o); }
    expect((await open(`/invigilation/exams/${examId}/stream`, (await as('super.admin')).cookie)).status).toBe(429);
    opened.forEach((o) => o.close()); await quiet(300);
    const again = await open(`/invigilation/exams/${examId}/stream`, (await as('super.admin')).cookie); expect(again.status).toBe(200); again.close();   // slot freed on close
  });
});

describe('candidate stream', () => {
  it('a candidate gets state + events relevant to THEM only, with no answer-key fields; unrelated candidates and outsiders are refused', async () => {
    const a = await open(`/me/exams/${examId}/stream`, (await as('student.a002')).cookie); const b = await open(`/me/exams/${examId}/stream`, (await as('student.b002')).cookie);
    expect((await a.waitFor((f) => f.event === 'state'))?.data).toMatchObject({ status: expect.any(String), stateVersion: expect.any(Number) });
    await b.waitFor((f) => f.event === 'state');
    const sidA = (await ctx.prisma.student.findFirstOrThrow({ where: { regNo: 'DMC-A-2024-0002' } })).id;
    const r = await cce.post(ctl('suspend'), { scope: 'CANDIDATES', studentIds: [sidA], reason: 'Candidate-specific incident', confirm: true }); expect(r.body.changed).toBe(true);
    const got = await a.waitFor((f) => f.event === 'EXAM_SUSPENDED'); expect(got).toBeTruthy(); expect(got!.data.payload.scope).toBe('CANDIDATES');
    await quiet(1200); expect(b.frames.some((f) => f.event === 'EXAM_SUSPENDED')).toBe(false);                    // not targeted at candidate B
    const body = JSON.stringify(a.frames); expect(body).not.toMatch(/"(correctLabel|isCorrect|correct|answerKey|key)"\s*:/); expect(body).not.toContain('reason');       // internal reasons are not broadcast
    await cce.post(ctl('resume'), { confirm: true, suspensionId: r.body.suspensionId });
    expect(await a.waitFor((f) => f.event === 'EXAM_RESUMED')).toBeTruthy();
    expect((await open(`/me/exams/${examId}/stream`, (await as('student.a001')).cookie)).status).toBe(404);          // not on the roster
    expect((await open(`/me/exams/${examId}/stream`, (await as('admin.a')).cookie)).status).toBe(403);
    a.close(); b.close();
  });
  it('/me/exams/:id/state is the authoritative fallback a client reads after missing events', async () => {
    const st = await (await as('student.a002')).get(`/me/exams/${examId}/state`);
    expect(st.status).toBe(200); expect(st.body).toMatchObject({ status: 'LIVE', admissionOpen: true, timingPolicy: 'INDIVIDUAL' }); expect(st.body.stateVersion).toBeGreaterThan(0);
    expect((await (await as('student.a001')).get(`/me/exams/${examId}/state`)).status).toBe(404);
  });
});
