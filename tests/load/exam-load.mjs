// Load & integrity test for the live examination path.
//   node tests/load/exam-load.mjs --candidates 2000 --questions 50 --think 3000 --concurrency 400
//   multiple API processes (round-robin per candidate):  --api http://localhost:4000,http://localhost:4001,http://localhost:4002
//   server-side cross-check from /api/metrics:            --metrics-token <METRICS_TOKEN>
// Provisions SYNTHETIC candidates directly in the database (bypassing argon2 login), drives the real HTTP API,
// then verifies against PostgreSQL that every answer the server acknowledged is stored, and every submit is sealed.
import pg from 'pg';
import { Pool as HttpPool, Agent, setGlobalDispatcher, request } from 'undici';
import { createHash, randomUUID } from 'node:crypto';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const N = +arg('candidates', 2000), M = +arg('questions', 50), THINK = +arg('think', 3000), RAMP = +arg('ramp', 20), APIS = arg('api', 'http://localhost:4000').split(','), CONC = +arg('concurrency', 512), MTOKEN = arg('metrics-token', ''), START_ONLY = process.argv.includes('--start-only');
const API_OF = new Map(); // session token -> API base URL (round-robin per candidate)
const DB = process.env.DATABASE_URL ?? 'postgresql://oes:oes_dev_password@localhost:5433/szabmu_oes';
const sha = (s) => createHash('sha256').update(s).digest('hex');
setGlobalDispatcher(new Agent({ connections: CONC, pipelining: 1, keepAliveTimeout: 30_000, headersTimeout: 30_000, bodyTimeout: 30_000 }));

const lat = { start: [], save: [], heartbeat: [], submit: [] }; const errs = {}; const acked = new Map(); // attemptId -> Map(eqId -> {rev,label})
const pct = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const note = (k) => { errs[k] = (errs[k] ?? 0) + 1; };

