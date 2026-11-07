import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { login } from './helpers';

/** UI-050: the top bar has a Help link to a short static page on every portal. It never invents contact details. */
for (const who of ['student.a001', 'lecturer.a', 'examiner', 'admin.a', 'invigilator.a', 'cce', 'super.admin']) {
  test(`${who}: the top bar has Help, and it opens the help page`, async ({ page }) => {
    await login(page, who);
    await page.getByRole('banner').getByRole('link', { name: 'Help' }).click(); await expect(page).toHaveURL(/\/help$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Help' })).toBeVisible(); await expect.poll(() => page.title()).toBe('Help · SZABMU OES');
  });
}

test('the help page covers sign-in, password reset and who to ask, without invented contact details, and is accessible', async ({ page }) => {
  await login(page, 'student.a001'); await page.goto('/help');
  const main = page.getByRole('main');
  for (const h of ['Signing in', 'Forgot your password', 'Examinations', 'Who to ask']) await expect(main.getByRole('heading', { name: new RegExp(h) })).toBeVisible();
  await expect(main.getByRole('link', { name: /reset your password/i })).toHaveAttribute('href', '/forgot');
  const text = await main.innerText(); expect(text).not.toMatch(/@[a-z0-9-]+\./i); expect(text).not.toMatch(/\d{7,}/); expect(text).toMatch(/campus examination office/i);
  const ax = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze(); expect(ax.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
});

test('the staff portal serves the help page', async ({ request }) => { expect((await request.get('http://localhost:3002/help')).status()).toBe(200); });
