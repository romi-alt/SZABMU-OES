import { expect, test } from '@playwright/test';
import { login } from './helpers';

/** UI-035: the lecturer portal has a "My courses" page, and returned questions show the reviewer's reason in the list and on the dashboard. */
test('a lecturer finds My courses in the menu; it lists exactly the assigned courses and opens the question bank for one', async ({ page }) => {
  await login(page, 'lecturer.a');
  const mine = (await (await page.request.get('/api/me/course-assignments')).json()) as { course: { id: string; code: string; title: string; program?: { code: string } } }[]; expect(mine.length).toBeGreaterThan(0);
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'My courses' }).click(); await expect(page).toHaveURL(/\/my-courses$/); await expect(page.getByRole('heading', { level: 1, name: 'My courses' })).toBeVisible();
  const rows = page.getByTestId('my-courses').locator('tbody tr'); await expect(rows).toHaveCount(mine.length);
  for (const a of mine) await expect(page.getByTestId('my-courses')).toContainText(a.course.code);
  const first = page.getByTestId('my-courses').getByRole('link', { name: /^Open question bank for/ }).first(); await expect(first).toHaveAttribute('href', new RegExp(`^/questions\\?courseId=${mine[0]!.course.id}$`));
  await first.click(); await expect(page).toHaveURL(/\/questions\?courseId=/); await expect(page.getByRole('heading', { level: 1, name: /Question bank/ })).toBeVisible();
});

test('a returned question shows the reviewer\'s reason in the list; the dashboard says how many were returned', async ({ page }) => {
  await page.route('**/api/questions?*', (route) => route.fulfill({ json: { total: 1, items: [{ id: 'q1', stem: 'Which organ produces insulin?', status: 'REJECTED', reviewNote: 'Option B is also correct; make the stem more specific.', type: 'MCQ', difficulty: 'EASY', usedCount: 0, correct: 'A', version: 1, authorId: 'x', course: { code: 'MBBS-PATH-4', title: 'Pathology' } }] } }));
  await login(page, 'lecturer.a'); await page.goto('/questions');
  await expect(page.getByTestId('returned-note')).toContainText('Option B is also correct'); await expect(page.getByTestId('returned-note')).toContainText('Returned');
  await page.route('**/api/dashboard', async (route) => { const r = await route.fetch(); const j = await r.json(); await route.fulfill({ response: r, json: { ...j, byStatus: { ...(j.byStatus ?? {}), REJECTED: 2 } } }); });
  await page.goto('/dashboard'); const link = page.getByTestId('attention-list').getByRole('link', { name: /returned for changes/ }); await expect(link).toContainText('2'); await expect(link).toHaveAttribute('href', '/questions?status=REJECTED');
});
