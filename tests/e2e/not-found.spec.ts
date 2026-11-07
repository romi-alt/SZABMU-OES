import { expect, test } from '@playwright/test';

/** The 404 page offers two ways out, and both labels are readable (a ghost button once rendered white text on a white card). */
test('the page-not-found screen shows both buttons with readable labels', async ({ page }) => {
  await page.goto('/no-such-page-here'); await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  const signIn = page.getByRole('link', { name: 'Sign in' }); await expect(signIn).toBeVisible();
  expect(await signIn.evaluate((e) => getComputedStyle(e).color)).not.toBe('rgb(255, 255, 255)');
  const dash = page.getByRole('link', { name: /Go to dashboard/ }); expect(await dash.evaluate((e) => getComputedStyle(e).color)).toBe('rgb(255, 255, 255)');
});
