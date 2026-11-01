import { expect, test, type Page } from '@playwright/test';
import { login } from './helpers';

// Nothing a user sees may carry internals.
const noInternals = async (page: Page) => {
  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(/node_modules|\.tsx?:\d+|at \w+ \(|TypeError|ReferenceError|Unexpected token|stack|ECONN|prisma|SELECT |digest:/i);
};

test.describe('error and recovery states', () => {
  test('404: unknown page shows the branded not-found page with a way out', async ({ page }) => {
    const res = await page.goto('/this-page-does-not-exist');
    expect(res?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Go to dashboard' })).toBeVisible();
    await expect(page.locator('img[src*="logo"]').first()).toBeVisible();      // university identity retained
    await noInternals(page);
  });

  test('403: a student opening an admin URL sees a clear access-denied panel, not data', async ({ page }) => {
    await login(page, 'student.a001');
    await page.goto('/users');
    await expect(page.getByTestId('error-forbidden')).toBeVisible();
    await expect(page.getByRole('heading', { name: /do not have access/i })).toBeVisible();
    await expect(page.getByText(/This page is available to:/)).toBeVisible();      // names who can use the page
    await expect(page.getByRole('link', { name: 'Go to dashboard' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);    // retrying a refusal is pointless
    await noInternals(page);
  });

  test('expired session: the next request returns the user to sign-in with an explanation', async ({ page, context }) => {
    await login(page, 'student.a001');
    await page.waitForLoadState('networkidle');                                     // let the dashboard's own requests finish: expiring the cookie mid-load would (correctly) redirect before the click
    await context.clearCookies();                                                   // the session cookie is gone (expiry / revoked elsewhere)
    await page.getByRole('navigation').getByRole('link', { name: 'Results' }).click();                       // any in-app request now gets 401 UNAUTHENTICATED
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByTestId('session-expired')).toContainText(/session has expired/i);
    await page.getByLabel('University email').fill('student.a001@demo.szabmu.invalid');
    await page.getByLabel('Password').fill('Demo-Passw0rd-2026!');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('network unavailable: offline panel with retry, and retry recovers', async ({ page }) => {
    await login(page, 'student.a001');
    await page.route('**/api/me/exams', (r) => r.abort('connectionfailed'));
    await page.goto('/schedule');
    await expect(page.getByTestId('error-network')).toBeVisible();
    await expect(page.getByRole('heading', { name: /appear to be offline/i })).toBeVisible();
    await noInternals(page);
    await page.unroute('**/api/me/exams');
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByTestId('error-network')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Exam schedule' })).toBeVisible();
  });

  test('API temporarily unavailable (503, and a gateway 500 that is not our JSON): unavailable panel with retry', async ({ page }) => {
    await login(page, 'student.a001');
    await page.route('**/api/me/exams', (r) => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'UNAVAILABLE', message: 'db down' }) }));
    await page.goto('/schedule');
    await expect(page.getByTestId('error-unavailable')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    await noInternals(page);
    await page.unroute('**/api/me/exams');
    await page.route('**/api/me/exams', (r) => r.fulfill({ status: 500, contentType: 'text/plain', body: 'Internal Server Error' }));
    await page.reload();
    await expect(page.getByTestId('error-unavailable')).toBeVisible();
  });

  test('unexpected application error: boundary inside the shell, no stack or message, retry works', async ({ page }) => {
    await login(page, 'student.a001');
    await page.route('**/api/me/exams', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [null] }) }));   // a payload the page cannot render: the error boundary, not a blank screen
    await page.goto('/schedule');
    await expect(page.getByTestId('error-boundary')).toBeVisible();
    await expect(page.getByRole('navigation').first()).toBeVisible();               // the portal shell is still there
    await expect(page.getByRole('heading', { name: /hit a problem/i })).toBeVisible();
    await noInternals(page);
    await page.unroute('**/api/me/exams');
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('heading', { name: 'Exam schedule' })).toBeVisible();
    await expect(page.getByTestId('error-boundary')).toHaveCount(0);
  });
});
