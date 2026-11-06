import { expect, test } from '@playwright/test';
import { login } from './helpers';

/** Audit A-06: primary buttons are not greyed out without a reason; pressing them with missing input says what is missing. */
test('sign in with empty fields explains what is missing and sends nothing', async ({ page }) => {
  let calls = 0; page.on('request', (r) => { if (r.url().includes('/api/auth/login')) calls++; });
  await page.goto('/login');
  const btn = page.getByRole('button', { name: 'Sign in' }); await expect(btn).toBeEnabled();
  await btn.click();
  await expect(page.getByText('Enter your university email.')).toBeVisible(); await expect(page.getByText('Enter your password.')).toBeVisible();
  expect(calls).toBe(0);
  await page.getByLabel('University email').fill('someone@demo.szabmu.invalid'); await btn.click();
  await expect(page.getByText('Enter your university email.')).toHaveCount(0); await expect(page.getByText('Enter your password.')).toBeVisible();
  expect(calls).toBe(0);
});

test('update password explains each problem instead of a silently disabled button', async ({ page }) => {
  await login(page, 'student.b006'); await page.goto('/profile');
  const btn = page.getByRole('button', { name: 'Update password' }); await expect(btn).toBeEnabled();
  await btn.click();
  await expect(page.getByText('Enter your current password.')).toBeVisible(); await expect(page.getByText('Enter a new password.')).toBeVisible();
  await page.getByLabel(/^New password/).fill('Sturdy-Pass-2026!x'); await page.getByLabel(/^Confirm new password/).fill('Different-Pass-2026!x'); await btn.click();
  await expect(page.getByText('The two new passwords do not match.')).toBeVisible();
});
