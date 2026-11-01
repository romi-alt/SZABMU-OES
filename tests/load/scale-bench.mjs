#!/usr/bin/env node
/**
 * Targeted SCALE benchmark for the live-control paths (not a replacement for exam-load.mjs).
 * Seeds N in-progress attempts (set-based SQL, 5 campuses, ~25 answers each) in a DISPOSABLE database, then times:
 *   monitor snapshot (cold/warm), candidates page (unfiltered / filtered), control view, heartbeat throughput, the metrics scrape,
 *   exam-wide extend / suspend / resume while a background writer saves, and a MASS EXPIRY reconciled by the RECONCILE command.
 *
 *   DATABASE_URL=… node tests/load/scale-bench.mjs --api http://127.0.0.1:4000 --attempts 5000 --metrics-token <token>
 * Refuses to run against the shared development database (:5433).
 */
import pg from 'pg';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const API = arg('api', 'http://127.0.0.1:4000'); const N = +arg('attempts', 5000); const Q = +arg('questions', 50); const SAVERS = +arg('sessions', 1500); const TOKEN = arg('metrics-token', '');
const DB = process.env.DATABASE_URL; if (!DB || /:5433\//.test(DB)) { console.error('refusing: set DATABASE_URL to a DISPOSABLE database'); process.exit(2); }
const sha = (s) => createHash('sha256').update(s).digest('hex'); const pct = (a, p) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : null);
const round = (x) => (x === null ? null : Math.round(x)); const sum = (a) => ({ n: a.length, p50: round(pct(a, 0.5)), p95: round(pct(a, 0.95)), max: round(Math.max(0, ...a)) });
const db = new pg.Client({ connectionString: DB }); await db.connect(); const out = { attempts: N, questions: Q };

// ───────────── seed ─────────────
const t0 = Date.now(); const tag = Date.now().toString(36);
const insts = []; for (let k = 0; k < 5; k++) insts.push((await db.query(`INSERT INTO institutions (id, code, name, type, "updatedAt") VALUES (gen_random_uuid(), $1, $2, 'MEDICAL_COLLEGE', now()) RETURNING id`, [`SB${tag}${k}`.toUpperCase(), `Scale bench campus ${k}`])).rows[0].id);
const prog = (await db.query(`INSERT INTO programs (id, code, name) VALUES (gen_random_uuid(), $1, 'Scale programme') RETURNING id`, [`SP${tag}`.toUpperCase()])).rows[0].id;
const course = (await db.query(`INSERT INTO courses (id, "programId", code, title, semester) VALUES (gen_random_uuid(), $1, $2, 'Scale course', 1) RETURNING id`, [prog, `SC${tag}`.toUpperCase()])).rows[0].id;
const admin = (await db.query(`SELECT id FROM users WHERE role = 'SUPER_ADMIN' LIMIT 1`)).rows[0].id;
const exam = (await db.query(`INSERT INTO exams (id, code, title, "courseId", "createdBy", status, "paperStatus", "controlMode", "suspendTimePolicy", "controlPolicyApprovedBy", "controlPolicyApprovedAt", "officialStartAt", "opensAt", "closesAt", "durationMin", "totalMarks", "updatedAt")
  VALUES (gen_random_uuid(), $1, 'Scale bench exam', $2, $3, 'LIVE', 'APPROVED', 'MANUAL', 'FREEZE_CLOCK', $3, now(), now() - interval '10 minutes', now() - interval '10 minutes', now() + interval '6 hours', 120, $4, now()) RETURNING id`, [`SB-${tag}`.toUpperCase(), course, admin, Q])).rows[0].id;
