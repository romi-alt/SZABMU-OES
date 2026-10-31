import { expect, type Page } from '@playwright/test';
export const PASSWORD = 'Demo-Passw0rd-2026!';
export const email = (local: string) => `${local}@demo.szabmu.invalid`;

export async function login(page: Page, local: string) {
  await page.goto('/login');
  await page.getByLabel('University email').fill(email(local));
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}
export const qnum = (page: Page) => page.locator('.q-head span').first();
