import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';

/**
 * Records the narrated student guide: one student signs up, completes the profile, is verified and assigned by the examination office
 * (done through the real staff API between scenes), signs in, sits the live paper and submits.
 * Synthetic data on the disposable local stack only. Voice clips come from tts.py (TUTORIAL_VOICE = its output dir);
 * the recording waits for each clip so the actions follow the narration. build-video.mjs mixes the voice and burns subtitles.
 */
const OUT = process.env.TUTORIAL_OUT ?? 'test-results-tutorial';
const VOICE = JSON.parse(fs.readFileSync(path.join(process.env.TUTORIAL_VOICE ?? OUT, 'voice', 'manifest.json'), 'utf8')) as Record<string, { file: string; duration: number; sub: string }>;
const PW = 'Sturdy-Pass-2026!x';
const STAFF_PW = 'Demo-Passw0rd-2026!';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const digits = () => String(Math.floor(1000 + Math.random() * 8999));

const OVERLAY = `(() => { try {
  const CSS = '#tut-cur{position:fixed;width:24px;height:24px;margin:-5px 0 0 -5px;border-radius:50%;background:rgba(214,40,40,.5);border:2px solid #fff;box-shadow:0 1px 6px rgba(0,0,0,.35);z-index:2147483647;pointer-events:none;transition:transform .1s}#tut-cur.dn{transform:scale(.72);background:rgba(214,40,40,.9)}#tut-ring{position:fixed;border:3px solid #e0a526;border-radius:10px;box-shadow:0 0 0 6px rgba(224,165,38,.22);z-index:2147483646;pointer-events:none;opacity:0;transition:opacity .25s}[data-testid=dev-code]{display:none!important}';
  let x = -60, y = -60, down = false, ring = null;
  const ensure = () => {
    const root = document.documentElement; if (!root) return;
    if (!document.getElementById('tut-style')) { const st = document.createElement('style'); st.id = 'tut-style'; st.textContent = CSS; root.appendChild(st); }
    let k = document.getElementById('tut-cur'); if (!k) { k = document.createElement('div'); k.id = 'tut-cur'; root.appendChild(k); }
    let r = document.getElementById('tut-ring'); if (!r) { r = document.createElement('div'); r.id = 'tut-ring'; root.appendChild(r); }
    k.style.left = x + 'px'; k.style.top = y + 'px'; k.className = down ? 'dn' : '';
    if (ring) { r.style.left = (ring[0] - 6) + 'px'; r.style.top = (ring[1] - 6) + 'px'; r.style.width = (ring[2] + 12) + 'px'; r.style.height = (ring[3] + 12) + 'px'; r.style.opacity = '1'; } else r.style.opacity = '0';
  };
  window.__tutRing = (b) => { ring = b; ensure(); };
  document.addEventListener('mousemove', (e) => { x = e.clientX; y = e.clientY; ensure(); }, true);
  document.addEventListener('mousedown', () => { down = true; ensure(); }, true); document.addEventListener('mouseup', () => { down = false; ensure(); }, true);
  setInterval(ensure, 100); ensure();
} catch (e) {} })();`;

// ── narration timeline ───────────────────────────────────────────────────────────────────
type Cue = { t: number; key: string; step: string; file: string; dur: number; sub: string };
const cues: Cue[] = []; let t0 = 0; let busyUntil = 0;
const now = () => (Date.now() - t0) / 1000;
/** Starts the next narration line once the previous one has finished; actions that follow run while it is spoken. */
async function say(key: string, step: string) {
  const v = VOICE[key]; if (!v) throw new Error('no voice clip for ' + key);
  const gap = busyUntil - Date.now(); if (gap > 0) await wait(gap);
  cues.push({ t: now(), key, step, file: v.file, dur: v.duration, sub: v.sub });
  busyUntil = Date.now() + v.duration * 1000 + 450;
}
/** Waits until the current line has been spoken (before a scene change). */
async function done(extra = 0) { const gap = busyUntil - Date.now(); if (gap > 0) await wait(gap); if (extra) await wait(extra); }

