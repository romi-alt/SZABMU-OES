import { expect, test, type Page } from '@playwright/test';
import { login } from './helpers';

/** UI-042: Results is the authoritative page. Performance (trends) is reached from Results and appears in the menu only once the student has published results. */
const nav = (page: Page) => page.getByRole('navigation', { name: 'Primary' });
const RESULT = { id: 'r1', status: 'PASS', percent: 72.5, rawScore: 29, totalMarks: 40, certificateSerial: null, exam: { code: 'MBBS-PATH-MT', opensAt: '2026-10-01T09:00:00.000Z', course: { title: 'Pathology', semester: 4, program: { code: 'MBBS' } } } };
const mockResults = (page: Page, rows: unknown[]) => page.route('**/api/me/results', (route) => route.fulfill({ json: rows }));

test('with nothing published: no Performance in the menu or dashboard shortcuts; the page explains and points back to Results', async ({ page }) => {
  await mockResults(page, []); await login(page, 'student.a001');
  await expect(nav(page).getByRole('link', { name: 'Results' })).toBeVisible(); await expect(nav(page).getByRole('link', { name: 'Performance' })).toHaveCount(0);
  await expect(page.getByTestId('quick-actions').getByRole('link', { name: /^Performance/ })).toHaveCount(0);
  await page.goto('/results'); await expect(page.getByText('No results have been published yet.')).toBeVisible(); await expect(page.getByRole('link', { name: /Performance trends/ })).toHaveCount(0);
  await page.goto('/performance'); await expect(page.getByTestId('performance-empty')).toContainText('Trends appear here after your first result is published'); await page.getByTestId('performance-empty').getByRole('link', { name: 'Go to Results' }).click(); await expect(page).toHaveURL(/\/results$/);
});

test('with a published result: Performance is in the menu, linked from Results, and shows the trends', async ({ page }) => {
  await mockResults(page, [RESULT]); await login(page, 'student.a001');
  await expect(nav(page).getByRole('link', { name: 'Performance' })).toBeVisible();
  await page.goto('/results'); await page.getByRole('link', { name: /Performance trends/ }).click(); await expect(page).toHaveURL(/\/performance$/);
  await expect(page.getByRole('heading', { name: 'Performance' })).toBeVisible(); await expect(page.getByText('72.5%').first()).toBeVisible(); await expect(page.getByRole('link', { name: '← Results' })).toBeVisible();
});
