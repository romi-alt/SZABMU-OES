import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { login } from './helpers';

/** UI audit A-05: staff dashboards lead with "Needs your attention" (non-zero items only, plain sentences, deep links); tiles show they are links. */
const KEYS: Record<string, { key: string; href: string }[]> = {
  cce: [{ key: 'openIncidents', href: '/incidents' }, { key: 'liveExams', href: '/monitor' }, { key: 'papersToApprove', href: '/exams?status=PAPER_PENDING' }, { key: 'resultsToPublish', href: '/exams?status=RESULT_PENDING' }],
  examiner: [{ key: 'liveExams', href: '/monitor' }, { key: 'papersPending', href: '/exams?status=PAPER_PENDING' }, { key: 'questionsToReview', href: '/questions?status=SUBMITTED' }, { key: 'resultsToApprove', href: '/exams?status=RESULT_PENDING' }],
  'invigilator.a': [{ key: 'liveNow', href: '/monitor' }, { key: 'myOpenIncidents', href: '/incidents' }],
};

for (const [who, keys] of Object.entries(KEYS)) {
  test(`${who}: the attention list shows exactly the non-zero counts, in order, linking to the right list`, async ({ page }) => {
    await login(page, who);
    const d = await (await page.request.get('/api/dashboard')).json();
    const wanted = keys.filter((k) => Number(d[k.key] ?? 0) > 0);
    await page.goto('/dashboard'); await expect(page.getByRole('heading', { name: 'Needs your attention' })).toBeVisible();
    if (!wanted.length) { await expect(page.getByTestId('attention-empty')).toHaveText('Nothing needs your action right now.'); return; }
    const links = page.getByTestId('attention-list').getByRole('link');
    await expect(links).toHaveCount(wanted.length);
    for (let i = 0; i < wanted.length; i++) {
      await expect(links.nth(i)).toHaveAttribute('href', wanted[i]!.href);
      await expect(links.nth(i)).toContainText(String(d[wanted[i]!.key]));
    }
  });
}

test('students keep their own examinations card and get no staff attention list', async ({ page }) => {
  await login(page, 'student.a001'); await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Your examinations' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Needs your attention' })).toHaveCount(0);
});

test('tiles carry an arrow, and the dashboard has no serious accessibility violations', async ({ page }, ti) => {
  await login(page, 'cce'); await page.goto('/dashboard'); await expect(page.getByRole('heading', { name: 'Needs your attention' })).toBeVisible();
  const after = await page.locator('.dash-tiles > a').first().evaluate((el) => getComputedStyle(el, '::after').content);
  expect(after).toContain('›');
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  if (violations.length) await ti.attach('axe.json', { body: JSON.stringify(violations, null, 2), contentType: 'application/json' });
  expect(violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
});
