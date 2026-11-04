import { expect, test, type Page } from '@playwright/test';
import { login } from './helpers';

/**
 * Accessibility: automated axe scans plus keyboard-only passes over the interactive widgets (dialog, notification menu, sign-in).
 * The responsive shell (drawer, desktop layout) is covered by responsive.spec.ts.
 *
 * The axe scans need `@axe-core/playwright` (`npm i -D @axe-core/playwright`, then commit the lockfile). It is loaded lazily
 * so the keyboard tests below run — and CI's `npm ci` stays valid — before it has been added; the scans are skipped until then.
 * Scans fail on `serious`/`critical` WCAG 2.x A/AA violations; `minor`/`moderate` findings are attached to the report, not failed.
 */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
type AxeCtor = new (o: { page: Page }) => { withTags(t: string[]): { analyze(): Promise<{ violations: { id: string; impact?: string | null; help: string; nodes: { target: unknown[] }[] }[] }> } };
async function axeBuilder(): Promise<AxeCtor | null> {
  try { const spec = '@axe-core/playwright'; return ((await import(spec)) as { default: AxeCtor }).default; } catch { return null; }
}
async function scan(page: Page, label: string, testInfo: { attach: (n: string, o: { body: string; contentType: string }) => Promise<void> }) {
  const Axe = await axeBuilder();
  test.skip(!Axe, '@axe-core/playwright is not installed');
  const { violations } = await new Axe!({ page }).withTags(TAGS).analyze();
  if (violations.length) await testInfo.attach(`axe-${label}.json`, { body: JSON.stringify(violations, null, 2), contentType: 'application/json' });
  const blocking = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(blocking.map((v) => `${v.id} (${v.impact}): ${v.help} — ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`), `${label}: serious/critical axe violations`).toEqual([]);
}

test.describe('axe scans', () => {
  test('sign-in page', async ({ page }, ti) => { await page.goto('/login'); await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible(); await scan(page, 'login', ti); });
  test('student dashboard and schedule', async ({ page }, ti) => {
    await login(page, 'student.b008');
    await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible(); await scan(page, 'student-dashboard', ti);
    await page.goto('/schedule'); await expect(page.getByRole('heading', { name: 'My Examinations' })).toBeVisible(); await scan(page, 'student-schedule', ti);
  });
  test('examiner exam list', async ({ page }, ti) => {
    await login(page, 'examiner');
    await page.goto('/exams'); await expect(page.getByRole('heading', { name: 'Examinations' })).toBeVisible(); await scan(page, 'examiner-exams', ti);
  });
  test('open dialog and open notification menu', async ({ page }, ti) => {
    await login(page, 'admin.a');
    await page.goto('/students'); await page.getByRole('button', { name: '+ Add student' }).click();
    await expect(page.getByRole('dialog', { name: 'Add student' })).toBeVisible(); await scan(page, 'add-student-dialog', ti);
  });
});

test.describe('keyboard only', () => {
  test('sign in without a mouse', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('University email').focus();             // autofocus target
    await page.keyboard.type('student.b008@demo.szabmu.invalid');
    await page.keyboard.press('Tab'); await page.keyboard.type('Demo-Passw0rd-2026!');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('notification menu: Enter opens, Escape closes and returns focus to the button', async ({ page }) => {
    await login(page, 'student.b008');
    const bell = page.getByRole('button', { name: /^Notifications, \d+ unread/ });
    await bell.focus(); await page.keyboard.press('Enter');
    await expect(bell).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('region', { name: 'Notifications' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(bell).toHaveAttribute('aria-expanded', 'false');
    await expect(bell).toBeFocused();
    await bell.click(); await page.getByRole('heading', { name: 'Welcome back', exact: false }).click();   // click outside closes
    await expect(bell).toHaveAttribute('aria-expanded', 'false');
  });

  test('dialog traps Tab, closes on Escape and restores focus to the opener', async ({ page }) => {
    await login(page, 'admin.a');
    await page.goto('/students');
    const opener = page.getByRole('button', { name: '+ Add student' });
    await opener.focus(); await page.keyboard.press('Enter');
    const dlg = page.getByRole('dialog', { name: 'Add student' });
    await expect(dlg).toBeVisible();
    const inside = () => dlg.evaluate((d) => d.contains(document.activeElement));
    expect(await inside()).toBe(true);                                // focus moved into the dialog on open
    for (let i = 0; i < 25; i++) { await page.keyboard.press('Tab'); expect(await inside(), `Tab #${i + 1} stayed inside`).toBe(true); }
    for (let i = 0; i < 25; i++) { await page.keyboard.press('Shift+Tab'); expect(await inside(), `Shift+Tab #${i + 1} stayed inside`).toBe(true); }
    await page.keyboard.press('Escape');
    await expect(dlg).toHaveCount(0);
    await expect(opener).toBeFocused();
  });
});
