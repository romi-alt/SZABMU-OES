import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, DisposableMariaDb, DisposableRedis, REPO_DIR, Student, migrateAndSeed, sleep, until, type DbPool } from './harness';

/**
 * Exam-control resilience on DISPOSABLE infrastructure: Redis lost, an API process killed and restarted, two workers, leader failover.
 * Invariants: saving continues; the API itself refuses expired writes; the database-driven reconciler still seals expired attempts exactly
 * once; control events stay durable (outbox) and reach SSE clients from the database while Redis is down, and are published after it returns.
 */
let db: DisposableMariaDb; let redis: DisposableRedis; let api: Api; let apiB: Api | undefined; let pool: DbPool; let examId: string; let qids: string[] = []; let infra: { DATABASE_URL: string; REDIS_URL: string };
const cid = () => 'c' + Math.random().toString(36).slice(2, 12);
const WORKERS = { RUN_WORKERS: 'true', LIFECYCLE_INTERVAL_MS: '700', LIFECYCLE_LEASE_SECONDS: '4' };

async function sit(local: string, base = api.base) { const s = await new Student(base, local).login(); const clientId = cid(); const r = await s.call('POST', '/attempts/start', { examId, clientId }); if (r.status !== 200) throw new Error(`start ${local}: ${r.status} ${JSON.stringify(r.body)}`); return { s, clientId, attemptId: r.body.attempt.id as string }; }
const put = (x: { s: Student; clientId: string; attemptId: string }, qi: number, rev: number, l = 'A') => x.s.call('PUT', `/attempts/${x.attemptId}/answers/${qids[qi]}`, { clientId: x.clientId, revision: rev, selectedLabel: l, state: 'ANSWERED', markedForReview: false, visited: true });
const expire = (ids: string[]) => pool.query(`UPDATE attempts SET "startedAt" = clock_timestamp() - interval '3 hours', "deadlineAt" = clock_timestamp() - interval '2 minutes' WHERE id = ANY($1::uuid[])`, [ids]);
const status = async (id: string) => (await pool.query(`SELECT status, "receiptCode" FROM attempts WHERE id = $1`, [id])).rows[0] as { status: string; receiptCode: string | null };
const sealedEvents = async (id: string) => (await pool.query(`SELECT count(*)::int n FROM attempt_events WHERE "attemptId" = $1 AND kind = 'AUTO_SUBMITTED'`, [id])).rows[0].n as number;

interface Frame { id?: number; event: string; data: any }
async function sse(base: string, path: string, cookie: string, lastId?: number) {
  const ac = new AbortController(); const frames: Frame[] = [];
  const res = await fetch(`${base}${path}`, { headers: { cookie, ...(lastId !== undefined ? { 'last-event-id': String(lastId) } : {}) }, signal: ac.signal });
  const reader = res.body!.getReader(); const dec = new TextDecoder(); let buf = '';
  void (async () => { try { for (;;) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true }); let i; while ((i = buf.indexOf('\n\n')) >= 0) { const raw = buf.slice(0, i); buf = buf.slice(i + 2); if (raw.startsWith(':') || raw.startsWith('retry')) continue; const f: Frame = { event: 'message', data: null }; for (const l of raw.split('\n')) { if (l.startsWith('id: ')) f.id = Number(l.slice(4)); else if (l.startsWith('event: ')) f.event = l.slice(7); else if (l.startsWith('data: ')) f.data = JSON.parse(l.slice(6)); } frames.push(f); } } } catch { /* closed */ } })();
  return { status: res.status, frames, close: () => ac.abort(), waitFor: (p: (f: Frame) => boolean, ms = 10_000) => until('sse frame', async () => frames.find(p), ms, 50) };
}

