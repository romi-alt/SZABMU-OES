import { expect, test } from '@playwright/test';
import { login } from './helpers';

/** T-PSY: the examiner sees the item statistics summary, the small-sample warning and a plain-language legend on the exam page. */
test('item analysis shows statistics with sample-size caveat and legend', async ({ page }) => {
  await login(page, 'examiner');
  const list = await (await page.request.get('/api/exams?pageSize=50')).json(); const exam = (list.items ?? list).find((e: { code: string }) => e.code === 'MBBS-PATH-MT');
  // The results/analysis section appears once an exam is closed; the seeded exam must stay LIVE for later specs, so only the exam's
  // status field is rewritten in the page's own request. The statistics and results come from the real API (tested in item-statistics.test.ts).
  await page.route(`**/api/exams/${exam.id}`, async (route) => { const r = await route.fetch(); const j = await r.json(); await route.fulfill({ response: r, json: { ...j, status: 'RESULT_PENDING' } }); });
  await page.goto(`/exams/${exam.id}`);
  const summary = page.getByTestId('item-stats-summary'); await expect(summary).toBeVisible();
  // the seeded exam usually has no submissions when this spec runs; either state must read correctly and never claim "0 scored questions"
  await expect(summary).toContainText(/12 scored questions/);
  if (/No submitted attempts yet/.test(await summary.innerText())) await expect(page.getByText(/statistics are unstable/)).toHaveCount(0);
  else await expect(page.getByText(/the statistics are unstable and no question is flagged/)).toBeVisible();
  await expect(page.getByTestId('item-stats-legend')).toContainText('Discrimination D');
  await expect(page.getByRole('columnheader', { name: 'Item–rest r' })).toBeVisible();
  await page.getByTestId('item-stats-summary').scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('item-analysis.png'), fullPage: false });
});