// ── on-screen helpers ────────────────────────────────────────────────────────────────────
async function ring(page: Page, b: { x: number; y: number; width: number; height: number } | null) { await page.evaluate((r) => (window as any).__tutRing?.(r ? [r.x, r.y, r.width, r.height] : null), b).catch(() => {}); }
async function glide(page: Page, loc: Locator) {
  await loc.scrollIntoViewIfNeeded(); const b = await loc.boundingBox(); if (!b) return;
  await ring(page, b); await page.mouse.move(b.x + Math.min(b.width / 2, 160), b.y + b.height / 2, { steps: 30 }); await wait(300);
}
async function tap(page: Page, loc: Locator, pause = 700) { await glide(page, loc); await loc.click(); await ring(page, null); await wait(pause); }
async function type(page: Page, loc: Locator, text: string) { await glide(page, loc); await loc.click(); await loc.pressSequentially(text, { delay: 55 }); await ring(page, null); await wait(300); }
async function choose(page: Page, loc: Locator, value: string | { label: string }) { await glide(page, loc); await loc.selectOption(value); await ring(page, null); await wait(700); }
async function card(page: Page, kicker: string, title: string, sub: string) {
  await page.goto('about:blank');
  await page.setContent(`<body style="margin:0;height:100vh;display:grid;place-items:center;background:radial-gradient(120% 90% at 30% 20%,#8f2433 0%,#5e1420 60%,#3f0c15 100%);color:#fff;font-family:'Segoe UI',system-ui,sans-serif;text-align:center">
    <div style="max-width:980px;padding:0 40px"><img src="http://localhost:3000/logo-white.png" alt="" style="height:86px;margin-bottom:34px;opacity:.96">
    <div style="font-size:16px;letter-spacing:.22em;text-transform:uppercase;color:#f0c25a;font-weight:700">${kicker}</div>
    <div style="font-size:50px;font-weight:700;margin-top:12px;line-height:1.15">${title}</div>
    <div style="width:64px;height:4px;background:#e0a526;border-radius:2px;margin:26px auto"></div>
    <div style="font-size:24px;opacity:.9;line-height:1.45">${sub}</div></div></body>`);
  await wait(400);
}

/** What the campus examination office does after the student registers: verify, enrol in the course, admit to the paper (real staff API). */
async function officeVerifiesAndAssigns(browser: Browser, baseURL: string, regNo: string) {
  const asStaff = async (local: string) => { const ctx = await browser.newContext({ baseURL }); const r = await ctx.request.post('/api/auth/login', { data: { email: `${local}@demo.szabmu.invalid`, password: STAFF_PW } }); expect(r.ok(), `${local} login`).toBeTruthy(); return ctx; };
  const admin = await asStaff('admin.a');
  const stud = (await (await admin.request.get(`/api/students?search=${encodeURIComponent(regNo)}`)).json()).items[0];
  expect((await admin.request.patch(`/api/students/${stud.id}`, { data: { verify: true } })).ok(), 'verify').toBeTruthy();
  const course = ((await (await admin.request.get('/api/courses')).json()) as any[]).find((c) => c.code === 'MBBS-PATH-4');
  const enr = await admin.request.post('/api/enrollments/bulk', { data: { courseId: course.id, term: '2026-SPRING', institutionId: stud.institutionId, studentIds: [stud.id] } });
  expect((await enr.json()).newlyEnrolled, 'enrolled').toBe(1); await admin.close();
  const cce = await asStaff('cce');
  const list = await (await cce.request.get('/api/exams?pageSize=50')).json(); const exam = (list.items ?? list).find((e: any) => e.code === 'MBBS-PATH-MT');
  const grant = await cce.request.post(`/api/exams/${exam.id}/candidates/${stud.id}/override`, { data: { decision: 'GRANT', reason: 'Admitted after verification of enrolment (tutorial recording)' } });
  expect(grant.ok(), 'admit ' + (await grant.text())).toBeTruthy(); await cce.close();
}