for (const i of insts) await db.query(`INSERT INTO exam_institutions ("examId","institutionId") VALUES ($1,$2)`, [exam, i]);
const eqs = [];
for (let i = 1; i <= Q; i++) {
  const q = (await db.query(`INSERT INTO questions (id,"courseId","institutionId","authorId",stem,status,"updatedAt") VALUES (gen_random_uuid(),$1,$2,$3,$4,'APPROVED',now()) RETURNING id`, [course, insts[0], admin, `Scale question ${i}`])).rows[0].id;
  eqs.push((await db.query(`INSERT INTO exam_questions (id,"examId","questionId",position,marks,"correctLabel",snapshot) VALUES (gen_random_uuid(),$1,$2,$3,1,'A',$4) RETURNING id`, [exam, q, i, JSON.stringify({ type: 'MCQ', vignette: null, stem: `Scale question ${i}`, options: ['A', 'B', 'C', 'D'].map((l) => ({ label: l, text: `Option ${l}` })) })])).rows[0].id);
}
const savers = [];
for (let s = 0; s < N; s += 2500) {
  const n = Math.min(2500, N - s); const uid = [], sid = [], aid = [], idx = [], inst = [];
  for (let k = 0; k < n; k++) { uid.push(randomUUID()); sid.push(randomUUID()); aid.push(randomUUID()); idx.push(s + k); inst.push(insts[(s + k) % 5]); }
  await db.query(`INSERT INTO users (id,email,"fullName",role,"passwordHash","updatedAt") SELECT u, 'sb.'||$1||'.'||i||'@load.invalid', 'Bench '||i, 'STUDENT', 'x', now() FROM unnest($2::uuid[], $3::int[]) AS t(u, i)`, [tag, uid, idx]);
  await db.query(`INSERT INTO user_institutions ("userId","institutionId") SELECT u, n FROM unnest($1::uuid[], $2::uuid[]) AS t(u, n)`, [uid, inst]);
  await db.query(`INSERT INTO students (id,"userId","institutionId","programId","regNo",semester,"batchYear") SELECT st, u, n, $1::uuid, 'SB-'||$2||'-'||i, 1, 2026 FROM unnest($3::uuid[], $4::uuid[], $5::uuid[], $6::int[]) AS t(st, u, n, i)`, [prog, tag, sid, uid, inst, idx]);
  await db.query(`INSERT INTO exam_candidates (id,"examId","studentId","institutionId") SELECT gen_random_uuid(), $1::uuid, st, n FROM unnest($2::uuid[], $3::uuid[]) AS t(st, n)`, [exam, sid, inst]);
  await db.query(`INSERT INTO attempts (id,"examId","studentId",status,"startedAt","deadlineAt","questionOrder","activeClientId","clientEpoch") SELECT a, $1::uuid, st, 'IN_PROGRESS', now() - interval '5 minutes', now() + interval '115 minutes', $4::text[], 'bench-client', 1 FROM unnest($2::uuid[], $3::uuid[]) AS t(a, st)`, [exam, aid, sid, eqs]);
  await db.query(`INSERT INTO attempt_answers ("attemptId","examQuestionId","selectedLabel",state,"markedForReview",visited,revision,"savedAt") SELECT a, eq, 'A', 'ANSWERED', false, true, 1, now() FROM unnest($1::uuid[]) a CROSS JOIN unnest($2::uuid[]) eq`, [aid, eqs.slice(0, 25)]);
  for (let k = 0; k < n && savers.length < SAVERS; k++) { const token = randomUUID() + randomUUID(); savers.push({ token, attemptId: aid[k], userId: uid[k], rev: 1 }); }
}
await db.query(`INSERT INTO sessions (id,"userId","tokenHash","expiresAt") SELECT gen_random_uuid(), u, h, now() + interval '5 hours' FROM unnest($1::uuid[], $2::text[]) AS t(u, h)`, [savers.map((s) => s.userId), savers.map((s) => sha(s.token))]);
await db.query('ANALYZE');   // a freshly seeded disposable cluster has no statistics; production tables are analysed by autovacuum
out.seedSeconds = Math.round((Date.now() - t0) / 1000);

