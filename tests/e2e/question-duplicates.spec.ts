import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { login } from './helpers';

/** F2a: the question bank's "Possible duplicates…" dialog lists similar pairs, opens either question, and passes an axe scan. */
test('examiner finds a reworded copy through Possible duplicates', async ({ page }) => {
  await login(page, 'examiner');
  // create a reworded copy of an approved Pathology question through the real API
  const list = await (await page.request.get('/api/questions?pageSize=50&status=APPROVED')).json();
  const src = list.items.find((q: { course: { code: string } }) => q.course.code === 'MBBS-PATH-4');
  const full = await (await page.request.get(`/api/questions/${src.id}`)).json();
  const made = await page.request.post('/api/questions', { data: { courseId: full.courseId, institutionId: full.institutionId, type: full.type, vignette: full.vignette ?? undefined, difficulty: full.difficulty,
    stem: `${full.stem.replace(/\?$/, '')} (duplicate check)?`, options: [...full.options].reverse().map((o: { text: string; isCorrect: boolean }, i: number) => ({ label: 'ABCDE'[i], text: o.text, isCorrect: o.isCorrect })) } });
  expect(made.status()).toBe(201);

  await page.goto('/questions'); await page.getByRole('button', { name: 'Possible duplicates…' }).click();
  const dlg = page.getByRole('dialog', { name: 'Possible duplicate questions' }); await expect(dlg.getByTestId('duplicates')).toBeVisible();
  const pair = dlg.locator('li').filter({ hasText: '(duplicate check)' }).first(); await expect(pair).toContainText('% similar');
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
  await pair.getByRole('button', { name: 'Open' }).first().click(); await expect(dlg).toHaveCount(0);
});
