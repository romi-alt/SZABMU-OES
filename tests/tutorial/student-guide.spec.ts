import fs from 'node:fs';
import path from 'node:path';
import { test, type Locator, type Page } from '@playwright/test';

/**
 * Records a captioned screen video of the student journey: sign up, complete the profile, sign in, attempt a paper, submit.
 * Uses synthetic data on the disposable local stack. The sign-up code is read from the dev response (the live site emails it).
 */
const PW = 'Sturdy-Pass-2026!x';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const letters = (n: number) => Array.from({ length: n }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('');

const OVERLAY = `(() => { try {
  const CSS = '#tut-cap{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);max-width:880px;z-index:2147483647;background:rgba(20,20,24,.92);color:#fff;font:600 21px/1.35 system-ui,sans-serif;padding:12px 22px;border-radius:12px;text-align:center;pointer-events:none;box-shadow:0 6px 24px rgba(0,0,0,.35)}#tut-cap small{display:block;font:500 14px system-ui;opacity:.75;margin-bottom:2px;letter-spacing:.06em;text-transform:uppercase}#tut-cur{position:fixed;width:22px;height:22px;margin:-4px 0 0 -4px;border-radius:50%;background:rgba(214,40,40,.55);border:2px solid #fff;z-index:2147483647;pointer-events:none}#tut-cur.dn{transform:scale(.7);background:rgba(214,40,40,.9)}[data-testid=dev-code]{display:none!important}';
  let x = -50, y = -50, down = false;
  const ensure = () => {
    const root = document.documentElement; if (!root) return;
    let st = document.getElementById('tut-style'); if (!st) { st = document.createElement('style'); st.id = 'tut-style'; st.textContent = CSS; root.appendChild(st); }
    let k = document.getElementById('tut-cur'); if (!k) { k = document.createElement('div'); k.id = 'tut-cur'; root.appendChild(k); }
    k.style.left = x + 'px'; k.style.top = y + 'px'; k.className = down ? 'dn' : '';
  };
  document.addEventListener('mousemove', (e) => { x = e.clientX; y = e.clientY; ensure(); }, true);
  document.addEventListener('mousedown', () => { down = true; ensure(); }, true); document.addEventListener('mouseup', () => { down = false; ensure(); }, true);
  setInterval(ensure, 120); ensure();
} catch (e) {} })();`;

// Captions are not drawn in the page (they would cover the exam controls): their timings are saved and burned into a strip below the video by build-video.mjs.
const caps: { t: number; step: string; text: string }[] = []; let t0 = 0;
async function say(_page: Page, step: string, text: string, hold = 0) { caps.push({ t: (Date.now() - t0) / 1000, step, text }); if (hold) await wait(hold); }
async function glide(page: Page, loc: Locator) {
  await loc.scrollIntoViewIfNeeded(); const b = await loc.boundingBox(); if (!b) return;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 28 }); await wait(250);
}
async function tap(page: Page, loc: Locator, pause = 700) { await glide(page, loc); await loc.click(); await wait(pause); }
async function type(page: Page, loc: Locator, text: string) { await glide(page, loc); await loc.click(); await loc.pressSequentially(text, { delay: 70 }); await wait(350); }
async function card(page: Page, title: string, sub: string, ms: number) {
  await say(page, '', '');
  await page.goto('about:blank');
  await page.setContent(`<body style="margin:0;height:100vh;display:grid;place-items:center;background:#7a1f2b;color:#fff;font-family:system-ui,sans-serif;text-align:center"><div><div style="font-size:54px;font-weight:700;letter-spacing:.01em">${title}</div><div style="font-size:26px;margin-top:18px;opacity:.9">${sub}</div></div></body>`);
  await wait(ms);
}

