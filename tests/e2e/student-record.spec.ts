import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { login } from './helpers';

/** UI-034: the Students list opens a read-only record (placement, enrolments, exam admission), scoped to the campus, with no marks. */
test('a campus administrator opens a student record from the list; it is read-only, accessible and has no marks', async ({ page }) => {
  await login(page, 'admin.a'); await page.goto('/students'); await expect(page.locator('tbody tr').first()).toBeVisible();
  const first = page.locator('tbody tr').first().getByRole('link', { name: /^Open the record of/ }); const name = (await first.innerText()).trim();
  await first.click(); await expect(page).toHaveURL(/\/students\/[0-9a-f-]{36}$/);
  const rec = page.getByTestId('student-record'); await expect(rec.getByRole('heading', { level: 1 })).toHaveText(name);
  await expect(rec).toContainText('Placement and account'); await expect(rec).toContainText('DMC-A'); await expect(rec.getByRole('heading', { name: /^Enrolments/ })).toBeVisible(); await expect(rec.getByRole('heading', { name: /^Examinations/ })).toBeVisible();
  await expect(rec).toContainText('read-only and does not show marks'); expect((await rec.innerText()).toLowerCase()).not.toMatch(/\bscore\b|\bmarks obtained\b/);
  await expect(rec.getByRole('button')).toHaveCount(0);       // nothing here edits anything
  const ax = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze(); expect(ax.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
  await page.getByRole('link', { name: '← Students' }).click(); await expect(page).toHaveURL(/\/students$/);
});

test('another campus\'s student cannot be opened by a campus administrator', async ({ page, browser }) => {
  const ctx = await browser.newContext(); const su = await ctx.newPage(); await login(su, 'super.admin');
  const other = (await (await su.request.get('/api/students?pageSize=200')).json()).items.find((s: any) => s.institution?.code === 'DMC-B' || s.institutionId !== undefined && s.regNo.startsWith('DMC-B')); await ctx.close();
  expect(other, 'a DMC-B student exists').toBeTruthy();
  await login(page, 'admin.a'); await page.goto(`/students/${other.id}`); await expect(page.getByText(/not found/i).first()).toBeVisible(); await expect(page.getByTestId('student-record')).toHaveCount(0);
});
