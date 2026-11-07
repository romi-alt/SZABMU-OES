import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { login } from './helpers';

/** Programmes loaded from the official directory have no subjects. An administrator adds a programme's subjects in bulk (preview first); teachers then see them. */
test('a super administrator previews and adds a programme\'s subjects; they reach the teacher registration list; campus admins do not get the tool', async ({ page, browser }) => {
  await login(page, 'super.admin');
  const programs = (await (await page.request.get('/api/programs')).json()) as { id: string; code: string; name: string; courses: unknown[] }[];
  const empty = programs.find((p) => p.courses.length === 0)!; expect(empty, 'a programme with no subjects exists').toBeTruthy();
  await page.goto('/programs'); await expect(page.getByRole('heading', { level: 1, name: 'Programs & courses' })).toBeVisible();
  await page.getByRole('button', { name: `Add subjects in bulk to ${empty.code}` }).click();
  const dlg = page.getByRole('dialog', { name: /Add subjects/ }); await expect(dlg).toContainText(empty.name);
  await dlg.getByLabel(/Subjects/).fill(['semester,title,code,credits', '1,Test Anatomy', '1,"Test Physiology, Part A",TST-PHY-101,4', '2,Test Biochemistry', 'x,Broken row'].join('\n'));
  await expect(dlg.getByTestId('bulk-problems')).toContainText('Line 5'); await expect(dlg.getByRole('button', { name: 'Preview' })).toBeDisabled();       // a bad line blocks the preview: nothing is guessed or silently dropped
  await dlg.getByLabel(/Subjects/).fill(['semester,title,code,credits', '1,Test Anatomy', '1,"Test Physiology, Part A",TST-PHY-101,4', '2,Test Biochemistry'].join('\n'));
  await expect(dlg.getByTestId('bulk-problems')).toHaveCount(0); await dlg.getByRole('button', { name: 'Preview' }).click();
  await expect(dlg.getByTestId('bulk-preview')).toContainText('Test Anatomy'); await expect(dlg.getByTestId('bulk-preview')).toContainText('TST-PHY-101'); await expect(dlg.getByTestId('bulk-preview')).toContainText('Test Physiology, Part A');
  await expect(dlg).toContainText('internal reference'); expect(await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze().then((r) => r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id))).toEqual([]);
  expect((await (await page.request.get(`/api/courses?programId=${empty.id}`)).json()).length).toBe(0);                    // the preview wrote nothing
  await dlg.getByRole('button', { name: 'Add 3 subjects' }).click(); await expect(dlg).toHaveCount(0);
  const card = page.locator('section', { hasText: empty.code }).first(); await expect(card).toContainText('Test Anatomy'); await expect(card).toContainText('Test Physiology, Part A');
  const cat = await (await page.context().request.get('/api/teacher-registration/catalog')).json(); expect(cat.courses.filter((c: any) => c.programId === empty.id).map((c: any) => c.title)).toEqual(expect.arrayContaining(['Test Anatomy', 'Test Biochemistry']));
  const ctx = await browser.newContext(); const p2 = await ctx.newPage(); await login(p2, 'admin.a'); await p2.goto('/programs'); await expect(p2.getByRole('button', { name: /Add subjects in bulk/ })).toHaveCount(0); await ctx.close();
});