beforeAll(async () => {
  execFileSync('npm', ['run', 'build:shared'], { cwd: REPO_DIR, stdio: 'pipe' }); execFileSync('npm', ['run', 'build', '-w', '@oes/api'], { cwd: REPO_DIR, stdio: 'pipe' });
  db = new DisposableMariaDb(); await db.init(); redis = new DisposableRedis(); await redis.start(); infra = { DATABASE_URL: db.url, REDIS_URL: redis.url };
  process.env.SEED_STUDENTS_PER_CAMPUS = '10'; migrateAndSeed(infra);
  api = new Api(infra, 'dist/main.js', WORKERS); await api.start(); pool = db.pool();
  examId = (await pool.query(`SELECT id FROM exams WHERE code = 'MBBS-PATH-MT'`)).rows[0].id;
  qids = (await pool.query(`SELECT id FROM exam_questions WHERE "examId" = $1 ORDER BY position`, [examId])).rows.map((r) => r.id);
  await pool.query(`UPDATE exams SET "suspendTimePolicy" = 'FREEZE_CLOCK', "controlPolicyApprovedAt" = clock_timestamp(), "controlPolicyApprovedBy" = (SELECT id FROM users WHERE email LIKE 'super.admin@%')`);
}, 300_000);
afterAll(async () => { try { await db?.closePools(); await apiB?.kill(); await api?.kill(); await redis?.kill(); await db?.destroy(); } finally { db?.errors.assertClean(); } });

describe('Redis lost while an examination is running', () => {
  it('answer saving continues; the database-driven reconciler seals an expired attempt exactly once; control events stay durable and reach SSE from the database; they are published when Redis returns', async () => {
    const cce = await new Student(api.base, 'cce').login();
    const stream = await sse(api.base, `/invigilation/exams/${examId}/stream`, cce.cookie); expect(stream.status).toBe(200);
    await stream.waitFor((f) => f.event === 'stats');
    const [a, b, c] = [await sit('student.a002'), await sit('student.a003'), await sit('student.a004')];
    for (const x of [a, b, c]) expect((await put(x, 0, 1)).status).toBe(200);

    redis.kill();                                                               // ── Redis is gone ──
    await sleep(500);
    for (const x of [a, b, c]) { const r = await put(x, 1, 1, 'B'); expect(r.status, JSON.stringify(r.body)).toBe(200); }          // 1. answer saving continues
    const health = await api.health(); expect(health?.db).toBe(true);

    await expire([a.attemptId]);                                                // 2. the deadline passes with Redis down
    const late = await put(a, 2, 1, 'C'); expect(late.status).toBe(409); expect(late.body.code).toBe('TIME_EXPIRED');                 // the API refuses by itself, whether or not any worker has run
    await until('auto-submit by the database reconciler', async () => (await status(a.attemptId)).status === 'AUTO_SUBMITTED', 20_000, 250);
    expect((await status(a.attemptId)).receiptCode).toMatch(/^RC-/); expect(await sealedEvents(a.attemptId)).toBe(1);
    await sleep(2500); expect(await sealedEvents(a.attemptId)).toBe(1);        // further reconciler passes never seal it twice

    const ext = await cce.call('POST', `/exams/${examId}/control/extend`, { scope: 'EXAM', minutes: 5, reason: 'Redis outage drill — extension is a durable command', confirm: true, idempotencyKey: 'redis-outage-ext-1' });
    expect(ext.status, JSON.stringify(ext.body)).toBe(200); expect(ext.body.changed).toBe(true);                                      // 3. control commands work without Redis
    const ev = await stream.waitFor((f) => f.event === 'DEADLINE_EXTENDED', 12_000); expect(ev.id).toBeGreaterThan(0);               // 4. delivered to SSE from the database
    const pending = (await pool.query(`SELECT count(*)::int n FROM exam_events WHERE "deliveryStatus" = 'PENDING' AND "examId" = $1`, [examId])).rows[0].n; expect(pending).toBeGreaterThan(0);   // not publishable while Redis is down
    const view = await cce.call('GET', `/exams/${examId}/control`);
    expect(view.body.health.redis.available).toBe(false); expect(view.body.snapshot.freshness.degraded).toBe(true); expect(view.body.snapshot.totals.online).toBeNull();   // honest degradation, no invented numbers
    expect(view.body.snapshot.totals.inProgress).toBeGreaterThanOrEqual(2);     // DB-derived counts still correct

    await redis.start();                                                        // ── Redis returns ──
    await until('outbox drained after Redis returned', async () => (await pool.query(`SELECT count(*)::int n FROM exam_events WHERE "deliveryStatus" = 'PENDING'`)).rows[0].n === 0, 30_000, 500);
    expect((await pool.query(`SELECT count(*)::int n FROM exam_events WHERE "deliveryStatus" = 'FAILED'`)).rows[0].n).toBe(0);
    expect((await put(b, 2, 1, 'C')).status).toBe(200);                         // and the exam carried on throughout
    stream.close();
  });
});

