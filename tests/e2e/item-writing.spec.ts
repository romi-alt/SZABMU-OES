import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { login } from './helpers';

/** F2b (rule-based): the question editor shows item-writing advice while typing; it never blocks saving. */
test('the question editor gives item-writing advice for a negative stem and "all of the above"', async ({ page }) => {
  await login(page, 'examiner'); await page.goto('/questions');
  await page.getByRole('button', { name: '+ New question' }).click();
  const dlg = page.getByRole('dialog', { name: 'New question' });
  await dlg.getByLabel(/Question stem/).fill('Which of the following is NOT a feature of nephrotic syndrome?');
  for (const [l, t] of [['A', 'Proteinuria'], ['B', 'Hypoalbuminaemia'], ['C', 'Oedema'], ['D', 'All of the above']] as const) await dlg.getByLabel(`Option ${l} text`).fill(t);
  const advice = dlg.getByTestId('item-checks'); await expect(advice).toBeVisible();
  await expect(advice).toContainText('Negatively phrased lead-in'); await expect(advice).toContainText('"All/none of the above"');
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
  // rewriting the item clears the advice
  await dlg.getByLabel(/Question stem/).fill('Which finding is characteristic of nephrotic syndrome?'); await dlg.getByLabel('Option D text').fill('Haematuria with red-cell casts');
  await expect(advice).toHaveCount(0);
});