async function provision(db) {
  const tag = Date.now().toString(36);
  const inst = (await db.query(`INSERT INTO institutions (id, code, name, type, "updatedAt") VALUES ($1, $2, $3, 'MEDICAL_COLLEGE', now()) RETURNING id`, [randomUUID(), `LOAD-${tag}`.toUpperCase(), `Load-test institution ${tag} (synthetic)`])).rows[0].id;
  const prog = (await db.query(`INSERT INTO programs (id, code, name) VALUES ($1, $2, 'Load test programme') RETURNING id`, [randomUUID(), `LP-${tag}`.toUpperCase()])).rows[0].id;
  const course = (await db.query(`INSERT INTO courses (id, "programId", code, title, semester) VALUES ($1, $2, $3, 'Load test course', 1) RETURNING id`, [randomUUID(), prog, `LC-${tag}`.toUpperCase()])).rows[0].id;
  const admin = (await db.query(`SELECT id FROM users WHERE role = 'SUPER_ADMIN' LIMIT 1`)).rows[0]?.id ?? (await db.query(`INSERT INTO users (id,email,"fullName",role,"passwordHash","updatedAt") VALUES ($1,$2,'Load admin','SUPER_ADMIN','x',now()) RETURNING id`, [randomUUID(), `load.admin.${tag}@load.invalid`])).rows[0].id;
  const exam = (await db.query(`INSERT INTO exams (id, code, title, "courseId", "createdBy", status, "paperStatus", "opensAt", "closesAt", "durationMin", "totalMarks", "updatedAt") VALUES ($1,$2,$3,$4,$5,'LIVE','APPROVED', now() - interval '1 minute', now() + interval '3 hours', 120, $6, now()) RETURNING id`, [randomUUID(), `LOAD-${tag}`.toUpperCase(), `Load test exam ${tag} (synthetic)`, course, admin, M])).rows[0].id;
  await db.query(`INSERT INTO exam_institutions ("examId","institutionId") VALUES ($1,$2)`, [exam, inst]);
  const eqs = [];
  for (let i = 1; i <= M; i++) {
    const q = (await db.query(`INSERT INTO questions (id,"courseId","institutionId","authorId",stem,status,"updatedAt") VALUES ($1,$2,$3,$4,$5,'APPROVED',now()) RETURNING id`, [randomUUID(), course, inst, admin, `Synthetic load-test question ${i}: select the single best answer.`])).rows[0].id;
    for (const [j, l] of ['A', 'B', 'C', 'D'].entries()) await db.query(`INSERT INTO question_options (id,"questionId",label,text,"isCorrect") VALUES ($1,$2,$3,$4,$5)`, [randomUUID(), q, l, `Option ${l}`, j === 0]);
    const eq = (await db.query(`INSERT INTO exam_questions (id,"examId","questionId",position,marks,"correctLabel",snapshot) VALUES ($1,$2,$3,$4,1,'A',$5) RETURNING id`, [randomUUID(), exam, q, i, JSON.stringify({ type: 'MCQ', vignette: null, stem: `Synthetic load-test question ${i}`, options: ['A', 'B', 'C', 'D'].map((l) => ({ label: l, text: `Option ${l}` })) })])).rows[0].id;
    eqs.push(eq);
  }
  // bulk-create users/students/candidates/sessions
  const cands = [];
  const chunk = 500;
  for (let s = 0; s < N; s += chunk) {
    const n = Math.min(chunk, N - s); const uids = [], sids = [], tokens = [];
    const uv = [], sv = [], cv = [], sess = []; let pu = 1, ps = 1, pc = 1, pss = 1; const up = [], sp = [], cp = [], ssp = [];
    for (let k = 0; k < n; k++) {
      const i = s + k; const uid = randomUUID(), sid = randomUUID(), token = randomUUID() + randomUUID(); uids.push(uid); sids.push(sid); tokens.push(token);
      up.push(`($${pu++},$${pu++},$${pu++},'STUDENT','x',now())`); uv.push(uid, `load.${tag}.${i}@load.invalid`, `Load Candidate ${i}`);
      sp.push(`($${ps++},$${ps++},$${ps++},$${ps++},$${ps++},1,2026)`); sv.push(sid, uid, inst, prog, `LT-${tag}-${i}`);
      cp.push(`($${pc++},$${pc++},$${pc++},$${pc++})`); cv.push(randomUUID(), exam, sid, inst);
      ssp.push(`($${pss++},$${pss++},$${pss++}, now() + interval '5 hours')`); sess.push(randomUUID(), uid, sha(token));
      cands.push({ i, token, studentId: sid, userId: uid });
    }
    await db.query(`INSERT INTO users (id,email,"fullName",role,"passwordHash","updatedAt") VALUES ${up.join(',')}`, uv);
    await db.query(`INSERT INTO user_institutions ("userId","institutionId") SELECT u, $1::uuid FROM unnest($2::uuid[]) u`, [inst, uids]);
    await db.query(`INSERT INTO students (id,"userId","institutionId","programId","regNo",semester,"batchYear") VALUES ${sp.join(',')}`, sv);
    await db.query(`INSERT INTO exam_candidates (id,"examId","studentId","institutionId") VALUES ${cp.join(',')}`, cv);
    // admission re-validates local enrolment at start (policy P-26), so synthetic candidates need a real enrolment
    await db.query(`INSERT INTO enrollments (id,"studentId","courseId",term,status,eligibility) SELECT gen_random_uuid(), x, $1::uuid, '2026-SPRING', 'ENROLLED', 'ELIGIBLE' FROM unnest($2::uuid[]) x`, [course, sids]);
    await db.query(`INSERT INTO sessions (id,"userId","tokenHash","expiresAt") VALUES ${ssp.join(',')}`, sess);
  }
  return { exam, inst, cands, eqs };
}

