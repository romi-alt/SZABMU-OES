import { execFileSync } from 'node:child_process';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, DisposablePg, DisposableRedis, DropProxy, REPO_DIR, Student, migrateAndSeed, sleep, until } from './harness';

/**
 * Durability fault injection against a DISPOSABLE stack (own PostgreSQL cluster, Redis and API processes).
 * Invariant under test: if the API said `saved: true` (or returned a receipt), the data is in PostgreSQL after ANY of
 * these faults, no journal/answer row is torn, and a retry converges without duplicates.
 */
let db: DisposablePg; let redis: DisposableRedis; let api: Api; let proxy: DropProxy; let pool: pg.Pool; let examId: string; let qids: string[] = [];
const cid = () => 'c' + Math.random().toString(36).slice(2, 12);
const label = (qi: number, rev: number) => 'ABCD'[(qi + rev) % 4]!;

beforeAll(async () => {
  execFileSync('npm', ['run', 'build:shared'], { cwd: REPO_DIR, stdio: 'pipe' });
  execFileSync('npm', ['run', 'build', '-w', '@oes/api'], { cwd: REPO_DIR, stdio: 'pipe' });
  db = new DisposablePg(); await db.init();
  redis = new DisposableRedis(); await redis.start();
  const infra = { DATABASE_URL: db.url, REDIS_URL: redis.url };
  process.env.SEED_STUDENTS_PER_CAMPUS = '24';
  migrateAndSeed(infra);
  api = new Api(infra); await api.start();
  proxy = new DropProxy(() => api.port); await proxy.start();
  pool = db.pool();
  examId = (await pool.query(`SELECT id FROM exams WHERE code = 'MBBS-PATH-MT'`)).rows[0].id;
  qids = (await pool.query(`SELECT id FROM exam_questions WHERE "examId" = $1 ORDER BY position`, [examId])).rows.map((r) => r.id);
  expect(qids.length).toBe(12);
}, 300_000);

afterAll(async () => {
  // Clean up everything deterministically first, THEN let an unexpected connection error fail the run.
  try { await db?.closePools(); proxy?.stop(); await api?.kill(); await redis?.kill(); db?.destroy(); }
  finally { db?.errors.assertClean(); }
});

/** A simulated browser: one attempt, strictly ordered revisions per question, single in-flight save (like the real engine). */
class Candidate {
  acked = new Map<string, { rev: number; label: string }>(); failures: string[] = []; attemptId = ''; clientId = cid(); s!: Student;
  constructor(readonly local: string, readonly rounds: number, readonly pace = 130) {}
  static async begin(local: string, rounds: number, base = api.base) {
    const c = new Candidate(local, rounds); c.s = await new Student(base, local).login();
    const r = await c.s.call('POST', '/attempts/start', { examId, clientId: c.clientId });
    expect(r.status, `start ${local}`).toBe(200); c.attemptId = r.body.attempt.id; return c;
  }
  body(qi: number, rev: number) { return { clientId: this.clientId, revision: rev, selectedLabel: label(qi, rev), state: 'ANSWERED', markedForReview: false, visited: true }; }
  async saveOne(qi: number, rev: number) {
    const r = await this.s.call('PUT', `/attempts/${this.attemptId}/answers/${qids[qi]}`, this.body(qi, rev), {}, 6000);
    if (r.status === 200 && r.body.saved === true) { this.acked.set(qids[qi]!, { rev, label: label(qi, rev) }); return true; }
    if (r.status === 429) { await sleep(1200); return this.saveOne(qi, rev); } // abuse guard only; not a durability signal
    this.failures.push(String(r.status)); return false;
  }
  /** Sends the plan in order, skipping what is already acknowledged. Stops at the first failure, like a client awaiting connectivity. */
  async run(stop: () => boolean) {
    for (let rev = 1; rev <= this.rounds; rev++) for (let qi = 0; qi < qids.length; qi++) {
      if ((this.acked.get(qids[qi]!)?.rev ?? 0) >= rev) continue;
      if (stop()) return false;
      try { if (!(await this.saveOne(qi, rev))) return false; } catch { this.failures.push('net'); return false; }
      await sleep(this.pace);
    }
    return true;
  }
  /** After recovery: keep retrying the unacknowledged tail until the plan is fully acknowledged. */
  async finish() { await until(`${this.local} to finish`, async () => this.run(() => false), 60_000, 500); }
}

