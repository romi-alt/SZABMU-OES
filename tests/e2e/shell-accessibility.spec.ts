import { expect, test } from '@playwright/test';
import { login } from './helpers';

/** Shared shell: page titles, skip link, form-control contrast, phone validation (batch D, shared-root-cause items). */
test.describe('app shell accessibility', () => {
  test('each page sets a distinct document title', async ({ page }) => {
    await login(page, 'admin.a');
    const seen = new Set<string>();
    for (const [url, h] of [['/dashboard', /Dashboard|Welcome/i], ['/enrolment', /Enrolment/i], ['/profile', /profile/i]] as const) {
      await page.goto(url); await expect(page.locator('h1').first()).toHaveText(h);
      await expect.poll(() => page.title()).toMatch(/· SZABMU OES$/); seen.add(await page.title());
    }
    expect(seen.size).toBe(3);
  });

  test('skip link is the first tab stop, appears on focus, and moves focus to main', async ({ page }) => {
    await login(page, 'admin.a'); await page.goto('/profile'); await page.locator('h1').first().waitFor();
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to main content' });
    await expect(skip).toBeFocused(); expect((await skip.boundingBox())!.y).toBeGreaterThanOrEqual(0);
    await page.keyboard.press('Enter');
    await expect(page.locator('main#main')).toBeFocused();
  });

  test('text input borders and muted text meet WCAG contrast (3:1 / 4.5:1)', async ({ page }) => {
    await login(page, 'admin.a'); await page.goto('/profile');
    const c = await page.evaluate(() => {
      const lum = (rgb: string) => { const v = rgb.match(/\d+/g)!.slice(0, 3).map((n) => { const x = +n / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * v[0]! + 0.7152 * v[1]! + 0.0722 * v[2]!; };
      const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05); };
      const input = document.querySelector('input.in:not([readonly])')!; const cs = getComputedStyle(input);
      const faint = document.createElement('span'); faint.className = 'faint'; document.body.appendChild(faint);
      return { border: ratio(cs.borderTopColor, 'rgb(255,255,255)'), faint: ratio(getComputedStyle(faint).color, 'rgb(255,255,255)') };
    });
    expect(c.border).toBeGreaterThanOrEqual(3); expect(c.faint).toBeGreaterThanOrEqual(4.5);
  });

  test('profile phone: "abc" shows an inline error, blocks save, and valid input saves', async ({ page }) => {
    await login(page, 'admin.a'); await page.goto('/profile');
    const phone = page.getByLabel('Phone'); const save = page.getByRole('button', { name: 'Save changes' });
    await phone.fill('abc'); await expect(page.getByRole('alert').filter({ hasText: /digits only/i })).toBeVisible(); await expect(save).toBeDisabled();
    await phone.fill('+92 300 1234567'); await expect(save).toBeEnabled(); await save.click(); await expect(page.getByText('Profile saved')).toBeVisible();
    await phone.fill(''); await save.click(); await expect(page.getByText('Profile saved').first()).toBeVisible();
  });
});