test('student guide video', async ({ page, browser, baseURL }) => {
  await page.addInitScript(OVERLAY);
  const reg = `DMC-A-2024-${digits()}`; const mail = `ayesha.khan${digits()}@example.test`;
  t0 = Date.now(); busyUntil = Date.now();

  // ── Intro ──────────────────────────────────────────────────────────────────────────────
  await card(page, 'Student guide', 'SZABMU Online Examination Center', 'Create your account and attempt your examination');
  await say('intro', ''); await done();
  await card(page, 'Before you begin', 'What you need', 'Your registration number &nbsp;·&nbsp; an email you can open now<br>A laptop or desktop with a stable connection');
  await say('need', 'Before you begin'); await done(300);

  // ── Part 1: create the account ─────────────────────────────────────────────────────────
  await page.goto('/login'); await wait(600);
  await say('open', 'Step 1 · Open the portal');
  await wait(3600); await tap(page, page.getByRole('link', { name: 'Create your account' }), 900);
  await page.getByLabel(/Registration number/).waitFor(); await done();
  await say('regno', 'Step 2 · Your details'); await type(page, page.getByLabel(/Registration number/), reg);
  await say('email', 'Step 2 · Your details'); await type(page, page.getByLabel(/Email address/), mail);
  await say('password', 'Step 2 · Your details'); await type(page, page.getByLabel(/^Password\b/), PW); await type(page, page.getByLabel(/Confirm password/), PW);
  await say('create', 'Step 2 · Your details'); await tap(page, page.getByRole('button', { name: 'Create Account' }), 900);
  await page.getByLabel('Digit 1').waitFor(); await done();
  await say('code', 'Step 3 · Verify your email'); await wait(4500);
  const code = ((await page.getByTestId('dev-code').locator('b').textContent()) ?? '').trim();
  for (let i = 0; i < 6; i++) { const d = page.getByLabel(`Digit ${i + 1}`); await glide(page, d); await d.fill(code[i]!); await wait(380); }
  await ring(page, null); await done();
  await say('confirm', 'Step 3 · Verify your email'); await tap(page, page.getByRole('button', { name: 'Create Account' }), 600);

  // ── Complete your profile ──────────────────────────────────────────────────────────────
  await page.getByRole('heading', { name: 'Complete your profile' }).waitFor(); await done();
  await say('profile', 'Step 4 · Complete your profile'); await done();
  await say('personal', 'Step 4 · Complete your profile');
  await type(page, page.getByLabel(/^Full name/), 'Ayesha Khan'); await type(page, page.getByLabel(/Father's name/), 'Imran Khan');
  await choose(page, page.getByLabel(/^Gender/), 'FEMALE'); await type(page, page.getByLabel(/Mobile number/), '+92 300 1234567'); await done();
  await say('college', 'Step 4 · Complete your profile');
  await choose(page, page.getByLabel(/College/), { label: 'Demo Medical College A (synthetic)' }); await wait(1600);
  const mbbs = ((await page.getByLabel(/Degree programme/).locator('option', { hasText: 'Bachelor of Medicine' }).first().textContent()) ?? '').trim();
  await choose(page, page.getByLabel(/Degree programme/), { label: mbbs }); await wait(500);
  await choose(page, page.getByLabel(/^Semester/), '4'); await choose(page, page.getByLabel(/Academic year/), '2024'); await done();
  await say('save', 'Step 4 · Complete your profile'); await tap(page, page.getByRole('button', { name: 'Save and continue' }), 600);
  await page.getByRole('heading', { name: 'My Examinations' }).waitFor(); await done();
  await say('empty', 'Step 5 · My Examinations'); await glide(page, page.getByTestId('no-exams')); await done();
  await say('verify', 'Step 5 · My Examinations'); await ring(page, null); await done(400);

  // ── Between the scenes: the examination office verifies and assigns (real staff API) ───
  await card(page, 'A little later', 'Verified and assigned', 'Your examination office has checked your details<br>and assigned your paper');
  await say('later', 'Step 6 · Sign in');
  await officeVerifiesAndAssigns(browser, baseURL!, reg);
  await page.context().clearCookies(); await done(200);

  // ── Part 2: attempt the paper ──────────────────────────────────────────────────────────
  await page.goto('/login'); await wait(500);
  await type(page, page.getByLabel('University email'), mail); await type(page, page.getByLabel('Password'), PW);
  await tap(page, page.getByRole('button', { name: /sign in/i }), 600); await page.waitForURL(/\/(dashboard|schedule)/); await wait(800);
  await say('menu', 'Step 7 · Find your paper'); await tap(page, page.getByRole('link', { name: 'My Examinations' }).first(), 600);
  await page.getByRole('heading', { name: 'My Examinations' }).waitFor(); await done();
  await say('available', 'Step 7 · Find your paper'); await glide(page, page.getByTestId('exams-available')); await wait(5200);
  await tap(page, page.getByTestId('exams-available').getByRole('link', { name: /Start/ }), 600);
  await page.getByRole('button', { name: /begin examination/i }).waitFor(); await done();
  await say('instructions', 'Step 8 · Read the instructions'); await wait(8500);
  await tap(page, page.getByRole('button', { name: /begin examination/i }), 600);
  await page.getByRole('timer').waitFor(); await done();

  const picks = ['B', 'A', 'C', 'D', 'B', 'A', 'C', 'B', 'D', 'A', 'C', 'B'];
  for (let i = 0; i < 12; i++) {
    if (i === 0) { await say('answer', 'Step 9 · Answer the questions'); await wait(3800); }
    if (i === 2) { await say('mark', 'Step 10 · Mark for review'); }
    if (i === 4) { await say('palette', 'Step 11 · The question palette'); }
    if (i === 7) { await say('autosave', 'Step 12 · Automatic saving'); }
    await tap(page, page.getByTestId(`opt-${picks[i]}`), 700);
    if (i === 0) await done();
    if (i === 2) { await wait(1800); await tap(page, page.getByRole('button', { name: 'Mark for review' }), 900); await done(); }
    if (i === 4) { await wait(2500); await tap(page, page.locator('.pal button').nth(1), 1100); await tap(page, page.locator('.pal button').nth(4), 700); await done(); }
    if (i === 0) { await say('next', 'Step 9 · Answer the questions'); await wait(1200); }
    if (i < 11) await tap(page, page.getByTestId('next-or-review'), 500);
  }
  await done();
  await say('last', 'Step 13 · Review and submit'); await wait(1200);
  await tap(page, page.getByTestId('next-or-review'), 900);
  if (!(await page.getByRole('heading', { name: 'Review your answers' }).isVisible())) await tap(page, page.getByRole('button', { name: /review & submit/i }), 900);
  await page.getByRole('heading', { name: 'Review your answers' }).waitFor(); await done();
  await say('review', 'Step 13 · Review and submit'); await wait(1500); await glide(page, page.getByText(/marked for review/).first()); await done();
  await say('submit', 'Step 13 · Review and submit'); await tap(page, page.getByRole('button', { name: /submit examination/i }), 600); await done();
  await say('tick', 'Step 14 · Confirm'); await wait(1600); await tap(page, page.getByRole('checkbox'), 3400);
  await tap(page, page.getByTestId('confirm-submit'), 600);
  await page.getByTestId('receipt').waitFor(); await done();
  await say('receipt', 'Step 15 · Your receipt'); await wait(3500); await glide(page, page.getByTestId('receipt-code')); await done(600); await ring(page, null);

  await card(page, 'You are ready', 'Best of luck!', 'Questions? Contact your campus examination office');
  await say('outro', ''); await done(800);

  fs.writeFileSync(path.join(OUT, 'timeline.json'), JSON.stringify({ end: now(), cues }, null, 1));
});