describe('API process killed and restarted with a backlog', () => {
  it('restart reconciles the backlog immediately; a client resumes from its cursor; nothing is lost or sealed twice', async () => {
    const cce = await new Student(api.base, 'cce').login();
    const snap0 = (await cce.call('GET', `/invigilation/exams/${examId}/snapshot`)).body; const cursor0 = snap0.cursor as number;
    expect((await cce.call('POST', `/exams/${examId}/control/extend`, { scope: 'EXAM', minutes: 3, reason: 'Issued after the client cursor, before the crash', confirm: true, idempotencyKey: 'restart-ext-0001' })).status).toBe(200);
    const x = [await sit('student.a005'), await sit('student.a006'), await sit('student.b002')];
    for (const s of x) expect((await put(s, 0, 1, 'D')).status).toBe(200);
    await api.kill('SIGKILL');                                                   // the only API (and worker) dies
    await expire(x.map((s) => s.attemptId));                                    // deadlines pass while nobody is running
    await sleep(1500); for (const s of x) expect((await status(s.attemptId)).status).toBe('IN_PROGRESS');
    await api.start();                                                           // restart: same disposable infra
    await until('backlog sealed right after restart', async () => (await Promise.all(x.map((s) => status(s.attemptId)))).every((r) => r.status === 'AUTO_SUBMITTED'), 20_000, 300);
    for (const s of x) { expect(await sealedEvents(s.attemptId)).toBe(1); expect((await pool.query(`SELECT "selectedLabel" FROM attempt_answers WHERE "attemptId" = $1 AND "examQuestionId" = $2`, [s.attemptId, qids[0]])).rows[0].selectedLabel).toBe('D'); }
    const cce2 = await new Student(api.base, 'cce').login();
    const s2 = await sse(api.base, `/invigilation/exams/${examId}/stream`, cce2.cookie, cursor0);               // reconnect with the cursor from before the crash
    const replayed = await s2.waitFor((f) => f.event === 'DEADLINE_EXTENDED'); expect(replayed.id).toBeGreaterThan(cursor0);   // missed events are replayed from the database
    const stats = await s2.waitFor((f) => f.event === 'stats'); expect(stats.data.cursor).toBeGreaterThanOrEqual(cursor0);
    s2.close();
  });
});

describe('two workers and leader failover', () => {
  it('both API processes run the reconciler, each attempt is sealed exactly once, and when the leader is killed the other takes over', async () => {
    apiB = new Api(infra, 'dist/main.js', WORKERS); await apiB.start();
    const batch = [await sit('student.b003'), await sit('student.b004'), await sit('student.b005'), await sit('student.b006'), await sit('student.b007')];
    await expire(batch.map((s) => s.attemptId));
    await until('both sealed', async () => (await Promise.all(batch.map((s) => status(s.attemptId)))).every((r) => r.status === 'AUTO_SUBMITTED'), 20_000, 300);
    for (const s of batch) expect(await sealedEvents(s.attemptId)).toBe(1);
    expect(new Set((await Promise.all(batch.map((s) => status(s.attemptId)))).map((r) => r.receiptCode)).size).toBe(batch.length);
    const owner = (await pool.query(`SELECT owner FROM lifecycle_leases WHERE name = 'lifecycle'`)).rows[0].owner as string;
    const leader = owner.includes(`:${api.proc?.pid}:`) ? api : apiB; const survivor = leader === api ? apiB : api; expect([api.proc?.pid, apiB.proc?.pid].some((p) => owner.includes(`:${p}:`))).toBe(true);
    await leader.kill('SIGKILL');                                               // the lease holder dies without releasing anything
    const next = await sit('student.b008', survivor.base); await expire([next.attemptId]);
    await until('survivor took over the lease and sealed', async () => (await status(next.attemptId)).status === 'AUTO_SUBMITTED', 30_000, 300);
    expect(await sealedEvents(next.attemptId)).toBe(1);
    const newOwner = (await pool.query(`SELECT owner FROM lifecycle_leases WHERE name = 'lifecycle'`)).rows[0].owner as string; expect(newOwner).toContain(`:${survivor.proc?.pid}:`);
    const runs = (await pool.query(`SELECT count(*)::int n FROM lifecycle_runs WHERE error IS NULL AND "finishedAt" IS NOT NULL`)).rows[0].n; expect(runs).toBeGreaterThan(5);
  });
});
