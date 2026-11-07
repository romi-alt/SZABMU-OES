import { expect, test } from '@playwright/test';
import { login } from './helpers';

/** UI-023: staff dashboards show the examinations that are running now (not just a count), each linking to its live monitor. */
const RUNNING = ['ADMISSION_OPEN', 'LIVE', 'SUSPENDED', 'CLOSING'];

for (const who of ['cce', 'examiner', 'admin.a', 'invigilator.a']) {
  test(`${who}: the "Live now" card lists exactly the running examinations in scope, each linking to its monitor`, async ({ page }) => {
    await login(page, who);
    const exams = (await (await page.request.get('/api/invigilation/exams')).json()) as { id: string; code: string; status: string }[];
    const running = exams.filter((e) => RUNNING.includes(e.status));
    await page.goto('/dashboard'); await expect(page.getByRole('heading', { name: 'Live now' })).toBeVisible();
    if (!running.length) { await expect(page.getByTestId('live-empty')).toHaveText('No examination is running right now.'); return; }
    const links = page.getByTestId('live-list').getByRole('link'); await expect(links).toHaveCount(Math.min(running.length, 5));
    for (let i = 0; i < Math.min(running.length, 5); i++) {
      await expect(links.nth(i)).toHaveAttribute('href', `/monitor/${running[i]!.id}`); await expect(links.nth(i)).toContainText(running[i]!.code);
    }
  });
}

test('candidates, lecturers and the super administrator get no live-exams card', async ({ page }) => {
  for (const who of ['student.a001', 'lecturer.a', 'super.admin']) {
    await login(page, who); await page.goto('/dashboard'); await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Live now' }), who).toHaveCount(0);
    await page.context().clearCookies();
  }
});
