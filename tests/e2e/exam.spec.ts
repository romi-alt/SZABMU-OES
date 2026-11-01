import { execSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
import { login } from './helpers';

const saveState = (p: Page) => p.getByTestId('save-state');
async function beginExam(page: Page) {
  await page.goto('/schedule');
  await page.getByRole('link', { name: /Start/ }).click();
  await expect(page.getByRole('heading', { name: /Pathology Mid-term/ })).toBeVisible();
  await page.getByRole('button', { name: /begin examination/i }).click();
  await expect(page.getByRole('timer')).toBeVisible();
}

test.describe.serial('student examination — real API and database', () => {
  test('full sitting: answer, skip, mark, clear, filter, navigate, offline recovery, reload, review, submit, receipt', async ({ page, context, request }) => {
    await login(page, 'student.a004');
    await beginExam(page);

    // palette, counters, first question
    await expect(page.locator('.pal button')).toHaveCount(12);
    await expect(page.locator('.q-head')).toContainText('QUESTION 01 / 12');
    const firstStem = await page.locator('.q-stem').innerText();

    // choose → "Saved" only after the server acknowledges
    await page.getByTestId('opt-B').click();
    await expect(saveState(page)).toHaveText('✓ Saved');
    await expect(page.getByTestId('opt-B')).toHaveAttribute('aria-checked', 'true');

    // keyboard answer + clear
    await page.keyboard.press('c');
    await expect(page.getByTestId('opt-C')).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('button', { name: 'Clear response' }).click();
    await expect(page.getByTestId('opt-C')).toHaveAttribute('aria-checked', 'false');
    await expect(saveState(page)).toHaveText('✓ Saved');
    // UI-015: clearing is reversible — Undo restores the choice and it is saved again; then clear for the rest of the test
    await expect(page.getByTestId('clear-undo')).toBeVisible();
    await page.getByTestId('clear-undo').getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByTestId('opt-C')).toHaveAttribute('aria-checked', 'true'); await expect(saveState(page)).toHaveText('✓ Saved');
    await page.getByRole('button', { name: 'Clear response' }).click();
    await expect(page.getByTestId('opt-C')).toHaveAttribute('aria-checked', 'false'); await expect(saveState(page)).toHaveText('✓ Saved');

    // mark / unmark
    await page.getByRole('button', { name: 'Mark for review' }).click();
    await expect(page.getByRole('button', { name: 'Unmark review' })).toBeVisible();
    await expect(page.locator('.pal button.marked')).toHaveCount(1);
    await page.getByRole('button', { name: 'Unmark review' }).click();
    await expect(page.locator('.pal button.marked')).toHaveCount(0);

    // answer again, then Next (autosave: one forward action, no separate "Save & next" or "Skip")
    await page.getByTestId('opt-A').click();
    await page.getByTestId('next-or-review').click();
    await expect(page.locator('.q-head')).toContainText('QUESTION 02 / 12');
    await expect(page.getByRole('button', { name: /save & next|skip question/i })).toHaveCount(0);

    // moving on from question 2 without answering leaves it "not answered"
    await page.getByTestId('next-or-review').click();
    await expect(page.locator('.q-head')).toContainText('QUESTION 03 / 12');
    await expect(page.locator('.pal button.unanswered')).toHaveCount(2);                  // question 2, and question 3 which is open but not answered

    // UI-016: one forward action; "skipped" no longer exists as a separate state or filter
    await expect(page.getByTestId('next-or-review')).toHaveText('Next →');
    await expect(page.getByRole('group', { name: 'Filter questions' }).getByRole('button', { name: /^Skipped/ })).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Filter questions' }).getByRole('button', { name: /^Not answered/ })).toBeVisible();

    // jump via palette; filter
    await page.locator('.pal button').nth(7).click();
    await expect(page.locator('.q-head')).toContainText('QUESTION 08 / 12');
    await page.getByRole('button', { name: /^Not answered 3/ }).click();                  // questions 2, 3 and 8: visited, not answered
    await expect(page.locator('.pal button')).toHaveCount(3);
    await page.getByRole('button', { name: 'All', exact: true }).click();
    await expect(page.locator('.pal button')).toHaveCount(12);

    // ── connectivity interruption: nothing may claim "Saved" while offline ──
    await page.getByTestId('opt-D').click();
    await expect(saveState(page)).toHaveText('✓ Saved');
    await context.setOffline(true);
    await page.getByRole('button', { name: 'Next →', exact: true }).click();
    await page.getByTestId('opt-E').click();
    await expect(saveState(page)).not.toHaveText('✓ Saved');
    await expect(page.getByText(/connection lost/i)).toBeVisible();
    // answer is still shown locally, and is mirrored only as a crash buffer
    await expect(page.getByTestId('opt-E')).toHaveAttribute('aria-checked', 'true');
    await context.setOffline(false);
    await expect(saveState(page)).toHaveText('✓ Saved', { timeout: 30_000 });
    await expect(page.getByText(/connection lost/i)).toHaveCount(0);

    // reload mid-exam: server state restores answers; clock keeps running from the server deadline
    const before = await page.getByTestId('remaining').innerText();
    await page.reload();                                                                     // UI-040: no instructions page, no extra click
    await expect(page.getByRole('timer')).toBeVisible(); await expect(page.getByText(/Welcome back — you were taken straight to your examination/)).toBeVisible();
    await expect(page.getByRole('button', { name: /resume examination|begin examination/i })).toHaveCount(0);
    await page.locator('.pal button').nth(0).click();
    await expect(page.getByTestId('opt-A')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('.q-stem')).toHaveText(firstStem);
    await page.locator('.pal button').nth(8).click();
    await expect(page.getByTestId('opt-E')).toHaveAttribute('aria-checked', 'true');
    const after = await page.getByTestId('remaining').innerText();
    expect(after <= before).toBe(true);

    // the last question's forward action is "Review answers →" (UI-016)
    await page.locator('.pal button').nth(11).click(); await expect(page.getByTestId('next-or-review')).toHaveText('Review answers →');
    // review & submit
    await page.getByRole('button', { name: /review & submit/i }).click();
    await expect(page.getByRole('heading', { name: 'Review your answers' })).toBeVisible();
    await page.getByRole('button', { name: /submit examination/i }).click();
    const confirm = page.getByTestId('confirm-submit');
    await expect(confirm).toBeDisabled();
    await page.getByRole('checkbox').check();
    await confirm.click();
    await expect(page.getByTestId('receipt')).toBeVisible();
    const code = await page.getByTestId('receipt-code').innerText();
    expect(code).toMatch(/^RC-[0-9A-F]{4}(-[0-9A-F]{4}){3}$/);

    // after submission the exam cannot be re-entered; the schedule shows the receipt
    await page.goto('/schedule');
    await expect(page.getByText(code)).toBeVisible();
    void request;
  });

  test('a second window takes over; the first stops saving and says so', async ({ browser }) => {
    const ctx = await browser.newContext(); const a = await ctx.newPage();
    await login(a, 'student.a005');
    await beginExam(a);
    await a.getByTestId('opt-A').click();
    await expect(saveState(a)).toHaveText('✓ Saved');
    const b = await ctx.newPage(); // new tab → new sessionStorage → new client id
    await b.goto('/schedule'); await b.getByRole('link', { name: /Resume/ }).click();
    await b.getByRole('button', { name: /resume examination/i }).click();
    await expect(b.getByRole('timer')).toBeVisible();
    await expect(b.getByTestId('opt-A')).toHaveAttribute('aria-checked', 'true'); // server state carried over
    await a.getByTestId('opt-B').click();
    await expect(a.getByRole('dialog', { name: /open in another window/i })).toBeVisible();
    await ctx.close();
  });

  test('server clock rules: when the deadline passes the open page settles into an auto-submitted receipt with the saved answer', async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, 'student.a006');
    await beginExam(page);
    await page.getByTestId('opt-A').click();
    await expect(saveState(page)).toHaveText('✓ Saved');
    expect(await page.getByTestId('remaining').innerText()).toMatch(/^4[0-5]:\d\d$/); // 45-minute exam, seconds in
    // The server is the authority: move this attempt's deadline to ~2 s from now directly in the database.
    execSync(`psql "${process.env.DATABASE_URL ?? 'postgresql://oes:oes_dev_password@localhost:5433/szabmu_oes'}" -c "UPDATE attempts SET \\"startedAt\\" = now() - interval '44 minutes', \\"deadlineAt\\" = now() + interval '2 seconds' WHERE \\"studentId\\" = (SELECT id FROM students WHERE \\"regNo\\" = 'DMC-A-2024-0006')"`, { stdio: 'pipe' });
    // next heartbeat (≤15 s) syncs the new deadline; the page then finishes the attempt itself
    await expect(page.getByTestId('receipt')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('Submitted automatically', { exact: true })).toBeVisible();
    await expect(page.getByTestId('receipt-code')).toHaveText(/^RC-/);
    const stored = execSync(`psql -At "${process.env.DATABASE_URL ?? 'postgresql://oes:oes_dev_password@localhost:5433/szabmu_oes'}" -c "SELECT a.status || ':' || aa.\\"selectedLabel\\" FROM attempts a JOIN attempt_answers aa ON aa.\\"attemptId\\" = a.id WHERE a.\\"studentId\\" = (SELECT id FROM students WHERE \\"regNo\\" = 'DMC-A-2024-0006') AND aa.\\"selectedLabel\\" IS NOT NULL"`, { encoding: 'utf8' }).trim();
    expect(stored).toBe('AUTO_SUBMITTED:A');
  });

  test('a manipulated device clock (6 h fast) changes neither the server-held deadline nor the visible countdown', async ({ page }) => {
    const dbUrl = process.env.DATABASE_URL ?? 'postgresql://oes:oes_dev_password@localhost:5433/szabmu_oes';
    await page.clock.install({ time: new Date(Date.now() + 6 * 3600_000) }); // browser believes it is 6 hours later
    await login(page, 'student.b005');
    await beginExam(page);
    await page.getByTestId('opt-C').click();
    await expect(saveState(page)).toHaveText('✓ Saved');
    expect(await page.getByTestId('remaining').innerText()).toMatch(/^4[0-5]:\d\d$/); // still ≈45 min, not 45 min + 6 h or 0
    const row = execSync(`psql -At "${dbUrl}" -c "SELECT round(extract(epoch from (a.\\"deadlineAt\\" - a.\\"startedAt\\"))/60) || '|' || (abs(extract(epoch from (now() - a.\\"startedAt\\"))) < 300) FROM attempts a JOIN students s ON s.id = a.\\"studentId\\" WHERE s.\\"regNo\\" = 'DMC-B-2024-0005'"`).toString().trim();
    expect(row).toBe('45|true'); // 45-minute window anchored to the SERVER's start time, regardless of the device clock
  });
});
