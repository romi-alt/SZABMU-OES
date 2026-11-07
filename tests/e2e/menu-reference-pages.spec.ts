import { expect, test } from '@playwright/test';
import { login } from './helpers';

/** UI-022: Institutions and Programs & courses are read-only reference pages. Staff roles that may open them find them in the menu; candidates and teachers (own sidebar) do not. */
const nav = (page: import('@playwright/test').Page) => page.getByRole('navigation', { name: 'Primary' });

for (const who of ['lecturer.a', 'examiner', 'admin.a', 'invigilator.a', 'cce']) {
  test(`${who}: the menu lists Institutions and Programs & courses, and both open`, async ({ page }) => {
    await login(page, who);
    await nav(page).getByRole('link', { name: 'Institutions' }).click(); await expect(page).toHaveURL(/\/institutions$/); await expect(page.getByRole('heading', { name: 'Institutions' })).toBeVisible();
    await nav(page).getByRole('link', { name: 'Programs & courses' }).click(); await expect(page).toHaveURL(/\/programs$/); await expect(page.getByRole('heading', { name: 'Programs & courses' })).toBeVisible();
  });
}

test('a campus administrator sees only their own institution on the reference page', async ({ page }) => {
  await login(page, 'admin.a'); await page.goto('/institutions'); await expect(page.locator('tbody tr')).toHaveCount(1); await expect(page.locator('tbody tr')).toContainText('DMC-A');
});

test('candidates have neither entry', async ({ page }) => {
  await login(page, 'student.a001'); await expect(nav(page).getByRole('link', { name: 'My Examinations' })).toBeVisible();
  await expect(nav(page).getByRole('link', { name: 'Institutions' })).toHaveCount(0); await expect(nav(page).getByRole('link', { name: 'Programs & courses' })).toHaveCount(0);
});
