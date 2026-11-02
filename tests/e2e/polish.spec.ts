import { expect, test } from '@playwright/test';
import { login } from './helpers';

/** P3/P2 polish: UI-033 slow loading, 036/041/052 phone exam header + action bar, 038 audit wording, 044 bell name, 045 landmarks, 048 certificate error, 049 exams list, 051 not-eligible notice. */
test('UI-048: a certificate that does not exist has no print button and explains who gets certificates', async ({ page }) => {
  await login(page, 'student.a002'); await page.goto('/certificate/00000000-0000-4000-8000-000000000000');
  await expect(page.getByText(/Certificates are issued only for examinations you passed/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Print certificate' })).toHaveCount(0); await expect(page.locator('.crumbs b')).toHaveText('Certificate');
});

test('UI-049: the examinations list uses full column names, a role-specific subtitle, "Live now", and a Control centre link for controllers', async ({ page }) => {
  await login(page, 'cce'); await page.goto('/exams'); await expect(page.locator('tbody tr').first()).toBeVisible();
  for (const h of ['Window opens', 'Minutes', 'Questions', 'Candidates']) await expect(page.getByRole('columnheader', { name: h })).toBeVisible();
  await expect(page.getByText('Approve papers, control live examinations and publish results.')).toBeVisible();
  const live = page.locator('tbody tr', { hasText: 'MBBS-PATH-MT' }); await expect(live).toContainText('Live now'); await live.getByRole('link', { name: /Control centre for MBBS-PATH-MT/ }).click(); await expect(page).toHaveURL(/\/control$/);
});

test('UI-044/045: the bell is an icon whose name starts with "Notifications"; every page has one h1 and one main, including the exam player', async ({ page }) => {
  await login(page, 'examiner'); const bell = page.getByRole('button', { name: /^Notifications, \d+ unread/ }); await expect(bell).toBeVisible();
  expect((await bell.innerText()).replace(/\d+/g, '').trim(), 'no visible text that the name could contradict').toBe('');
  for (const h of ['/dashboard', '/questions', '/exams', '/monitor', '/incidents', '/profile', '/users']) {
    await page.goto(h); await page.locator('h1').first().waitFor(); expect(await page.locator('h1').count(), `${h} h1`).toBe(1); expect(await page.locator('main').count(), `${h} main`).toBe(1);
  }
});

test('UI-033: a list that never answers says so after 8 s and offers Try again', async ({ page }) => {
  test.setTimeout(60_000); await login(page, 'student.a002');
  let hang = true; await page.route('**/api/me/exams', async (r) => { if (hang) await new Promise(() => undefined); else await r.continue(); });
  await page.goto('/schedule'); await expect(page.getByTestId('slow-loading')).toHaveCount(0);
  await expect(page.getByTestId('slow-loading')).toBeVisible({ timeout: 15_000 }); await expect(page.getByTestId('slow-loading')).toContainText('taking longer than usual');
  hang = false; await page.getByTestId('slow-loading').getByRole('button', { name: 'Try again' }).click(); await expect(page.getByTestId('slow-loading')).toHaveCount(0, { timeout: 15_000 }); await expect(page.locator('tbody tr').first()).toBeVisible();
});

test('UI-051: an ineligible candidate is told which examination, why, and whom to contact — on the dashboard and the schedule', async ({ page }) => {
  await login(page, 'student.a001'); const note = page.getByTestId('not-eligible');
  await expect(note).toContainText('You are not eligible for Pathology Mid-term'); await expect(note).toContainText(/Attendance is .*% — the minimum is 75%/); await expect(note).toContainText('Contact your campus administrator');
  await page.goto('/schedule'); await expect(page.getByTestId('not-eligible')).toContainText('You are not eligible for Pathology Mid-term');
});

test('UI-038: the audit trail uses plain wording, role names, and keeps hashes in a details toggle', async ({ page }) => {
  await login(page, 'super.admin'); await page.goto('/audit'); await expect(page.locator('tbody tr').first()).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'What happened' })).toBeVisible(); await expect(page.locator('tbody').getByText('Signed in').first()).toBeVisible();
  await expect(page.locator('tbody').getByText(/^campus_admin$/)).toHaveCount(0);
  const det = page.locator('details.audit-det').first(); await expect(det.locator('div')).toBeHidden(); await det.locator('summary').click(); await expect(det.locator('div')).toContainText('Record hash');
});

test('UI-036/041/052: on a phone the exam header is slim and the Next/Mark bar stays on screen', async ({ browser }) => {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 } }); const p = await c.newPage(); await login(p, 'student.a008'); await p.goto('/schedule');
  await p.getByRole('link', { name: /Start|Resume/ }).first().click(); await p.getByRole('button', { name: /begin|resume/i }).click(); await p.getByRole('timer').waitFor();
  const h = (await p.locator('.exam-bar').boundingBox())!.height; expect(h, `header ${h}px`).toBeLessThanOrEqual(66);
  expect(await p.locator('.exam .q-foot').first().evaluate((e) => getComputedStyle(e).position)).toBe('sticky');
  expect(await p.locator('h1').count()).toBe(1); expect(await p.locator('main').count()).toBe(1);
  await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); const foot = (await p.locator('.exam .q-foot').first().boundingBox())!; expect(foot.y + foot.height).toBeLessThanOrEqual(844 + 1);
  await c.close();
});

test('public artwork (white logo) is served as images, never rewritten to the portal 404', async ({ request }) => {
  for (const [path, type] of [['/logo.png', 'image/png'], ['/logo-white.png', 'image/png']] as const) {
    const res = await request.get(path); expect(res.status(), path).toBe(200); expect(res.headers()['content-type'], path).toContain(type);
  }
});

test('the staff portal sign-in page never mentions the exam schedule; the student portal still does', async ({ page, browser }) => {
  await page.goto('/login'); await expect(page.getByText('Check your exam schedule and guidelines')).toBeVisible(); await expect(page.getByText('Take Exams')).toBeVisible();
  const staff = await browser.newPage(); await staff.goto('http://localhost:3002/login');
  await expect(staff.getByRole('heading', { name: 'Sign in' })).toBeVisible(); await expect(staff.getByText('Accounts lock for 15 minutes')).toBeVisible();
  await expect(staff.getByText('New student?')).toHaveCount(0); await expect(staff.getByText(/exam schedule/i)).toHaveCount(0); await expect(staff.getByText('Schedule', { exact: false })).toHaveCount(0);
  await staff.close();
});

test('A-01: times inside notifications use the app format (zone and layout), never a raw ISO/UTC string', async ({ page }) => {
  await login(page, 'student.a002'); const feed = page.getByTestId('recent-activity'); await expect(feed).toBeVisible();
  await expect(feed).not.toContainText(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/); await expect(feed).toContainText(/Opens \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}/);
});

test('A-02: on a phone the dashboard tiles are a compact strip and the student\'s examinations are on the first screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await login(page, 'student.a002');
  await expect(page.getByRole('heading', { name: 'Your examinations' })).toBeInViewport();
  const tiles = page.locator('.dash-tiles .stat'); await expect(tiles).toHaveCount(4); const a = await tiles.nth(0).boundingBox(); const b = await tiles.nth(1).boundingBox();
  expect(Math.abs(a!.y - b!.y), 'two tiles per row').toBeLessThan(2);
});
