import { expect, test } from '@playwright/test';
import { login } from './helpers';

/** UI-018/019/029: one no-access pattern, no controls a role cannot use, row-aware action names. */
test.describe('access pattern', () => {
  test('a student opening the question bank, and staff opening candidate pages, get the same explained no-access page', async ({ browser }) => {
    const s = await browser.newContext(); const sp = await s.newPage(); await login(sp, 'student.a002');
    await sp.goto('/questions');
    const box = sp.getByTestId('error-forbidden'); await expect(box).toBeVisible();
    await expect(box.getByRole('heading', { name: 'You do not have access to Question bank' })).toBeVisible(); await expect(box).toContainText(/available to:.*Lecturer/);
    await expect(sp.getByRole('heading', { name: 'Question bank', exact: true })).toHaveCount(0); await expect.poll(() => sp.title()).toMatch(/No access/);
    await box.getByRole('link', { name: 'Go to dashboard' }).click(); await expect(sp).toHaveURL(/\/dashboard/); await s.close();
    const l = await browser.newContext(); const lp = await l.newPage(); await login(lp, 'lecturer.a');
    for (const [url, name] of [['/schedule', 'Exam schedule'], ['/results', 'Results']] as const) { await lp.goto(url); await expect(lp.getByRole('heading', { name: `You do not have access to ${name}` })).toBeVisible(); }
    await l.close();
  });
  test('allowed pages are unaffected', async ({ browser }) => {
    const l = await browser.newContext(); const lp = await l.newPage(); await login(lp, 'lecturer.a');
    await lp.goto('/questions'); await expect(lp.getByRole('heading', { name: 'Question bank' }).first()).toBeVisible(); await expect(lp.getByTestId('error-forbidden')).toHaveCount(0); await l.close();
  });
});

test('Examiner sees institutions read-only: no register or deactivate controls', async ({ page }) => {
  await login(page, 'examiner'); await page.goto('/institutions');
  await expect(page.locator('tbody tr').first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Register institution/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^(Deactivate|Activate)/ })).toHaveCount(0);
});

test('notification panel states how many are shown and can filter to unread', async ({ page }) => {
  await login(page, 'examiner');
  const bell = page.getByRole('button', { name: /^Notifications, \d+ unread/ });
  await expect(bell).toBeVisible(); await bell.click();
  const summary = page.getByTestId('bell-summary'); await expect(summary).toContainText(/unread/);
  const all = await page.getByTestId('notification-link').count();
  await page.getByLabel('Unread only').check();
  expect(await page.getByTestId('notification-link').count()).toBeLessThanOrEqual(all);
});