test('student guide video', async ({ page }) => {
  await page.addInitScript(OVERLAY);
  const reg = `DMC-A-2026-${String(Math.floor(1000 + Math.random() * 8999))}`; const mail = `${letters(7)}@example.test`;

  t0 = Date.now(); await say(page, '', '');
  await card(page, 'SZABMU Online Examination Center', 'Student guide: sign up and attempt your paper', 4500);

  // ── Part 1: create the account ─────────────────────────────────────────────────────────
  await page.goto('/register'); await wait(1200);
  await say(page, 'Step 1 · Open the portal', 'Go to szabmu.site and choose Create Account', 3500);
  await say(page, 'Step 2 · Your details', 'Type your registration number exactly as printed on your card', 0);
  await type(page, page.getByLabel(/Registration number/), reg);
  await say(page, 'Step 2 · Your details', 'Enter an email address you can open right now: the code is sent there', 0);
  await type(page, page.getByLabel(/Email address/), mail);
  await say(page, 'Step 2 · Your details', 'Choose a strong password and type it again to confirm', 0);
  await type(page, page.getByLabel(/^Password\b/), PW); await type(page, page.getByLabel(/Confirm password/), PW);
  await say(page, 'Step 2 · Your details', 'Press Create Account', 0);
  await tap(page, page.getByRole('button', { name: 'Create Account' }), 1500);
  await say(page, 'Step 3 · Verify your email', 'Open the email, find the 6-digit code and type it in', 2500);
  const code = ((await page.getByTestId('dev-code').locator('b').textContent()) ?? '').trim();
  for (let i = 0; i < 6; i++) { const d = page.getByLabel(`Digit ${i + 1}`); await glide(page, d); await d.fill(code[i]!); await wait(450); }
  await say(page, 'Step 3 · Verify your email', 'Press Create Account again to confirm', 0);
  await tap(page, page.getByRole('button', { name: 'Create Account' }), 2200);

  // ── Complete your profile (one time) ──────────────────────────────────────────────────
  await page.getByRole('heading', { name: 'Complete your profile' }).waitFor();
  await say(page, 'Step 4 · Complete your profile', 'You are signed in. This form appears once: fill in your personal details', 3500);
  await type(page, page.getByLabel(/^Full name/), 'Ayesha Khan'); await type(page, page.getByLabel(/Father's name/), 'Imran Khan');
  await glide(page, page.getByLabel(/^Gender/)); await page.getByLabel(/^Gender/).selectOption('FEMALE'); await wait(600);
  await type(page, page.getByLabel(/Mobile number/), '+92 300 1234567');
  await say(page, 'Step 4 · Complete your profile', 'Pick your college first: the programme list then shows only what that college offers', 0);
  await glide(page, page.getByLabel(/College/)); await page.getByLabel(/College/).selectOption({ label: 'Demo Medical College A (synthetic)' }); await wait(1400);
  await glide(page, page.getByLabel(/Degree programme/)); await page.getByLabel(/Degree programme/).selectOption({ index: 1 }); await wait(1000);
  await glide(page, page.getByLabel(/^Semester/)); await page.getByLabel(/^Semester/).selectOption('4'); await wait(800);
  await glide(page, page.getByLabel(/Academic year/)); await page.getByLabel(/Academic year/).selectOption('2024'); await wait(800);
  await say(page, 'Step 4 · Complete your profile', 'Check everything, then press Save and continue', 0);
  await tap(page, page.getByRole('button', { name: 'Save and continue' }), 2500);

  await page.getByRole('heading', { name: 'My Examinations' }).waitFor();
  await say(page, 'Step 5 · My Examinations', 'This is your home page. Exams appear here once your campus examination office has verified your details and assigned them to you.', 6500);
  await say(page, 'Tip', 'Signing up or completing the form never gives exam access by itself. Contact your examination office if nothing appears.', 6000);

  // ── Part 2: attempt a paper (an already-verified student with a paper assigned) ───────
  await card(page, 'Attempting your paper', 'Signing in as a student whose exam has been assigned', 3500);
  await page.context().clearCookies(); await page.goto('/login'); await wait(1000);
  await say(page, 'Step 6 · Sign in', 'Use your university email and password', 0);
  await type(page, page.getByLabel('University email'), 'student.a004@demo.szabmu.invalid'); await type(page, page.getByLabel('Password'), 'Demo-Passw0rd-2026!');
  await tap(page, page.getByRole('button', { name: /sign in/i }), 2500);
  await say(page, 'Step 7 · Find your exam', 'Open My Examinations. Available exams can be started now; Upcoming ones open at their start time', 0);
  await tap(page, page.getByRole('link', { name: 'My Examinations' }).first(), 2500);
  await say(page, 'Step 7 · Find your exam', 'Press Start on the available paper', 0);
  await tap(page, page.getByRole('link', { name: /Start/ }), 2500);
  await say(page, 'Step 8 · Read the instructions', 'Read the rules, duration and marks. The timer runs on the server, so it cannot be paused', 6000);
  await tap(page, page.getByRole('button', { name: /begin examination/i }), 2500);

  await say(page, 'Step 9 · Answer the questions', 'Click an option to answer. It says Saved once the server has your answer. You can also press A, B, C or D', 5500);
  const picks = ['B', 'A', 'C', 'D', 'B', 'A', 'C', 'B', 'D', 'A', 'C', 'B'];
  for (let i = 0; i < 12; i++) {
    if (i === 2) await say(page, 'Step 10 · Mark for review', 'Not sure? Mark the question for review. You can come back to it from the palette on the right', 0);
    if (i === 4) await say(page, 'Step 11 · The palette', 'The palette shows answered, unanswered and marked questions. Click any number to jump there', 0);
    if (i === 7) await say(page, 'Step 12 · Keep going', 'Your answers are saved as you go. If your connection drops, the page recovers and keeps your work', 0);
    await tap(page, page.getByTestId(`opt-${picks[i]}`), 900);
    if (i === 2) { await tap(page, page.getByRole('button', { name: 'Mark for review' }), 1200); }
    if (i === 4) { const pal = page.locator('.pal button').nth(1); await tap(page, pal, 1200); await tap(page, page.locator('.pal button').nth(4), 900); }
    if (i < 11) await tap(page, page.getByTestId('next-or-review'), 600);
  }
  await say(page, 'Step 13 · Finish', 'On the last question, press Review answers', 0);
  await tap(page, page.getByTestId('next-or-review'), 1200).catch(() => {});
  await tap(page, page.getByRole('button', { name: /review & submit/i }), 1500).catch(() => {});
  await page.getByRole('heading', { name: 'Review your answers' }).waitFor();
  await say(page, 'Step 13 · Review', 'Check the summary. Go back to any question that is unanswered or marked, then press Submit examination', 6500);
  await tap(page, page.getByRole('button', { name: /submit examination/i }), 1500);
  await say(page, 'Step 14 · Confirm', 'Tick the box to confirm. Once submitted you cannot change your answers', 0);
  await tap(page, page.getByRole('checkbox'), 1000);
  await tap(page, page.getByTestId('confirm-submit'), 2500);
  await page.getByTestId('receipt').waitFor();
  await say(page, 'Step 15 · Your receipt', 'Done. Keep your receipt code: it proves your submission. Results are published later by the examination office.', 8000);

  await card(page, 'Good luck!', 'Questions? Contact your campus examination office', 3500);
  caps.push({ t: (Date.now() - t0) / 1000, step: '', text: '' });
  fs.writeFileSync(path.join(process.env.TUTORIAL_OUT ?? 'test-results-tutorial', 'captions.json'), JSON.stringify(caps, null, 1));
});