async function call(kind, method, path, token, body) {
  const t0 = performance.now();
  try {
    const r = await request((API_OF.get(token) ?? APIS[0]) + path, { method, headers: { cookie: `oes_session=${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const text = await r.body.text(); const ms = performance.now() - t0; lat[kind].push(ms);
    if (r.statusCode >= 400) { note(`${kind}:${r.statusCode}:${(() => { try { return JSON.parse(text).code; } catch { return '?'; } })()}`); return { status: r.statusCode, json: null }; }
    return { status: r.statusCode, json: JSON.parse(text) };
  } catch (e) { note(`${kind}:${e.code ?? e.name}`); return { status: 0, json: null }; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function candidate(c, startDelay) {
  await sleep(startDelay);
  const clientId = `load${c.i}x${Math.random().toString(36).slice(2, 8)}`;
  let st = await call('start', 'POST', '/api/attempts/start', c.token, { examId: ctx.exam, clientId }); if (st.status !== 200) return;
  if (START_ONLY) return; // benchmark of the start path alone
  const attemptId = st.json.attempt.id; const mine = new Map(); acked.set(attemptId, mine);
  const order = st.json.questions.map((q) => q.id); let nextHb = Date.now() + 15_000;
  for (const qid of order) {
    await sleep(THINK * (0.5 + Math.random()));
    const label = 'ABCD'[Math.floor(Math.random() * 4)];
    const r = await call('save', 'PUT', `/api/attempts/${attemptId}/answers/${qid}`, c.token, { clientId, revision: 1, selectedLabel: label, state: 'ANSWERED', markedForReview: false, visited: true });
    if (r.status === 200) mine.set(qid, { rev: 1, label });
    if (Math.random() < 0.15) { // change of mind → higher revision
      const l2 = 'ABCD'[Math.floor(Math.random() * 4)];
      const r2 = await call('save', 'PUT', `/api/attempts/${attemptId}/answers/${qid}`, c.token, { clientId, revision: 2, selectedLabel: l2, state: 'ANSWERED', markedForReview: false, visited: true });
      if (r2.status === 200) mine.set(qid, { rev: 2, label: l2 });
    }
    if (Date.now() > nextHb) { nextHb = Date.now() + 15_000; await call('heartbeat', 'POST', `/api/attempts/${attemptId}/heartbeat`, c.token, { clientId }); }
  }
  const sub = await call('submit', 'POST', `/api/attempts/${attemptId}/submit`, c.token, { clientId, submitKey: `load-submit-${c.i}-${attemptId.slice(0, 8)}` });
  if (sub.status === 200) { mine.receipt = sub.json.receiptCode; }
  if (sub.status === 200) { const again = await call('submit', 'POST', `/api/attempts/${attemptId}/submit`, c.token, { clientId, submitKey: `load-submit-retry-${c.i}` }); if (again.json?.receiptCode !== sub.json.receiptCode) note('submit:replay-mismatch'); }
}

const ctx = {};
const db = new pg.Client({ connectionString: DB }); await db.connect();
console.log(`Provisioning ${N} synthetic candidates × ${M} questions…`);
Object.assign(ctx, await provision(db));
for (const c of ctx.cands) API_OF.set(c.token, APIS[c.i % APIS.length]);
console.log(`Running: ramp ${RAMP}s, think ≈${THINK}ms/question, max ${CONC} connections, ${APIS.length} API process(es)`);
// host CPU sampler (whole machine, shared with PostgreSQL/Redis/APIs/this generator)
import { readFileSync } from 'node:fs';
const cpuSnap = () => { const [, ...f] = readFileSync('/proc/stat', 'utf8').split('\n')[0].trim().split(/\s+/).map(Number); const idle = f[3] + f[4]; return { idle, total: f.reduce((a, b) => a + b, 0) }; };
const cpuSamples = []; let prevCpu = cpuSnap();
const cpuTimer = setInterval(() => { const c = cpuSnap(); cpuSamples.push(100 * (1 - (c.idle - prevCpu.idle) / (c.total - prevCpu.total))); prevCpu = c; }, 5000);
const t0 = Date.now();
await Promise.all(ctx.cands.map((c) => candidate(c, (c.i / N) * RAMP * 1000)));
const secs = (Date.now() - t0) / 1000; clearInterval(cpuTimer);

console.log('\nVerifying against PostgreSQL…');
const rows = (await db.query(`SELECT a.id, a.status, a."receiptCode", aa."examQuestionId", aa."selectedLabel", aa.revision FROM attempts a LEFT JOIN attempt_answers aa ON aa."attemptId" = a.id WHERE a."examId" = $1`, [ctx.exam])).rows;
const dbAns = new Map(); const attemptRow = new Map();
for (const r of rows) { attemptRow.set(r.id, r); if (r.examQuestionId) { if (!dbAns.has(r.id)) dbAns.set(r.id, new Map()); dbAns.get(r.id).set(r.examQuestionId, r); } }
let ackedTotal = 0, missing = 0, wrong = 0, unsealed = 0, noReceipt = 0;
for (const [attemptId, mine] of acked) {
  for (const [qid, a] of mine) { ackedTotal++; const d = dbAns.get(attemptId)?.get(qid); if (!d) missing++; else if (d.revision !== a.rev || d.selectedLabel !== a.label) wrong++; }
  const ar = attemptRow.get(attemptId); if (mine.receipt) { if (!ar || ar.status === 'IN_PROGRESS') unsealed++; else if (ar.receiptCode !== mine.receipt) noReceipt++; }
}
const total = Object.values(lat).reduce((a, b) => a + b.length, 0);
const f = (n) => n.toFixed(1).padStart(8);
console.log(`\nDuration ${secs.toFixed(1)}s · ${total} requests · ${(total / secs).toFixed(0)} req/s overall`);
console.log('endpoint      count       p50       p95       p99       max');
for (const [k, a] of Object.entries(lat)) console.log(`${k.padEnd(10)} ${String(a.length).padStart(8)} ${f(pct(a, 0.5))} ${f(pct(a, 0.95))} ${f(pct(a, 0.99))} ${f(a.reduce((m, x) => (x > m ? x : m), 0))}  ms`);
console.log('errors:', Object.keys(errs).length ? errs : 'none');
if (cpuSamples.length) console.log(`host CPU busy (all 4 vCPU, 5 s samples): mean ${(cpuSamples.reduce((a, b) => a + b, 0) / cpuSamples.length).toFixed(0)}% · peak ${Math.max(...cpuSamples).toFixed(0)}% · samples ≥95%: ${cpuSamples.filter((x) => x >= 95).length}/${cpuSamples.length}`);
if (MTOKEN) {
  const sum = {}; const buckets = new Map();
  for (const base of APIS) { const t = await (await request(base + '/api/metrics', { headers: { authorization: `Bearer ${MTOKEN}` } })).body.text();
    for (const l of t.split('\n')) { let m;
      if ((m = l.match(/^oes_answer_save_total\{result="(\w+)"\} (\S+)/))) sum['saves.' + m[1]] = (sum['saves.' + m[1]] ?? 0) + +m[2];
      else if ((m = l.match(/^oes_submit_total\{result="(\w+)"\} (\S+)/))) sum['submits.' + m[1]] = (sum['submits.' + m[1]] ?? 0) + +m[2];
      else if ((m = l.match(/^oes_db_errors_total\{kind="(\w+)"\} (\S+)/))) sum['db_errors.' + m[1]] = (sum['db_errors.' + m[1]] ?? 0) + +m[2];
      else if ((m = l.match(/^oes_answer_save_duration_seconds_bucket\{le="([^"]+)"\} (\S+)/))) buckets.set(m[1], (buckets.get(m[1]) ?? 0) + +m[2]); } }
  const inf = buckets.get('+Inf') ?? 0; const q = (p) => { for (const [le, n] of [...buckets].filter(([k]) => k !== '+Inf').sort((a, b) => +a[0] - +b[0])) if (n >= inf * p) return `≤${+le * 1000} ms`; return '>10000 ms'; };
  console.log('server-side (from /api/metrics, summed over processes):', JSON.stringify(sum), `· save latency histogram: p50 ${q(0.5)} · p95 ${q(0.95)} · p99 ${q(0.99)} (bucket upper bounds)`);
}
console.log(`\nINTEGRITY  acknowledged answers: ${ackedTotal} · missing in DB: ${missing} · stale/wrong in DB: ${wrong} · acked submits not sealed: ${unsealed} · receipt mismatches: ${noReceipt}`);
const ok = missing === 0 && wrong === 0 && unsealed === 0 && noReceipt === 0 && !errs['submit:replay-mismatch'];
console.log(ok ? 'RESULT: PASS — no acknowledged answer was lost or altered.' : 'RESULT: FAIL');

await db.end(); process.exit(ok ? 0 : 1);
