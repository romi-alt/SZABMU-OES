import { expect, test } from '@playwright/test';
import { login } from './helpers';

/** Richer dashboards: every role gets icon tiles, quick actions that go to pages the role can open, and a recent-activity list. */
const ROLES: [string, RegExp][] = [['student.a001', /My Examinations/], ['lecturer.a', /Question bank/], ['examiner', /Review questions/], ['cce', /Papers & results/], ['admin.a', /Student register/], ['invigilator.a', /Live monitor/], ['super.admin', /Institutions/]];
for (const [who, first] of ROLES) {
  test(`${who}: quick actions open pages the role may use; recent activity is shown`, async ({ page }) => {
    await login(page, who); await expect(page.getByTestId('quick-actions')).toBeVisible();
    await expect(page.getByTestId('quick-actions').getByRole('link', { name: first })).toBeVisible();
    await expect(page.locator('.stat-ico').first()).toBeVisible();
    await expect(page.getByTestId('recent-activity').or(page.getByTestId('recent-empty'))).toBeVisible();
    const links = await page.getByTestId('quick-actions').getByRole('link').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).getAttribute('href')!));
    expect(links.length).toBeGreaterThan(1);
    for (const href of links) { await page.goto(href); await expect(page.locator('h1').first()).toBeVisible(); await expect(page.getByTestId('error-forbidden'), href).toHaveCount(0); await expect(page.getByText('This page hit a problem')).toHaveCount(0); }
  });
}
test('a notification in recent activity links to a real page and unread items are marked', async ({ page }) => {
  await login(page, 'examiner'); const list = page.getByTestId('recent-activity'); await expect(list).toBeVisible();
  await expect(list.locator('li.unread').first()).toBeVisible();
  const href = await list.locator('a').first().getAttribute('href'); expect(href).toMatch(/^\//);
});
test('dashboards fit a phone without sideways scroll', async ({ browser }) => {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 } }); const p = await c.newPage(); await login(p, 'cce'); await expect(p.getByTestId('quick-actions')).toBeVisible();
  expect(await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0); await c.close();
});