const total = (cs: Candidate[]) => cs.reduce((n, c) => n + [...c.acked.values()].reduce((a, v) => a + v.rev, 0), 0);

/** Core assertion: every acknowledged write is durable & intact; no torn row/journal pairs; no duplicate journal entries. */
async function verify(c: Candidate) {
  const rows = (await pool.query(`SELECT "examQuestionId" q, revision, "selectedLabel" label FROM attempt_answers WHERE "attemptId" = $1`, [c.attemptId])).rows;
  const byQ = new Map(rows.map((r) => [r.q as string, r]));
  let committedUnacked = 0;
  for (const [q, a] of c.acked) {
    const row = byQ.get(q);
    expect(row, `${c.local}: acknowledged answer for ${q} rev ${a.rev} is missing from PostgreSQL`).toBeTruthy();
    expect(row.revision, `${c.local}: durable revision regressed below the acknowledged one`).toBeGreaterThanOrEqual(a.rev);
    if (row.revision === a.rev) expect(row.label).toBe(a.label);
    if (row.revision > a.rev) committedUnacked++;
  }
  for (const row of rows) { // no torn writes: every stored answer has its journal entry with identical content
    const ev = await pool.query(`SELECT count(*)::int n FROM answer_events WHERE "attemptId" = $1 AND "examQuestionId" = $2 AND revision = $3 AND "selectedLabel" IS NOT DISTINCT FROM $4`, [c.attemptId, row.q, row.revision, row.label]);
    expect(ev.rows[0].n, `${c.local}: answer without a matching journal entry (torn write)`).toBe(1);
  }
  const dup = await pool.query(`SELECT count(*)::int n FROM (SELECT 1 FROM answer_events WHERE "attemptId" = $1 GROUP BY "examQuestionId", revision HAVING count(*) > 1) d`, [c.attemptId]);
  expect(dup.rows[0].n, `${c.local}: duplicate journal entries`).toBe(0);
  return { acked: c.acked.size, committedUnacked };
}

async function finalState(c: Candidate) {
  await c.finish(); await verify(c);
  const rows = (await pool.query(`SELECT "examQuestionId" q, revision, "selectedLabel" label FROM attempt_answers WHERE "attemptId" = $1`, [c.attemptId])).rows;
  expect(rows.length).toBe(qids.length);
  for (const [qi, q] of qids.entries()) { const r = rows.find((x) => x.q === q)!; expect(r.revision).toBe(c.rounds); expect(r.label).toBe(label(qi, c.rounds)); }
}

const fleet = (locals: string[], rounds: number) => Promise.all(locals.map((l) => Candidate.begin(l, rounds)));
const locals = (prefix: 'a' | 'b', from: number, n: number) => Array.from({ length: n }, (_, i) => `student.${prefix}${String(from + i).padStart(3, '0')}`);

