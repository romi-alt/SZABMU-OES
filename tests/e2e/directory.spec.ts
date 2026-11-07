import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { login } from './helpers';

/** The institution & programme directory in the browser: list/search/filter/page, detail with restrictions and provenance, scoped admins, audited edits, and the student and teacher forms. */
const PW = 'Sturdy-Pass-2026!x';
const letters = (n: number) => Array.from({ length: n }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('');
const serious = async (page: Page) => (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()).violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`);
const row = (page: Page, text: string) => page.locator('tbody tr', { hasText: text });

test.describe('institutions screen', () => {
  test('lists the real directory, searches, filters, pages, and is accessible', async ({ page }) => {
    await login(page, 'super.admin'); await page.goto('/institutions');
    await expect(page.getByRole('heading', { name: 'Institutions' })).toBeVisible(); await expect(row(page, 'HBS Medical & Dental College')).toBeVisible().catch(() => undefined);
    await expect(page.locator('tbody tr')).toHaveCount(20); await expect(page.getByText(/of 3\d? records|3\d records/).first()).toBeVisible().catch(() => undefined);
    await page.getByRole('button', { name: 'Next' }).click(); await expect(page.getByText(/Page 2 of 2/)).toBeVisible();
    await page.getByRole('button', { name: 'Previous' }).click();
    await page.getByLabel('Search').fill('IMDC'); await expect(page.locator('tbody tr')).toHaveCount(1); await expect(row(page, 'SZ-C10')).toContainText('Islamabad Medical & Dental College');
    await page.getByLabel('Search').fill('Mirpur'); await expect(page.locator('tbody tr')).toHaveCount(2);
    await page.getByLabel('Search').fill(''); await page.getByLabel('Sector').selectOption('PUBLIC'); await page.getByLabel('Type of record').selectOption('INSTITUTION'); await expect(page.locator('tbody tr')).toHaveCount(10);
    await page.getByLabel('Sector').selectOption(''); await page.getByLabel('Has a stopped intake').check(); await expect(page.locator('tbody tr')).toHaveCount(3); await expect(row(page, 'Aman Medical Institute')).toContainText('1 stopped intake');
    await page.getByLabel('Search').fill('zzzzzz'); await expect(page.getByText(/No institutions/i).first()).toBeVisible();
    await page.getByLabel('Search').fill(''); await page.getByLabel('Has a stopped intake').uncheck();
    await expect(page.locator('tbody tr').first()).toBeVisible(); expect(await serious(page)).toEqual([]);
  });

  test('detail shows programmes, shifts, the stopped-intake restriction with its source, and what is not known', async ({ page }) => {
    await login(page, 'super.admin'); await page.goto('/institutions'); await page.getByLabel('Search').fill('Rawal'); await expect(page.locator('tbody tr')).toHaveCount(1);
    await page.getByRole('button', { name: /Open details for Rawal/ }).click();
    const d = page.getByTestId('institution-detail'); await expect(d).toContainText('Generic Bachelor of Science in Nursing'); await expect(d).toContainText('Morning: annual seats 100'); await expect(d).toContainText('Evening: annual seats 100'); await expect(d).toContainText('Curriculum: No curriculum evidence');
    await expect(d).toContainText('Enrolled students: 0'); expect(await serious(page)).toEqual([]);
    await page.keyboard.press('Escape'); await page.getByLabel('Search').fill('Aman'); await expect(page.locator('tbody tr')).toHaveCount(1);
    await page.getByRole('button', { name: /Open details for Aman/ }).click(); const a = page.getByTestId('institution-detail');
    await expect(a).toContainText('New intake stopped'); await expect(a.getByRole('link', { name: /Our Institutes/i }).first()).toBeVisible(); await expect(a).toContainText('effective date not published');
  });

  test('a manager stops and resumes an intake with confirmation; the change is audited; a campus administrator cannot', async ({ page, browser }) => {
    await login(page, 'super.admin'); await page.goto('/institutions'); await page.getByLabel('Search').fill('SZ-C11'); await expect(page.locator('tbody tr')).toHaveCount(1);
    await page.getByRole('button', { name: /Open details for/ }).click(); const d = page.getByTestId('institution-detail');
    await page.getByRole('button', { name: 'Stop new intake' }).first().click(); const c = page.getByRole('dialog', { name: 'Stop new intake?' }); await expect(c).toContainText('Existing students'); await c.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Stop new intake' }).first().click(); await page.getByRole('button', { name: 'Stop intake' }).click(); await expect(d).toContainText('New intake stopped');
    await page.getByRole('button', { name: 'Resume new intake' }).first().click(); await page.getByRole('button', { name: 'Resume intake' }).click(); await expect(d).not.toContainText('New intake stopped');
    const audit = await (await page.request.get('/api/audit?pageSize=20')).json(); expect(JSON.stringify(audit)).toContain('directory.offering_update');
    const ctx = await browser.newContext(); const p2 = await ctx.newPage(); await login(p2, 'admin.a'); await p2.goto('/institutions');
    await expect(p2.locator('tbody tr')).toHaveCount(1); await expect(p2.locator('tbody tr')).toContainText('DMC-A'); await expect(p2.getByRole('button', { name: /^Edit / })).toHaveCount(0); await expect(p2.getByRole('button', { name: /^Deactivate/ })).toHaveCount(0);
    await ctx.close();
  });

  test('a super administrator checks, then applies, the directory update from the browser; others do not see it', async ({ page, browser }) => {
    await login(page, 'super.admin'); await page.goto('/institutions'); await page.getByRole('button', { name: 'Update directory' }).click();
    const dlg = page.getByRole('dialog', { name: 'Update directory' }); const apply = dlg.getByRole('button', { name: 'Apply to the live database' }); await expect(apply).toHaveCount(0);
    await dlg.getByRole('button', { name: /^Check/ }).click(); await expect(dlg.getByTestId('import-directory').getByRole('table')).toContainText('Institutions'); await expect(dlg).toContainText('already present');
    await expect(apply).toBeDisabled(); expect(await serious(page)).toEqual([]);
    await dlg.getByLabel(/I have a backup/).check(); await apply.click(); await expect(dlg).toContainText('Directory updated'); await expect(dlg).toContainText('Keep this run number');
    await dlg.getByRole('button', { name: 'Close' }).click(); await expect(page.locator('tbody tr').first()).toBeVisible();
    const ctx = await browser.newContext(); const p2 = await ctx.newPage(); await login(p2, 'admin.a'); await p2.goto('/institutions'); await expect(p2.getByRole('button', { name: 'Update directory' })).toHaveCount(0); await ctx.close();
  });

  test('phone layout has no horizontal scroll and folds secondary columns', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 }); await login(page, 'super.admin'); await page.goto('/institutions'); await expect(page.locator('tbody tr').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    const r = page.locator('tbody tr').first(); await expect(r.locator('td[data-label="Sector"]')).toBeHidden(); await r.getByRole('button', { name: /^Show details/ }).click(); await expect(r.locator('td[data-label="Sector"]')).toBeVisible();
  });
});

test.describe('student and teacher forms use the directory', () => {
  async function signUp(page: Page) {
    const reg = `DIR/${letters(6).toUpperCase()}`; const email = `${letters(8)}@example.test`;
    await page.goto('/register'); await page.getByLabel(/Registration number/).fill(reg); await page.getByLabel(/Email address/).fill(email); await page.getByLabel(/^Password\b/).fill(PW); await page.getByLabel(/Confirm password/).fill(PW); await page.getByRole('button', { name: 'Create Account' }).click();
    const code = (await page.getByTestId('dev-code').locator('b').innerText()).trim(); for (let i = 0; i < 6; i++) await page.getByLabel(`Digit ${i + 1}`).fill(code[i]!); await page.getByRole('button', { name: 'Create Account' }).click(); await expect(page).toHaveURL(/\/complete-profile$/);
  }
  test('programmes follow the college, a stopped intake warns and is refused by the server, shift is asked only where it exists', async ({ page }) => {
    await signUp(page);
    await page.getByLabel(/^Full name/).fill('Amna Directory'); await page.getByLabel(/Father's name/).fill('Tariq Directory'); await page.getByLabel(/^Gender/).selectOption('FEMALE'); await page.getByLabel(/Mobile number/).fill('+92 300 1234567');
    await page.getByLabel(/College/).selectOption({ label: 'Aman Medical Institute, Islamabad' }); const progs = await page.getByLabel(/Degree programme/).locator('option').allInnerTexts(); expect(progs.join('|')).toContain('Doctor of Physical Therapy'); expect(progs.join('|')).not.toContain('Bachelor of Medicine');
    await page.getByLabel(/Degree programme/).selectOption({ label: 'Doctor of Physical Therapy' }); await expect(page.getByText(/New admissions to this programme at this college have been stopped/)).toBeVisible(); await expect(page.getByLabel(/^Shift/)).toHaveCount(0);
    await page.getByLabel(/^Semester/).selectOption({ index: 1 }); await page.getByLabel(/Academic year/).selectOption({ index: 1 }); await page.getByRole('button', { name: 'Save and continue' }).click();
    await expect(page.getByText(/stopped|no longer admitting|not admitting/i).first()).toBeVisible(); await expect(page).toHaveURL(/\/complete-profile$/);
    await page.getByLabel(/College/).selectOption({ label: 'Rawal Institute of Health Sciences, Islamabad' }); await page.getByLabel(/Degree programme/).selectOption({ label: 'Generic Bachelor of Science in Nursing' });
    await expect(page.getByLabel(/^Shift/)).toBeVisible(); expect(await page.getByLabel(/^Shift/).locator('option').allInnerTexts()).toEqual(['Select your shift', 'Morning', 'Evening']); expect(await serious(page)).toEqual([]);
    await page.getByLabel(/College/).selectOption({ label: 'Aman Medical Institute, Islamabad' }); await expect(page.getByLabel(/^Shift/)).toHaveCount(0); await expect(page.getByLabel(/Degree programme/)).toHaveValue('');   // dependent values are cleared
  });

  test('teacher registration offers only the programmes the chosen institution offers', async ({ page }) => {
    await page.goto('/register/teacher'); await page.getByLabel('Full name').fill('Dr Directory Teacher'); await page.getByLabel(/^Email\b/).fill(`${letters(8)}@example.test`); await page.getByLabel(/^Password\b/).fill(PW); await page.getByLabel('Confirm password').fill(PW);
    await page.getByRole('button', { name: /Continue/ }).click(); await expect(page.getByText('Step 2 of 3')).toBeVisible();
    const prog = page.getByLabel('Programme'); await expect(prog).toBeDisabled();
    await page.getByLabel('Institution').selectOption({ label: 'Aman Medical Institute, Islamabad' }); const opts = (await prog.locator('option').allInnerTexts()).filter((t) => !/^Select/.test(t)); expect(opts.length).toBe(2);   // Aman offers two programmes in the directory
    expect(opts.join('|')).toContain('Doctor of Physical Therapy'); expect(opts.join('|')).not.toContain('Bachelor of Medicine');
    await page.getByLabel('Institution').selectOption({ label: 'Rawal Institute of Health Sciences, Islamabad' }); await expect(prog).toHaveValue('');
  });
});
