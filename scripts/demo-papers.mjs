#!/usr/bin/env node
/**
 * Adds five synthetic demo papers to a RUNNING deployment through its public API, using the real workflow
 * (examiner builds the paper → CCE approves it → examiner schedules it). Additive and idempotent: an exam whose code already
 * exists for the term is skipped; nothing is reset or deleted.
 *
 *   node scripts/demo-papers.mjs <base-url>      e.g. http://localhost:4000   or   https://szabmu.site
 *
 * Uses the documented synthetic accounts (examiner@ / cce@demo.szabmu.invalid). Demo data only — never run against real data.
 */
const BASE = (process.argv[2] ?? 'http://localhost:4000').replace(/\/$/, '');
const PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo-Passw0rd-2026!';
const DOMAIN = 'demo.szabmu.invalid';
const TERM = '2026-SPRING';

class Session {
  jar = new Map();
  async call(method, path, body) {
    const res = await fetch(`${BASE}/api${path}`, { method, headers: { ...(method === 'GET' ? {} : { 'content-type': 'application/json' }), cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ') }, body: JSON.stringify(body ?? (method === 'GET' ? undefined : {})) });
    for (const c of res.headers.getSetCookie?.() ?? []) { const [kv] = c.split(';'); const i = kv.indexOf('='); this.jar.set(kv.slice(0, i), kv.slice(i + 1)); }
    const text = await res.text(); let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${data?.code ?? ''} ${data?.message ?? text}`.trim());
    return data;
  }
  static async login(local) { const s = new Session(); await s.call('POST', '/auth/login', { email: `${local}@${DOMAIN}`, password: PASSWORD }); return s; }
}

const ONE_DAY = 24 * 3600_000;
// Question pools are the approved synthetic bank (PATH 13, PHARM 8); each paper takes a different slice / settings.
const PAPERS = [
  { code: 'MBBS-PATH-Q1', title: 'Pathology Quiz 1 — Cell injury and inflammation (DEMO)', course: 'MBBS-PATH-4', slice: [0, 6], duration: 20, pass: 50, neg: 0, marks: 2, shuffle: true, note: 'Six single-best-answer questions. No negative marking.' },
  { code: 'MBBS-PATH-Q2', title: 'Pathology Quiz 2 — Systemic pathology (DEMO)', course: 'MBBS-PATH-4', slice: [6, 13], duration: 25, pass: 50, neg: 0, marks: 2, shuffle: true, note: 'Seven single-best-answer questions. No negative marking.' },
  { code: 'MBBS-PATH-FULL', title: 'Pathology Full Paper (DEMO)', course: 'MBBS-PATH-4', slice: [0, 13], duration: 45, pass: 60, neg: 0, marks: 2, shuffle: true, note: 'The complete pathology bank. Pass mark 60%.' },
  { code: 'MBBS-PHARM-Q1', title: 'Pharmacology Quiz 1 (DEMO)', course: 'MBBS-PHARM-4', slice: [0, 8], duration: 25, pass: 50, neg: 0, marks: 2, shuffle: true, note: 'Eight single-best-answer questions. No negative marking.' },
  { code: 'MBBS-PHARM-Q2', title: 'Pharmacology Timed Drill — negative marking (DEMO)', course: 'MBBS-PHARM-4', slice: [0, 5], duration: 15, pass: 50, neg: 0.25, marks: 4, shuffle: false, note: 'Five questions, 4 marks each. A wrong answer loses 0.25 of the marks; an unanswered question loses nothing.' },
];

const examiner = await Session.login('examiner');
const cce = await Session.login('cce');
const [institutions, courses, existing] = await Promise.all([examiner.call('GET', '/institutions'), examiner.call('GET', '/courses'), examiner.call('GET', '/exams?pageSize=100')]);
const campusA = (institutions.items ?? institutions).find((i) => i.code === 'DMC-A'); if (!campusA) throw new Error('Campus DMC-A not found — is this the demo deployment?');
const pool = {};
async function questionsFor(courseCode) {
  if (pool[courseCode]) return pool[courseCode];
  const course = (courses.items ?? courses).find((c) => c.code === courseCode); if (!course) throw new Error(`Course ${courseCode} not found`);
  const r = await examiner.call('GET', `/questions?courseId=${course.id}&status=APPROVED&pageSize=100`);
  const ids = (r.items ?? r).map((q) => q.id).sort(); // stable order so reruns build identical papers
  return (pool[courseCode] = { course, ids });
}

const byCode = new Map((existing.items ?? existing).map((e) => [e.code, e]));
for (const p of PAPERS) {
  const prior = byCode.get(p.code);
  if (prior && !['DRAFT', 'PAPER_PENDING', 'APPROVED'].includes(prior.status)) { console.log(`skip   ${p.code} (already ${prior.status})`); continue; }
  const { course, ids } = await questionsFor(p.course);
  const items = ids.slice(p.slice[0], p.slice[1]).map((questionId) => ({ questionId, marks: p.marks }));
  if (!items.length) throw new Error(`${p.code}: no approved questions in ${p.course}`);
  const now = Date.now();
  // A previous run that stopped half-way leaves a DRAFT / pending exam: resume it instead of failing on the duplicate code.
  const exam = prior ?? await examiner.call('POST', '/exams', { code: p.code, title: p.title, courseId: course.id, term: TERM, opensAt: new Date(now - 10 * 60_000).toISOString(), closesAt: new Date(now + 60 * ONE_DAY).toISOString(),
    durationMin: p.duration, passPercent: p.pass, negativeMarking: p.neg, shuffleQuestions: p.shuffle, instructions: `Synthetic demonstration paper. ${p.note} Choose the single best answer.`, institutionIds: [campusA.id] });
  const status = exam.status ?? 'DRAFT';
  if (status === 'DRAFT') { await examiner.call('PUT', `/exams/${exam.id}/paper`, { items }); await examiner.call('POST', `/exams/${exam.id}/paper/submit`); }
  if (status === 'DRAFT' || status === 'PAPER_PENDING') await cce.call('POST', `/exams/${exam.id}/paper/review`, { decision: 'APPROVE', note: 'Approved (demo papers)' });
  await examiner.call('POST', `/exams/${exam.id}/schedule`);
  console.log(`added  ${p.code}  ${items.length} questions, ${p.duration} min`);
}

// Optional: make a named demo student a candidate on every paper. Uses the real, audited eligibility override (CCE, with a recorded reason)
// ONLY where the student is not already admitted, e.g. student.a001 is seeded with 62% attendance, below the 75% threshold for Pathology.
const GRANT = process.env.GRANT_REGNO;
if (GRANT) {
  const found = await cce.call('GET', `/students?search=${encodeURIComponent(GRANT)}&pageSize=5`);
  const student = (found.items ?? found).find((x) => x.regNo === GRANT); if (!student) throw new Error(`Student ${GRANT} not found`);
  const all = await cce.call('GET', '/exams?pageSize=100');
  for (const p of PAPERS) {
    const exam = (all.items ?? all).find((e) => e.code === p.code); if (!exam) continue;
    const roster = await cce.call('GET', `/exams/${exam.id}/roster`);
    const row = roster.find((r) => r.studentId === student.id);
    if (row?.admission === 'ADMITTED') { console.log(`ok     ${p.code}: ${GRANT} already admitted`); continue; }
    await cce.call('POST', `/exams/${exam.id}/candidates/${student.id}/override`, { decision: 'GRANT', reason: 'Demonstration: admitted so the demo student can attempt every demo paper (attendance override).' });
    console.log(`grant  ${p.code}: ${GRANT} admitted by override`);
  }
}
console.log('done');
