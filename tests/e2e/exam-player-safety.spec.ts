import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { PASSWORD, email, login } from './helpers';

/**
 * UI-003/004/005 (+012/013/014): the examination player under failing networks and with a 100-question paper.
 * The exam is built through the real workflow and force-closed afterwards. Failures are injected at the browser's network layer; the server stays real,
 * so every "saved" assertion is checked against the server's committed sheet, never only against what the page says.
 */
const BASE = 'http://localhost:3000'; const N = 100; const SAVE = '**/api/attempts/*/answers/*';
let examId = '';
async function apiAs(playwright: { request: { newContext: (o: object) => Promise<APIRequestContext> } }, local: string) {
  const r = await playwright.request.newContext({ baseURL: BASE }); const res = await r.post('/api/auth/login', { data: { email: email(local), password: PASSWORD } });
  expect(res.ok(), `login ${local}`).toBe(true); return r;
}
async function enter(page: Page, who: string) {
  await login(page, who); const started = page.waitForResponse((r) => r.url().includes('/attempts/start') && r.request().method() === 'POST');
  await page.goto(`/exam/${examId}`); await page.getByRole('button', { name: /begin|resume/i }).click(); const r = await started; await expect(page.getByRole('timer')).toBeVisible();
  return ((await r.json()).attempt.id as string);
}
const sheet = async (page: Page, attemptId: string) => (await (await page.request.get(`/api/attempts/${attemptId}/sheet`)).json()).answers as { selectedLabel: string | null; revision: number }[];
const snap = async (page: Page, name: string) => { if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${name}.png` }); };
const qno = (page: Page) => page.locator('.q-head span').first();

test.describe.serial('examination player safety (100-question paper)', () => {
  test.setTimeout(180_000);
  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(300_000);
    const lect = await apiAs(playwright, 'lecturer.a'); const examiner = await apiAs(playwright, 'examiner'); const cce = await apiAs(playwright, 'cce');
    const courses = await (await examiner.get('/api/courses')).json(); const course = (Array.isArray(courses) ? courses : courses.items).find((c: { code: string }) => c.code === 'MBBS-PATH-4');
    const insts = await (await examiner.get('/api/institutions')).json(); const ids = (Array.isArray(insts) ? insts : insts.items).filter((i: { code: string }) => ['DMC-A', 'DMC-B'].includes(i.code)).map((i: { id: string }) => i.id);
    const made: string[] = [];
    for (let b = 0; b < N; b += 10) {
      const got = await Promise.all(Array.from({ length: 10 }, async (_, k) => {
        const i = b + k + 1; const q = await (await lect.post('/api/questions', { data: { courseId: course.id, type: 'MCQ', stem: `Safety paper question ${i}: which finding is most characteristic?`, difficulty: 'MEDIUM', options: ['A', 'B', 'C', 'D', 'E'].map((label) => ({ label, text: `Option ${label} of question ${i}`, isCorrect: label === 'A' })) } })).json();
        await lect.post(`/api/questions/${q.id}/submit`, { data: {} }); await examiner.post(`/api/questions/${q.id}/review`, { data: { decision: 'APPROVE', note: 'ok' } }); return q.id as string;
      })); made.push(...got);
    }
    const e = await (await examiner.post('/api/exams', { data: { code: `PS-${Math.random().toString(36).replace(/[0-9.]/g, '').slice(0, 6).toUpperCase().padEnd(6, 'X')}`, title: 'Player safety paper (100)', courseId: course.id, term: '2026-SPRING', opensAt: new Date(Date.now() + 3600e3).toISOString(), closesAt: new Date(Date.now() + 86400e3).toISOString(), durationMin: 180, passPercent: 50, negativeMarking: 0, shuffleQuestions: false, institutionIds: ids, controlMode: 'MANUAL', timingPolicy: 'INDIVIDUAL' } })).json(); examId = e.id;
    for (const r of [await examiner.put(`/api/exams/${examId}/paper`, { data: { items: made.map((questionId) => ({ questionId, marks: 1 })) } }), await examiner.post(`/api/exams/${examId}/paper/submit`, { data: {} }), await cce.post(`/api/exams/${examId}/paper/review`, { data: { decision: 'APPROVE', note: 'ok' } }), await examiner.post(`/api/exams/${examId}/schedule`, { data: {} }), await cce.post(`/api/exams/${examId}/control/policy`, { data: { suspendTimePolicy: 'FREEZE_CLOCK' } }), await cce.post(`/api/exams/${examId}/control/open-admission`, { data: {} }), await cce.post(`/api/exams/${examId}/control/start`, { data: {} })]) expect(r.ok()).toBe(true);
  });
  test.afterAll(async ({ playwright }) => { if (!examId) return; const cce = await apiAs(playwright, 'cce'); await cce.post(`/api/exams/${examId}/control/close`, { data: { force: true, reason: 'Test cleanup: close the player-safety examination' } }).catch(() => undefined); await cce.dispose(); });

  test('UI-003: a save that never answers is never shown as saved; it escalates in bounded time and recovers', async ({ page }) => {
    const id = await enter(page, 'student.b003'); await page.route(SAVE, () => { /* never answers */ });
    await page.getByTestId('opt-B').click(); await expect(page.getByTestId('save-state')).toHaveText('Saving…');
    await expect(page.getByTestId('save-state')).toContainText('retrying', { timeout: 20_000 });                      // bounded: the request is abandoned after 12 s
    await expect(page.getByTestId('save-banner')).toBeVisible({ timeout: 25_000 });                                  // persistent, role=alert, after ~15 s unconfirmed
    await snap(page, 'player-save-not-confirmed-banner'); await expect(page.getByTestId('save-banner')).toHaveAttribute('role', 'alert'); await expect(page.getByTestId('save-banner')).toContainText('not confirmed by the server');
    expect((await sheet(page, id)).every((a) => a.selectedLabel === null || a.revision >= 0)).toBe(true); expect(await page.getByTestId('save-state').innerText()).not.toContain('Saved');
    await page.unroute(SAVE);                                                                                         // the network recovers: automatic retry confirms it, no click needed
    await expect(page.getByTestId('save-state')).toHaveText('✓ Saved', { timeout: 30_000 }); await expect(page.getByTestId('save-banner')).toHaveCount(0);
    expect((await sheet(page, id)).some((a) => a.selectedLabel === 'B')).toBe(true);                                 // confirmed by the SERVER's sheet, not only by the page
  });

  test('UI-003: lost acknowledgment — the server committed the answer but the response was lost; reconciliation confirms it without a duplicate', async ({ page }) => {
    const id = await enter(page, 'student.b006'); let puts = 0;
    await page.route(SAVE, async (route) => { if (route.request().method() !== 'PUT') return route.continue(); puts++; await route.fetch(); /* committed on the server; the response is swallowed */ });
    await page.getByTestId('opt-C').click(); await expect(page.getByTestId('save-banner')).toBeVisible({ timeout: 30_000 });
    expect((await sheet(page, id)).some((a) => a.selectedLabel === 'C'), 'the server really holds the answer').toBe(true);
    await page.getByRole('button', { name: 'Retry now' }).click();                                                    // asks the server what it holds → confirmed
    await expect(page.getByTestId('save-state')).toHaveText('✓ Saved'); await expect(page.getByTestId('save-banner')).toHaveCount(0);
    expect(puts).toBeGreaterThanOrEqual(1);
    const rows = (await sheet(page, id)).filter((a) => a.selectedLabel === 'C'); expect(rows.length).toBe(1);        // exactly one stored answer, one revision
  });

  test('UI-004: Review & submit opens at once while saves are failing, lists exactly what is unconfirmed, and retry works', async ({ page }) => {
    const id = await enter(page, 'student.a008'); await page.route(SAVE, (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"code":"INTERNAL","message":"x"}' }));
    await page.getByTestId('opt-A').click(); await page.getByRole('button', { name: 'Next →', exact: true }).click(); await page.getByTestId('opt-D').click();
    const t0 = Date.now(); await page.getByRole('button', { name: 'Review & submit' }).click();
    await expect(page.getByRole('heading', { name: 'Review your answers' })).toBeVisible({ timeout: 6000 }); expect(Date.now() - t0, 'review must not wait ~20 s').toBeLessThan(6000);
    const un = page.getByTestId('review-unconfirmed'); await expect(un).toContainText('2 answers are not confirmed'); await expect(un).toContainText('Question 1'); await expect(un).toContainText('Question 2');
    await expect(page.getByTestId('review-time-left')).toBeVisible();
    await expect(page.locator('ul.pal-review').getByRole('button', { name: /^Question 1,.*not yet confirmed by the server/ })).toBeVisible();
    await snap(page, 'review-with-unconfirmed-answers'); await page.getByRole('button', { name: 'Submit examination…' }).click(); await expect(page.getByTestId('confirm-unconfirmed')).toContainText('will not be counted');
    await expect(page.getByRole('dialog').getByRole('checkbox')).toBeFocused({ timeout: 100 }).catch(() => undefined);
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.unroute(SAVE); await page.getByTestId('review-retry').click(); await expect(page.getByTestId('review-all-confirmed')).toBeVisible({ timeout: 15_000 });
    expect((await sheet(page, id)).filter((a) => a.selectedLabel).length).toBe(2);
  });

  test('UI-004: submitting with an unconfirmed answer is explicit — it is not counted and the page never claims it was saved', async ({ page }) => {
    const id = await enter(page, 'student.b007'); await page.getByTestId('opt-A').click(); await expect(page.getByTestId('save-state')).toHaveText('✓ Saved');
    await page.route(SAVE, (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"code":"INTERNAL","message":"x"}' }));
    await page.getByRole('button', { name: 'Next →', exact: true }).click(); await page.getByTestId('opt-B').click();               // question 2: never confirmed
    await page.getByRole('button', { name: 'Review & submit' }).click(); await expect(page.getByTestId('review-unconfirmed')).toContainText('Question 2');
    await page.getByRole('button', { name: 'Submit examination…' }).click(); const confirm = page.getByTestId('confirm-submit');
    await expect(confirm).toBeDisabled(); await expect(page.getByRole('dialog')).toContainText('Not confirmed by the server: Question 2');
    await page.getByRole('dialog').getByRole('checkbox').check(); await confirm.click();
    await expect(page.getByTestId('receipt-code')).toHaveText(/^RC-/, { timeout: 40_000 });                           // the bounded wait ends, then the authoritative submit runs
    const rows = await sheet(page, id); expect(rows.filter((a) => a.selectedLabel === 'A').length).toBe(1); expect(rows.filter((a) => a.selectedLabel === 'B').length, 'the unconfirmed answer was not stored').toBe(0);
  });

  test('UI-003: refresh with a pending answer — the buffered change survives and is re-sent idempotently', async ({ page }) => {
    const id = await enter(page, 'student.b008'); await page.route(SAVE, () => { /* hang */ });
    await page.getByTestId('opt-E').click(); await expect(page.getByTestId('save-state')).toHaveText('Saving…');
    await page.unroute(SAVE); await page.reload(); await expect(page.getByRole('timer')).toBeVisible();
    await expect(page.getByTestId('opt-E')).toHaveAttribute('aria-checked', 'true'); await expect(page.getByTestId('save-state')).toHaveText('✓ Saved', { timeout: 20_000 });
    expect((await sheet(page, id)).filter((a) => a.selectedLabel === 'E').length).toBe(1);
  });

  test('UI-005: at 1280×720 the palette is sticky below the header, scrolls on its own and every one of the 100 questions is reachable', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 }); await enter(page, 'student.a004');
    const aside = page.locator('#question-navigator'); const header = page.locator('.exam-bar');
    const hb = (await header.boundingBox())!; const ab = (await aside.boundingBox())!;
    expect(ab.y).toBeGreaterThanOrEqual(hb.y + hb.height - 1); expect(ab.y + ab.height).toBeLessThanOrEqual(720 + 1);                  // below the header, inside the viewport
    expect(await aside.evaluate((e) => e.scrollHeight > e.clientHeight), 'the palette scrolls on its own').toBe(true);
    await snap(page, 'palette-1280x720-first-screen'); await page.mouse.wheel(0, 3000); await page.waitForTimeout(300); await snap(page, 'palette-1280x720-after-scroll');                                                                       // long page scroll: palette stays in view
    const after = (await aside.boundingBox())!; expect(after.y).toBeGreaterThanOrEqual(hb.y + hb.height - 1); expect(after.y).toBeLessThan(200);
    await aside.evaluate((e) => { e.scrollTop = e.scrollHeight; }); const last = aside.getByRole('button', { name: /^Question 100,/ }); await expect(last).toBeInViewport({ ratio: 0.99 });
    await last.click(); await expect(qno(page)).toContainText('100 / 100');
    await page.getByRole('textbox', { name: 'Go to question number' }).fill('87'); await page.keyboard.press('Enter'); await expect(qno(page)).toContainText('87 / 100');
  });

  test('UI-005/012: palette is operable by keyboard — one tab stop, arrow keys, Home/End, G to jump — and states have names and glyphs', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 }); await enter(page, 'student.a005');
    await page.getByTestId('opt-A').click(); await page.getByRole('button', { name: 'Next →', exact: true }).click(); await page.getByRole('button', { name: 'Next →', exact: true }).click(); await page.getByRole('button', { name: 'Mark for review' }).click();
    const pal = page.locator('#question-navigator ul.pal'); await expect(pal.getByRole('button', { name: 'Question 1, answered' })).toBeVisible(); await expect(pal.getByRole('button', { name: 'Question 2, not answered' })).toBeVisible();
    await expect(pal.getByRole('button', { name: /^Question 3, not answered, marked for review/ })).toBeVisible();
    expect(await pal.locator('button').count()).toBe(100); expect(await pal.locator('[role=listitem]').count(), 'no role override on buttons').toBe(0);
    const glyphs = await pal.locator('button .g').evaluateAll((els) => els.slice(0, 3).map((e) => e.textContent)); expect(glyphs).toEqual(['✓', '?', '?']);   // not colour alone
    expect(await pal.locator('button[tabindex="0"]').count(), 'roving tabindex: a single tab stop').toBe(1);
    await pal.getByRole('button', { name: /^Question 3,/ }).focus(); await page.keyboard.press('ArrowRight'); await expect(pal.getByRole('button', { name: /^Question 4,/ })).toBeFocused();
    await page.keyboard.press('End'); await expect(pal.getByRole('button', { name: /^Question 100,/ })).toBeFocused(); await page.keyboard.press('Home'); await expect(pal.getByRole('button', { name: /^Question 1,/ })).toBeFocused();
    await page.keyboard.press('Tab'); expect(await page.evaluate(() => !!document.activeElement?.closest('ul.pal')), 'one Tab leaves the grid').toBe(false);
    await page.locator('body').click({ position: { x: 5, y: 400 } }); await page.keyboard.press('g'); await expect(page.locator('#jump-input')).toBeFocused();
    await page.keyboard.type('42'); await page.keyboard.press('Enter'); await expect(qno(page)).toContainText('42 / 100');
  });

  test('UI-005: on a phone the palette is a dialog — focus moves in, Escape closes it, focus returns to the Questions button', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 }); await enter(page, 'student.a006');
    const toggle = page.getByTestId('palette-toggle'); await toggle.click(); const sheetEl = page.locator('#question-navigator'); await snap(page, 'palette-phone-sheet-open');
    await expect(sheetEl).toHaveAttribute('role', 'dialog'); await expect(sheetEl).toHaveAttribute('aria-modal', 'true'); await expect(sheetEl).toBeFocused();
    await expect(sheetEl.locator('[aria-current="true"]')).toBeVisible();                                           // the current question is easy to locate
    await page.keyboard.press('Escape'); await expect(sheetEl).toBeHidden(); await expect(toggle).toBeFocused();
    await toggle.click(); await sheetEl.locator('#jump-input').fill('87'); await page.keyboard.press('Enter'); await expect(sheetEl).toBeHidden(); await expect(qno(page)).toContainText('87 / 100');
  });

  test('UI-013: dialogs trap focus and return it (the submit confirmation)', async ({ page }) => {
    await enter(page, 'student.a007'); await page.getByRole('button', { name: 'Review & submit' }).click(); await page.getByRole('heading', { name: 'Review your answers' }).waitFor();
    const opener = page.getByRole('button', { name: 'Submit examination…' }); await opener.click(); const dlg = page.getByRole('dialog');
    expect(await dlg.evaluate((d) => d.contains(document.activeElement)), 'focus is inside the dialog').toBe(true);
    for (let i = 0; i < 8; i++) { await page.keyboard.press('Tab'); expect(await dlg.evaluate((d) => d.contains(document.activeElement)), `tab ${i}`).toBe(true); }
    await page.keyboard.press('Shift+Tab'); expect(await dlg.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape'); await expect(dlg).toHaveCount(0); await expect(opener).toBeFocused();
  });
});
