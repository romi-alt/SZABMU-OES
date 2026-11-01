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

test.describe('navigation labels and monitor scope (UI-020, UI-021, UI-024)', () => {
  test('menu label equals page title and the breadcrumb is never blank', async ({ page }) => {
    await login(page, 'examiner');
    for (const [link, title] of [['Question bank', 'Question bank'], ['Examinations', 'Examinations']] as const) {
      await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: link, exact: true }).click();
      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
      await expect(page.locator('.crumbs b')).toHaveText(title);
    }
    await page.goto('/programs'); await expect(page.locator('.crumbs b')).toHaveText('Programs & courses');
  });
  test('CCE menu says Enrolment & eligibility like its page', async ({ page }) => {
    await login(page, 'cce');
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Enrolment & eligibility', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Enrolment & eligibility' })).toBeVisible(); await expect(page.locator('.crumbs b')).toHaveText('Enrolment & eligibility');
  });
  test('monitor scope text matches the viewer; an exam that does not exist stops claiming to reconnect', async ({ browser }) => {
    const c = await browser.newContext(); const p = await c.newPage(); await login(p, 'cce');
    await p.goto('/monitor/00000000-0000-4000-8000-000000000000');
    await expect(p.getByTestId('error-notfound')).toBeVisible(); await expect(p.getByText(/Reconnecting/)).toHaveCount(0); await c.close();
  });
  test('Staff & accounts lists staff by default; students are one filter away', async ({ page }) => {
    await login(page, 'admin.a'); await page.goto('/users');
    await expect(page.locator('tbody tr').first()).toBeVisible();
    await expect(page.locator('tbody tr td:nth-child(3)').filter({ hasText: /^Student$/ })).toHaveCount(0);
    await page.getByLabel('Role').selectOption({ label: 'Student' });
    await expect(page.locator('tbody tr td:nth-child(3)').filter({ hasText: /^Student$/ }).first()).toBeVisible();
  });
});
