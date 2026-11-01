#!/usr/bin/env node
/**
 * Companion to exam-load.mjs: attaches the LIVE-CONTROL workload to the exam the load driver provisioned.
 *   node tests/load/control-load.mjs --api http://127.0.0.1:4000 --exam-file /tmp/exam.json --viewers 12 --poll-ms 2000 --commands
 * - opens N staff SSE streams (spread over several staff accounts; the server caps 4 streams per user) and counts pushed frames
 * - polls the control view + a candidates page like a dashboard would
 * - optionally issues REAL commands while candidates are saving: exam-wide extend, exam-wide suspend, resume — and measures
 *   command latency and command→viewer event latency.
 * Disposable/dev databases only: it approves the suspension policy by direct SQL (a load-test shortcut for the policy-approval step).
 */
import { readFileSync, existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import pg from 'pg';
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const API = arg('api', 'http://127.0.0.1:4000'); const VIEWERS = +arg('viewers', 12); const POLL = +arg('poll-ms', 2000); const COMMANDS = process.argv.includes('--commands');
const FILE = arg('exam-file', '/tmp/exam.json'); const PW = process.env.DEMO_PASSWORD ?? 'Demo-Passw0rd-2026!'; const DOMAIN = 'demo.szabmu.invalid';
const pct = (a, p) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : null);

for (let i = 0; i < 600 && !existsSync(FILE); i++) await sleep(500);
const { examId } = JSON.parse(readFileSync(FILE, 'utf8'));
async function login(local) { const r = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `${local}@${DOMAIN}`, password: PW }) }); if (!r.ok) throw new Error(`login ${local} ${r.status}`); return r.headers.getSetCookie()[0].split(';')[0]; }
const cookies = []; for (const l of ['cce', 'super.admin', 'examiner', 'examiner2']) cookies.push(await login(l));
const call = async (cookie, method, path, body) => { const t = performance.now(); const r = await fetch(`${API}/api${path}`, { method, headers: { cookie, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const j = await r.json().catch(() => null); return { status: r.status, ms: performance.now() - t, body: j }; };

// wait for the load driver's candidates to be running
for (let i = 0; i < 240; i++) { const s = await call(cookies[0], 'GET', `/invigilation/exams/${examId}/snapshot`); if (s.status === 200 && s.body.totals.inProgress > 20) break; await sleep(500); }

const events = []; let frames = 0; let stats = 0; const eventAt = new Map(); const viewers = [];
async function view(i) {
  const ac = new AbortController(); viewers.push(ac);
  const res = await fetch(`${API}/api/invigilation/exams/${examId}/stream`, { headers: { cookie: cookies[i % cookies.length] }, signal: ac.signal }); if (!res.ok) return;
  const rd = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
  try { for (;;) { const { value, done } = await rd.read(); if (done) break; buf += dec.decode(value, { stream: true }); let k; while ((k = buf.indexOf('\n\n')) >= 0) { const raw = buf.slice(0, k); buf = buf.slice(k + 2); const ev = /event: (\S+)/.exec(raw)?.[1]; if (!ev) continue; frames++; if (ev === 'stats') stats++; else { const id = /id: (\d+)/.exec(raw)?.[1]; const t0 = eventAt.get(ev); if (t0) events.push({ ev, ms: performance.now() - t0 }); void id; } } } } catch { /* closed */ }
}
const perUser = Math.ceil(VIEWERS / cookies.length); void perUser;
for (let i = 0; i < Math.min(VIEWERS, cookies.length * 4); i++) void view(i);
await sleep(1500);

const poll = { view: [], cand: [], errors: 0 }; let polling = true;
const poller = (async () => { while (polling) { const a = await call(cookies[0], 'GET', `/exams/${examId}/control`); const b = await call(cookies[1], 'GET', `/invigilation/exams/${examId}/candidates?page=1&pageSize=50`); (a.status === 200 ? poll.view : (poll.errors++, [])).push?.(a.ms); (b.status === 200 ? poll.cand : (poll.errors++, [])).push?.(b.ms); await sleep(POLL); } })();

const cmd = { extend: null, suspend: null, resume: null, extendAgain: null };
if (COMMANDS) {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL }); await db.connect();
  await db.query(`UPDATE exams SET "suspendTimePolicy" = 'FREEZE_CLOCK', "controlPolicyApprovedAt" = now(), "controlPolicyApprovedBy" = (SELECT id FROM users WHERE role = 'SUPER_ADMIN' LIMIT 1) WHERE id = $1`, [examId]); await db.end();
  await sleep(8000);
  const timed = async (name, ev, fn) => { eventAt.set(ev, performance.now()); const r = await fn(); cmd[name] = { status: r.status, ms: Math.round(r.ms), affected: r.body?.affected ?? r.body?.resumed, changed: r.body?.changed, err: r.body?.code }; await sleep(4000); };
  await timed('extend', 'DEADLINE_EXTENDED', () => call(cookies[0], 'POST', `/exams/${examId}/control/extend`, { scope: 'EXAM', minutes: 5, reason: 'Load test: exam-wide extension under load', confirm: true, idempotencyKey: `lt-ext-${Date.now()}` }));
  await timed('suspend', 'EXAM_SUSPENDED', () => call(cookies[0], 'POST', `/exams/${examId}/control/suspend`, { scope: 'EXAM', reason: 'Load test: exam-wide suspension under load', confirm: true }));
  await sleep(6000);
  await timed('resume', 'EXAM_RESUMED', () => call(cookies[0], 'POST', `/exams/${examId}/control/resume`, { confirm: true, note: 'load test' }));
}
// stay attached until the load driver is done (it deletes nothing; we stop after the exam file's exam has no in-progress attempts or after a cap)
const cap = Date.now() + +arg('max-seconds', 600) * 1000;
for (;;) { const s = await call(cookies[0], 'GET', `/invigilation/exams/${examId}/snapshot`); if (s.status !== 200 || (s.body.totals.inProgress === 0 && s.body.totals.submitted > 0) || Date.now() > cap) break; await sleep(2000); }
polling = false; await poller; viewers.forEach((v) => v.abort());
const by = {}; for (const e of events) (by[e.ev] ??= []).push(e.ms);
console.log(JSON.stringify({
  viewers: Math.min(VIEWERS, cookies.length * 4), framesReceived: frames, statsFrames: stats, dashboardPollMs: POLL,
  controlViewMs: { n: poll.view.length, p50: Math.round(pct(poll.view, 0.5)), p95: Math.round(pct(poll.view, 0.95)), max: Math.round(Math.max(...poll.view)) },
  candidatesPageMs: { n: poll.cand.length, p50: Math.round(pct(poll.cand, 0.5)), p95: Math.round(pct(poll.cand, 0.95)), max: Math.round(Math.max(...poll.cand)) }, pollErrors: poll.errors,
  commands: cmd, commandToViewerEventMs: Object.fromEntries(Object.entries(by).map(([k, v]) => [k, { n: v.length, p50: Math.round(pct(v, 0.5)), max: Math.round(Math.max(...v)) }])),
}, null, 2));
