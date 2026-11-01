import { expect, test, type Page } from '@playwright/test';
import { login } from './helpers';

/**
 * UI-001: /enrolment crashed for every role (useGet(null) → Async → Table null.length). These tests drive the real page against the real API.
 * Candidate DMC-A-2024-0008 is used for attendance edits and restored afterwards; no other spec changes that attendance.
 */
const REG = 'DMC-A-2024-0008';
const open = async (page: Page, course = /MBBS-PATH-4/) => {
  await page.goto('/enrolment'); await expect(page.getByRole('heading', { name: 'Enrolment & eligibility' })).toBeVisible();
  await expect(page.getByText('This page hit a problem')).toHaveCount(0);
  if (course) await page.getByLabel('Course').selectOption({ label: (await page.getByLabel('Course').locator('option', { hasText: course }).first().innerText()) });
};
const row = (page: Page, reg = REG) => page.locator('tbody tr', { hasText: reg });

test.describe('Enrolment & eligibility', () => {
  test('Campus Admin: loads without crashing; empty cohort shows an empty state; populated cohort shows candidates and eligibility', async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
    await login(page, 'admin.a');
    await page.goto('/enrolment'); await expect(page.getByRole('heading', { name: 'Enrolment & eligibility' })).toBeVisible();
    await expect(page.getByText('This page hit a problem')).toHaveCount(0);
    await page.getByLabel('Course').selectOption({ label: 'BSN-FUND-1 — Fundamentals of Nursing' });             // a course with no cohort at this campus
    await expect(page.getByText(/No enrolments for this course and term/)).toBeVisible();
    await page.getByLabel('Course').selectOption({ label: 'MBBS-PATH-4 — Pathology' });
    await expect(row(page)).toBeVisible(); await expect(row(page).getByText(/Eligible|Ineligible|Condoned/i).first()).toBeVisible();
    expect(await page.locator('tbody tr').count()).toBeGreaterThan(5);
    expect(errors, 'no uncaught page errors').toEqual([]);
  });

  test('Campus Admin: attendance can be recorded through the real API and changes eligibility; survives refresh; restored afterwards', async ({ page }) => {
    await login(page, 'admin.a'); await open(page);
    const input = page.getByLabel(`Attendance for ${REG}`); const original = await input.inputValue();
    try {
      await input.fill('60'); await row(page).getByRole('button', { name: 'Save' }).click();
      await expect(page.locator('.toast', { hasText: 'Recorded' })).toBeVisible();
      await expect(row(page).getByText('Ineligible')).toBeVisible();
      await page.reload(); await open(page); await expect(page.getByLabel(`Attendance for ${REG}`)).toHaveValue('60'); await expect(row(page).getByText('Ineligible')).toBeVisible();
    } finally {
      await page.getByLabel(`Attendance for ${REG}`).fill(original || '90'); await row(page).getByRole('button', { name: 'Save' }).click();
      await expect(page.locator('.toast', { hasText: 'Recorded' }).last()).toBeVisible();
    }
    await expect(row(page).getByText('Ineligible')).toHaveCount(0);
  });

  test('Controller and Super Admin (university-wide, with an institution selector) can open the page and load a campus cohort', async ({ browser }) => {
    for (const who of ['cce', 'super.admin']) {
      const ctx = await browser.newContext(); const p = await ctx.newPage(); await login(p, who); await open(p);
      await p.getByLabel('Institution').selectOption({ label: 'DMC-A' }); await expect(row(p)).toBeVisible(); await ctx.close();
    }
  });

  test('a role without access gets a permission message, not a crash', async ({ page }) => {
    await login(page, 'student.a007'); await page.goto('/enrolment');
    await expect(page.getByTestId('error-forbidden')).toBeVisible(); await expect(page.getByText('This page hit a problem')).toHaveCount(0);
  });

  test('API failure shows an actionable error and recovers after "Try again"', async ({ page }) => {
    await login(page, 'admin.a'); await open(page);
    await page.route('**/api/enrollments?*', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 'INTERNAL', message: 'x' }) }));
    await page.getByLabel('Term').fill('2026-SPRING '); await page.getByLabel('Term').fill('2026-SPRING');          // force a new request
    await expect(page.getByTestId('error-server')).toBeVisible();
    await page.unroute('**/api/enrollments?*'); await page.getByRole('button', { name: 'Try again' }).click();
    await expect(row(page)).toBeVisible();
  });

  test('a malformed API response is handled safely (visible notice, no crash)', async ({ page }) => {
    await login(page, 'admin.a'); await page.route('**/api/enrollments?*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"unexpected":true}' }));
    await open(page, /MBBS-PATH-4/); await expect(page.getByText(/unexpected format/)).toBeVisible(); await expect(page.getByText('This page hit a problem')).toHaveCount(0);
  });

  test('no courses at all shows an explanation instead of an empty select and a crash', async ({ page }) => {
    await login(page, 'admin.a'); await page.route('**/api/programs', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await page.goto('/enrolment'); await expect(page.getByText(/No courses are available for enrolment yet/)).toBeVisible(); await expect(page.getByText('This page hit a problem')).toHaveCount(0);
  });

  test('phone layout: no sideways scroll, rows become labelled cards', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); const p = await ctx.newPage(); await login(p, 'admin.a'); await open(p);
    await expect(row(p)).toBeVisible();
    expect(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(await row(p).locator('td').first().getAttribute('data-label')).toBe('Reg. no.');
    await ctx.close();
  });
});
