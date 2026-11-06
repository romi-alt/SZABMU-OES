import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { login } from './helpers';

/** Audit A-04: on phones long tables show the key columns per row and fold the rest behind "Show details"; desktop is unchanged. */
const PAGES = [
  { who: 'admin.a', path: '/students', hidden: 'Email', shown: 'Name', max: 160 },
  { who: 'super.admin', path: '/audit', hidden: 'About', shown: 'What happened', max: 160 },
  { who: 'examiner', path: '/questions', hidden: 'Difficulty', shown: 'Status', max: 200 },
] as const;

test.describe('phone (390 px)', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  for (const p of PAGES) {
    test(`${p.path}: key columns only, details on demand, shorter rows`, async ({ page }, ti) => {
      await login(page, p.who); await page.goto(p.path);
      const row = page.locator('tbody tr').first(); await expect(row).toBeVisible();
      await expect(row.locator(`td[data-label="${p.shown}"]`)).toBeVisible();
      await expect(row.locator(`td[data-label="${p.hidden}"]`)).toBeHidden();
      const folded = (await row.boundingBox())!.height;
      const toggle = row.getByRole('button', { name: /^Show details/ }); await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await toggle.click();
      await expect(row.locator(`td[data-label="${p.hidden}"]`)).toBeVisible();
      await expect(row.getByRole('button', { name: /^Hide details/ })).toHaveAttribute('aria-expanded', 'true');
      expect((await row.boundingBox())!.height).toBeGreaterThan(folded);
      expect(folded).toBeLessThan(p.max);                                  // before: students 208, audit 177–214, questions 266–295 px at 390 px wide
      const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
      if (violations.length) await ti.attach('axe.json', { body: JSON.stringify(violations, null, 2), contentType: 'application/json' });
      expect(violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
      await row.getByRole('button', { name: /^Hide details/ }).click(); await expect(row.locator(`td[data-label="${p.hidden}"]`)).toBeHidden();
    });
  }
});

test.describe('desktop (1280 px)', () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  for (const p of PAGES) {
    test(`${p.path}: every column visible, no toggle`, async ({ page }) => {
      await login(page, p.who); await page.goto(p.path);
      const row = page.locator('tbody tr').first(); await expect(row).toBeVisible();
      await expect(row.locator(`td[data-label="${p.hidden}"]`)).toBeVisible();
      await expect(row.getByRole('button', { name: /details/i })).toHaveCount(0);
      await expect(page.getByRole('columnheader', { name: p.hidden, exact: true })).toBeVisible();
    });
  }
});
