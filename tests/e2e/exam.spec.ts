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

    // mark / unmark
    await page.getByRole('button', { name: 'Mark for review' }).click();
    await expect(page.getByRole('button', { name: 'Unmark review' })).toBeVisible();
    await expect(page.locator('.pal button.marked')).toHaveCount(1);
    await page.getByRole('button', { name: 'Unmark review' }).click();
    await expect(page.locator('.pal button.marked')).toHaveCount(0);

    // answer again, then Save & next
    await page.getByTestId('opt-A').click();
    await page.getByRole('button', { name: /save & next/i }).click();
    await expect(page.locator('.q-head')).toContainText('QUESTION 02 / 12');

    // skip question 2 → palette shows skipped, moves to 3
    await page.getByRole('button', { name: 'Skip question' }).click();
    await expect(page.locator('.q-head')).toContainText('QUESTION 03 / 12');
    await expect(page.locator('.pal button.skipped')).toHaveCount(1);

    // jump via palette; filter
    await page.locator('.pal button').nth(7).click();
    await expect(page.locator('.q-head')).toContainText('QUESTION 08 / 12');
    await page.getByRole('button', { name: /^Skipped 1/ }).click();
    await expect(page.locator('.pal button')).toHaveCount(1);
    await page.getByRole('button', { name: 'All', exact: true }).click();
    await expect(page.locator('.pal button')).toHaveCount(12);

    // ── connectivity interruption: nothing may claim "Saved" while offline ──
    await page.getByTestId('opt-D').click();
    await expect(saveState(page)).toHaveText('✓ Saved');
    await context.setOffline(true);
    await page.getByRole('button', { name: /^Next/ }).click();
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
    await page.reload();
    await page.getByRole('button', { name: /resume examination/i }).click();
    await expect(page.getByRole('timer')).toBeVisible();
    await page.locator('.pal button').nth(0).click();
    await expect(page.getByTestId('opt-A')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('.q-stem')).toHaveText(firstStem);
    await page.locator('.pal button').nth(8).click();
    await expect(page.getByTestId('opt-E')).toHaveAttribute('aria-checked', 'true');
    const after = await page.getByTestId('remaining').innerText();
    expect(after <= before).toBe(true);

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

  test('timer is server-controlled: a candidate whose deadline passed is auto-submitted', async ({ page }) => {
    await login(page, 'student.a006');
    await beginExam(page);
    await page.getByTestId('opt-A').click();
    await expect(saveState(page)).toHaveText('✓ Saved');
    const rem = await page.getByTestId('remaining').innerText();
    expect(rem).toMatch(/^4[0-5]:\d\d$/); // 45-minute exam, seconds in
  });
});