describe('A. API process crash', () => {
  it('SIGKILL of the API twice during an answer stream: every acknowledged answer is in PostgreSQL, no torn writes, retries converge', async () => {
    const cs = await fleet(locals('a', 2, 6), 5);
    for (const target of [60, 150]) {
      let killed = false;
      const runners = Promise.all(cs.map((c) => c.run(() => killed)));
      await until(`${target} acks`, async () => total(cs) >= target, 60_000, 50);
      killed = true; await api.kill('SIGKILL'); await runners;
      const stats = await Promise.all(cs.map(verify));
      console.log(`[FT-A] killed at ≈${total(cs)} acked answers · durable ✔ · committed-but-unacknowledged: ${stats.reduce((n, s) => n + s.committedUnacked, 0)}`);
      await api.start();
    }
    await Promise.all(cs.map(finalState));
  });

  it('crash INSIDE a write (journal insert stalled mid-statement): atomic — never a row without its journal entry; retry succeeds exactly once', async () => {
    const c = await Candidate.begin('student.a010', 1);
    await pool.query(`CREATE OR REPLACE FUNCTION fault_sleep() RETURNS trigger AS $$ BEGIN PERFORM pg_sleep(2.5); RETURN NEW; END $$ LANGUAGE plpgsql`);
    await pool.query(`CREATE TRIGGER fault_sleep_t BEFORE INSERT ON answer_events FOR EACH ROW EXECUTE FUNCTION fault_sleep()`);
    try {
      // (i) the database connection is killed while the statement is mid-flight → whole statement rolls back
      const inflight = c.saveOne(0, 1).catch(() => 'net');
      const pid = await until('stalled backend', async () => (await pool.query(`SELECT pid FROM pg_stat_activity WHERE query ILIKE '%INSERT INTO attempt_answers%' AND state = 'active' AND datname = $1 AND pid <> pg_backend_pid()`, [db.db])).rows[0]?.pid, 10_000, 50);
      await pool.query(`SELECT pg_terminate_backend($1)`, [pid]);
      expect(await inflight).not.toBe(true); // never acknowledged
      expect((await pool.query(`SELECT count(*)::int n FROM attempt_answers WHERE "attemptId" = $1`, [c.attemptId])).rows[0].n).toBe(0);
      expect((await pool.query(`SELECT count(*)::int n FROM answer_events WHERE "attemptId" = $1`, [c.attemptId])).rows[0].n).toBe(0);
      // (ii) the API process dies mid-statement → PostgreSQL finishes or discards the statement as a unit
      const inflight2 = c.saveOne(0, 1).catch(() => 'net');
      await until('stalled backend', async () => (await pool.query(`SELECT pid FROM pg_stat_activity WHERE query ILIKE '%INSERT INTO attempt_answers%' AND state = 'active' AND datname = $1 AND pid <> pg_backend_pid()`, [db.db])).rows[0]?.pid, 10_000, 50);
      await api.kill('SIGKILL'); await inflight2;
      await sleep(3500); // let the orphaned statement run to completion
      const rows = (await pool.query(`SELECT count(*)::int n FROM attempt_answers WHERE "attemptId" = $1`, [c.attemptId])).rows[0].n;
      const evs = (await pool.query(`SELECT count(*)::int n FROM answer_events WHERE "attemptId" = $1`, [c.attemptId])).rows[0].n;
      expect(rows).toBe(evs); // atomic: both or neither
      console.log(`[FT-A2] orphaned statement outcome: ${rows ? 'committed (unacknowledged)' : 'rolled back'}`);
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS fault_sleep_t ON answer_events`);
      if (!api.proc) await api.start();
    }
    // the original session cookie must still work: sessions live in PostgreSQL, not in the crashed process
    expect(await c.saveOne(0, 1)).toBe(true); // retry after restart: idempotent, exactly one journal entry
    expect((await pool.query(`SELECT count(*)::int n FROM answer_events WHERE "attemptId" = $1 AND revision = 1`, [c.attemptId])).rows[0].n).toBe(1);
    await verify(c);
  });
});

describe('B. restart after committed write', () => {
  it('graceful stop and hard kill both preserve acknowledged answers; sheet and submit agree with PostgreSQL; submit replays the same receipt', async () => {
    const [x, y] = await fleet(['student.a011', 'student.a012'], 1);
    for (const c of [x!, y!]) expect(await c.run(() => false)).toBe(true);
    await api.kill('SIGTERM'); await api.start();                       // graceful
    await api.kill('SIGKILL'); await api.start();                       // hard
    for (const c of [x!, y!]) {
      await verify(c);
      const sheet = await c.s.call('GET', `/attempts/${c.attemptId}/sheet`);
      expect(sheet.status).toBe(200);
      const items = (sheet.body.items ?? sheet.body.answers ?? sheet.body) as { selectedLabel: string | null; revision: number }[];
      expect(JSON.stringify(items)).toContain('"revision":1');
      const exp = [...c.acked].map(([q, a]) => ({ examQuestionId: q, revision: a.rev, selectedLabel: a.label }));
      const key = 'submit-' + c.local;
      const sub = await c.s.call('POST', `/attempts/${c.attemptId}/submit`, { clientId: c.clientId, submitKey: key, expected: exp });
      expect(sub.status).toBe(200);
      const code = sub.body.receiptCode as string; expect(code).toMatch(/^RC-/);
      const st = (await pool.query(`SELECT status, "receiptCode" FROM attempts WHERE id = $1`, [c.attemptId])).rows[0];
      expect(st).toMatchObject({ status: 'SUBMITTED', receiptCode: code });
      await api.kill('SIGKILL'); await api.start();
      const again = await c.s.call('POST', `/attempts/${c.attemptId}/submit`, { clientId: c.clientId, submitKey: key, expected: exp });
      expect(again.body.receiptCode).toBe(code); // idempotent across a crash
      const late = await c.s.call('PUT', `/attempts/${c.attemptId}/answers/${qids[0]}`, c.body(0, 9));
      expect(late.status).toBeGreaterThanOrEqual(400); // immutable after sealing
    }
  });
});

describe('C. lost HTTP acknowledgement after the database commit', () => {
  it('the write is durable though the client saw an error; the retry is an idempotent no-op; a lost submit ack replays the same receipt', async () => {
    const c = await Candidate.begin('student.a013', 2); c.s.base = proxy.base;
    proxy.dropResponses = true;
    const lost = await c.saveOne(0, 1).catch(() => 'net');
    expect(lost).not.toBe(true); expect(proxy.dropped).toBeGreaterThan(0);
    const row = (await pool.query(`SELECT revision, "selectedLabel" label FROM attempt_answers WHERE "attemptId" = $1`, [c.attemptId])).rows[0];
    expect(row).toMatchObject({ revision: 1, label: label(0, 1) });       // committed although the client never heard back
    proxy.dropResponses = false;
    const retry = await c.s.call('PUT', `/attempts/${c.attemptId}/answers/${qids[0]}`, c.body(0, 1));
    expect(retry.status).toBe(200); expect(retry.body).toMatchObject({ saved: true, duplicate: true });
    expect((await pool.query(`SELECT count(*)::int n FROM answer_events WHERE "attemptId" = $1`, [c.attemptId])).rows[0].n).toBe(1);

    expect(await c.saveOne(0, 2)).toBe(true);                              // client moves on normally
    proxy.dropResponses = true;
    const key = 'lost-ack-submit-1';
    await c.s.call('POST', `/attempts/${c.attemptId}/submit`, { clientId: c.clientId, submitKey: key }).then(() => 'unexpected', () => 'net');
    const sealed = (await pool.query(`SELECT status, "receiptCode" FROM attempts WHERE id = $1`, [c.attemptId])).rows[0];
    expect(sealed.status).toBe('SUBMITTED'); expect(sealed.receiptCode).toMatch(/^RC-/);
    proxy.dropResponses = false;
    const re = await c.s.call('POST', `/attempts/${c.attemptId}/submit`, { clientId: c.clientId, submitKey: key });
    expect(re.status).toBe(200); expect(re.body.receiptCode).toBe(sealed.receiptCode);
  });
});

describe('D. PostgreSQL crash (disposable cluster, immediate stop + WAL recovery)', () => {
  it('no acknowledged answer is lost across a database crash; the API recovers without a restart; retries converge', async () => {
    const cs = await fleet(locals('a', 14, 6), 4);
    let crashed = false;
    const runners = Promise.all(cs.map((c) => c.run(() => crashed)));
    await until('60 acks', async () => total(cs) >= 60, 60_000, 50);
    crashed = true; db.crash();
    await runners;
    const during = await api.health();
    console.log(`[FT-D] database crashed after ≈${total(cs)} acked answers; API health while down: ${JSON.stringify(during)}`);
    expect(during === null || during.db === false).toBe(true);           // API never claims a healthy database
    db.start();                                                           // WAL crash recovery
    await until('API to reconnect to recovered database', async () => (await api.health())?.db === true, 60_000, 500);
    const stats = await Promise.all(cs.map(verify));
    console.log(`[FT-D] after recovery: acknowledged ${stats.reduce((n, s) => n + s.acked, 0)} · committed-but-unacknowledged ${stats.reduce((n, s) => n + s.committedUnacked, 0)} · API recovered without restart`);
    await Promise.all(cs.map(finalState));
  });
});

describe('E. Redis loss during an examination', () => {
  it('FLUSHALL, then a hard Redis outage: login, saves, heartbeat and final submission all keep working quickly; nothing is lost on recovery', async () => {
    const cs = await fleet(locals('b', 2, 4), 5);
    const runners = Promise.all(cs.map((c) => c.run(() => false)));
    await until('30 acks', async () => total(cs) >= 30, 60_000, 50);
    await redis.flushAll();                                               // session cache, paper cache, heartbeats, counters gone
    await until('60 acks', async () => total(cs) >= 60, 60_000, 50);
    await redis.kill();                                                   // full outage
    const outageStart = Date.now();
    // a brand-new candidate does everything while Redis is DOWN
    const t1 = Date.now(); const late = await Candidate.begin('student.b011', 1); const startMs = Date.now() - t1;
    expect(await late.run(() => false)).toBe(true);
    const hb = await late.s.call('POST', `/attempts/${late.attemptId}/heartbeat`, { clientId: late.clientId, online: true });
    expect(hb.status).toBe(200);
    const t2 = Date.now();
    const sub = await late.s.call('POST', `/attempts/${late.attemptId}/submit`, { clientId: late.clientId, submitKey: 'outage-submit-1', expected: [...late.acked].map(([q, a]) => ({ examQuestionId: q, revision: a.rev, selectedLabel: a.label })) });
    const submitMs = Date.now() - t2;
    expect(sub.status).toBe(200); expect(sub.body.receiptCode).toMatch(/^RC-/);
    await until('90 acks', async () => total(cs) >= 90, 40_000, 50);      // the running fleet kept being acknowledged
    const hOut = await api.health();
    await redis.start();                                                  // back, empty
    await runners;
    console.log(`[FT-E] during outage: login+start ${startMs} ms · submit ${submitMs} ms · fleet failures ${cs.map((c) => c.failures.join(',') || '-').join('|')} · health ${JSON.stringify(hOut)} · outage window ≥ ${Date.now() - outageStart} ms`);
    expect(startMs).toBeLessThan(4000); expect(submitMs).toBeLessThan(4000);
    expect(hOut?.redis).toBe(false);                                      // health reports it honestly
    for (const c of cs) expect(c.failures, `${c.local} saw failures while Redis was unavailable`).toEqual([]);
    await Promise.all(cs.map(finalState));
    expect((await pool.query(`SELECT status FROM attempts WHERE id = $1`, [late.attemptId])).rows[0].status).toBe('SUBMITTED');
  });
});

describe('F. client clock manipulation', () => {
  it('forged client time (headers and body fields) neither extends nor shortens the server-held deadline', async () => {
    const c = await Candidate.begin('student.b010', 1);
    const dl = async () => (await pool.query(`SELECT "deadlineAt" d FROM attempts WHERE id = $1`, [c.attemptId])).rows[0].d.toISOString();
    const before = await dl();
    const forged = { Date: 'Mon, 01 Jan 2035 00:00:00 GMT', 'X-Client-Time': '2035-01-01T00:00:00Z', 'X-Forwarded-Date': '1999-01-01' };
    const ok = await c.s.call('PUT', `/attempts/${c.attemptId}/answers/${qids[0]}`, { ...c.body(0, 1), clientTime: '2035-01-01T00:00:00Z', deadlineAt: '2099-01-01T00:00:00Z', serverNow: '2035-01-01T00:00:00Z' }, forged);
    expect(ok.status).toBe(200);
    const hb = await c.s.call('POST', `/attempts/${c.attemptId}/heartbeat`, { clientId: c.clientId, online: true, deadlineAt: '2099-01-01T00:00:00Z', now: '2035-01-01T00:00:00Z' }, forged);
    expect(new Date(hb.body.deadlineAt).toISOString()).toBe(before);
    expect(await dl()).toBe(before);
    // the server clock decides: deadline passes in the database → a save is refused even though the client claims otherwise
    await pool.query(`UPDATE attempts SET "startedAt" = clock_timestamp() - interval '45 minutes', "deadlineAt" = clock_timestamp() - interval '30 seconds' WHERE id = $1`, [c.attemptId]);
    const late = await c.s.call('PUT', `/attempts/${c.attemptId}/answers/${qids[1]}`, { ...c.body(1, 1), deadlineAt: '2099-01-01T00:00:00Z', clientTime: '2000-01-01T00:00:00Z' }, { Date: 'Mon, 01 Jan 2001 00:00:00 GMT', 'X-Client-Time': '2000-01-01T00:00:00Z' });
    expect(late.status).toBe(409); expect(late.body.code).toBe('TIME_EXPIRED');
    expect((await pool.query(`SELECT count(*)::int n FROM attempt_answers WHERE "attemptId" = $1 AND "examQuestionId" = $2`, [c.attemptId, qids[1]])).rows[0].n).toBe(0);
    const fin = await c.s.call('POST', `/attempts/${c.attemptId}/heartbeat`, { clientId: c.clientId }, { Date: 'Mon, 01 Jan 2001 00:00:00 GMT' });
    expect(fin.body.status).toBe('AUTO_SUBMITTED');                      // the server seals it regardless of what the client believes
    expect((await pool.query(`SELECT count(*)::int n FROM attempt_answers WHERE "attemptId" = $1`, [c.attemptId])).rows[0].n).toBe(1); // earlier answer preserved
  });
});
