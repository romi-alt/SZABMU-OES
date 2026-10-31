import { expect, test } from '@playwright/test';
import { PASSWORD, email, login } from './helpers';

test.describe('authentication', () => {
  test('sign-in page shows the university identity and rejects bad credentials accessibly', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('img', { name: /Shaheed Zulfiqar Ali Bhutto Medical University/i }).first()).toBeVisible();
    await page.getByLabel('University email').fill(email('student.a002'));
    await page.getByLabel('Password').fill('wrong-password-1');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.locator('.notice.bad')).toContainText(/incorrect email or password/i);
    await expect(page).toHaveURL(/\/login/);
  });

  test('unauthenticated visitors are redirected to sign-in', async ({ page }) => {
    await page.goto('/students');
    await expect(page).toHaveURL(/\/login/);
  });

  test('student signs in, sees the student navigation only, and signs out', async ({ page }) => {
    await login(page, 'student.a002');
    const nav = page.getByRole('navigation', { name: 'Primary' });
    await expect(nav.getByRole('link', { name: 'Exam schedule' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Students' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Audit trail' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });

  test('a student who types an admin URL gets a permission error, not data', async ({ page }) => {
    await login(page, 'student.a003');
    await page.goto('/users');
    await expect(page.getByText(/not permitted/i)).toBeVisible();
  });

  test('password recovery: code → new password → sign in with it', async ({ page }) => {
    await page.goto('/forgot');
    await page.getByLabel('University email').fill(email('student.b004'));
    await page.getByRole('button', { name: /send verification code/i }).click();
    const dev = await page.getByTestId('dev-code').locator('b').innerText();
    await page.getByLabel('Digit 1').click();
    await page.keyboard.type(dev);
    await page.getByRole('button', { name: /^verify/i }).click();
    await page.getByLabel('New password', { exact: true }).fill('weak');
    await expect(page.getByRole('button', { name: /update password/i })).toBeDisabled();
    const strong = 'Playwright-New-Passw0rd!';
    await page.getByLabel('New password', { exact: true }).fill(strong);
    await expect(page.getByText('Strong password')).toBeVisible();
    await page.getByLabel('Confirm password').fill(strong);
    await page.getByRole('button', { name: /update password/i }).click();
    await expect(page.getByText(/password has been changed/i)).toBeVisible();
    await page.getByRole('link', { name: /back to sign in/i }).click();
    await page.getByLabel('University email').fill(email('student.b004'));
    await page.getByLabel('Password').fill(strong);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('public certificate verification rejects unknown serials', async ({ page }) => {
    await page.goto('/verify');
    await page.getByLabel('Serial').fill('SZABMU/2026/9999');
    await page.getByLabel('Verify code').fill('NOPE12');
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page.getByTestId('verify-bad')).toBeVisible();
    void PASSWORD;
  });
});