// ───────────── helpers ─────────────
const login = async (l) => { const r = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `${l}@demo.szabmu.invalid`, password: 'Demo-Passw0rd-2026!' }) }); if (!r.ok) throw new Error(`login ${l} ${r.status}`); return r.headers.getSetCookie()[0].split(';')[0]; };
const cce = await login('cce');
const call = async (method, path, body, cookie = cce) => { const t = performance.now(); const r = await fetch(`${API}/api${path}`, { method, headers: { cookie, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const j = await r.json().catch(() => null); return { status: r.status, ms: performance.now() - t, body: j }; };
const repeat = async (n, fn) => { const a = []; for (let i = 0; i < n; i++) { const r = await fn(); if (r.status !== 200) throw new Error(`HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`); a.push(r.ms); } return a; };

// ───────────── phase 1: reads, no write load ─────────────
const snapCold = await call('GET', `/invigilation/exams/${exam}/snapshot`);
await sleep(2000);
out.read_idle = {
  snapshotCold_ms: round(snapCold.ms), snapshotWarmAfterTTL_ms: sum(await (async () => { const a = []; for (let i = 0; i < 6; i++) { await sleep(1700); const r = await call('GET', `/invigilation/exams/${exam}/snapshot`); a.push(r.ms); } return a; })()),
  candidatesPage1_ms: sum(await repeat(8, () => call('GET', `/invigilation/exams/${exam}/candidates?page=1&pageSize=50`))),
  candidatesStatusFilter_ms: sum(await repeat(5, () => call('GET', `/invigilation/exams/${exam}/candidates?status=IN_PROGRESS&pageSize=50`))),
  candidatesSearch_ms: sum(await repeat(5, () => call('GET', `/invigilation/exams/${exam}/candidates?search=SB-${tag.toUpperCase()}-42&pageSize=50`))),
  controlView_ms: sum(await repeat(5, () => call('GET', `/exams/${exam}/control`))),
};

// ───────────── heartbeat micro-benchmark (closed loop) ─────────────
async function closedLoop(seconds, conc, mk) {
  const lat = []; let err = 0; const end = Date.now() + seconds * 1000; let i = 0;
  await Promise.all(Array.from({ length: conc }, async () => { while (Date.now() < end) { const s = savers[i++ % savers.length]; const t = performance.now(); const r = await mk(s).catch(() => ({ status: 0 })); if (r.status !== 200) err++; else lat.push(performance.now() - t); } }));
  return { ...sum(lat), perSec: Math.round(lat.length / seconds), errors: err };
}
const ses = (s) => `oes_session=${s.token}`;
out.heartbeat = await closedLoop(8, 48, (s) => call('POST', `/attempts/${s.attemptId}/heartbeat`, { clientId: 'bench-client', online: true }, ses(s)));

// ───────────── phase 2: with a background writer ─────────────
let writing = true; const saveLat = []; let saveErr = {};
const writer = Promise.all(Array.from({ length: 48 }, async (_, w) => { let i = w; while (writing) { const s = savers[i % savers.length]; i += 48; s.rev++; const t = performance.now(); const r = await call('PUT', `/attempts/${s.attemptId}/answers/${eqs[s.rev % 25]}`, { clientId: 'bench-client', revision: s.rev, selectedLabel: 'B', state: 'ANSWERED', markedForReview: false, visited: true }, ses(s)).catch(() => ({ status: 0 })); if (r.status === 200) saveLat.push(performance.now() - t); else saveErr[r.status + ':' + (r.body?.code ?? '')] = (saveErr[r.status + ':' + (r.body?.code ?? '')] ?? 0) + 1; await sleep(15); } }));
await sleep(4000); const base = saveLat.length; const baseP = { ...sum(saveLat) };
out.save_baseline = { ...baseP, perSec: Math.round(base / 4) };
out.read_under_writes = {
  snapshot_ms: sum(await (async () => { const a = []; for (let i = 0; i < 4; i++) { await sleep(1700); a.push((await call('GET', `/invigilation/exams/${exam}/snapshot`)).ms); } return a; })()),
  candidatesPage1_ms: sum(await repeat(6, () => call('GET', `/invigilation/exams/${exam}/candidates?page=1&pageSize=50`))),
  controlView_ms: sum(await repeat(5, () => call('GET', `/exams/${exam}/control`))),
};
const cmd = {}; const mark = () => saveLat.length;
async function timed(name, path, body) { const a = mark(); const r = await call('POST', `/exams/${exam}/control/${path}`, body); const during = saveLat.slice(a); cmd[name] = { status: r.status, ms: round(r.ms), affected: r.body?.affected ?? r.body?.resumed, code: r.body?.code, savesDuring: sum(during) }; await sleep(3000); }
await timed('extendExam', 'extend', { scope: 'EXAM', minutes: 5, reason: 'Scale benchmark: exam-wide extension', confirm: true, idempotencyKey: `sb-ext-${tag}` });
await timed('suspendExam', 'suspend', { scope: 'EXAM', reason: 'Scale benchmark: exam-wide suspension', confirm: true });
await sleep(3000);
await timed('resumeExam', 'resume', { confirm: true, note: 'scale benchmark' });
out.commands = cmd; out.saveErrorsDuringCommands = saveErr;
writing = false; await writer;

// ───────────── metrics scrape ─────────────
if (TOKEN) { const a = []; for (let i = 0; i < 3; i++) { const t = performance.now(); const r = await fetch(`${API}/api/metrics`, { headers: { authorization: `Bearer ${TOKEN}` } }); await r.text(); a.push(performance.now() - t); await sleep(500); } out.metricsScrape_ms = a.map(round); }

// ───────────── phase 3: mass expiry → RECONCILE ─────────────
await db.query(`UPDATE attempts SET "startedAt" = now() - interval '4 hours', "deadlineAt" = now() - interval '5 minutes' WHERE "examId" = $1`, [exam]);
const tr = Date.now(); let passes = 0; let stats = null;
for (; passes < 60; passes++) {
  const r = await call('POST', `/exams/${exam}/control/reconcile`, {}); stats = r.body?.result;
  const left = (await db.query(`SELECT count(*)::int n FROM attempts WHERE "examId" = $1 AND status = 'IN_PROGRESS'`, [exam])).rows[0].n; out.expiry = { leftAfterPass: left, passes: passes + 1 };
  if (!left) break;
}
const secs = (Date.now() - tr) / 1000; out.expiry = { ...out.expiry, seconds: Math.round(secs * 10) / 10, sealedPerSecond: Math.round(N / secs), lastPass: stats };
out.integrity = (await db.query(`SELECT count(*) FILTER (WHERE status = 'AUTO_SUBMITTED' AND "receiptCode" IS NOT NULL)::int AS sealed, count(DISTINCT "receiptCode")::int AS uniqueReceipts, (SELECT count(*)::int FROM attempt_events e JOIN attempts a ON a.id = e."attemptId" WHERE a."examId" = $1 AND e.kind = 'AUTO_SUBMITTED') AS autoEvents FROM attempts WHERE "examId" = $1`, [exam])).rows[0];
await db.end(); console.log(JSON.stringify(out, null, 2));
