import { expect, test, type Page } from '@playwright/test';
import { login } from './helpers';

/** Student self-registration end to end: admin loads the register, the student registers with an emailed code, signs in, sees no exams/enrolments. */
const letters = (n: number) => Array.from({ length: n }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join('');
const PW = 'Sturdy-Pass-2026!x';

async function fill(p: Page, v: { regNo: string; dob: string; email: string; pw: string; pw2?: string }) {
  await p.getByLabel(/Registration number/).fill(v.regNo); await p.getByLabel(/Date of birth/).fill(v.dob); await p.getByLabel(/Email address/).fill(v.email);
  await p.getByLabel('Password *', { exact: true }).fill(v.pw); await p.getByLabel(/Confirm password/).fill(v.pw2 ?? v.pw);
}

test.describe.serial('student registration', () => {
  const reg = `REG-${letters(6)}`; const email = `${letters(8).toLowerCase()}@example.test`;

  test('campus admin imports the register from the UI, with line-level errors before anything is sent', async ({ page }) => {
    await login(page, 'admin.a'); await page.goto('/roster');
    await expect(page.getByRole('heading', { name: 'Student register', exact: true })).toBeVisible(); await expect.poll(() => page.title()).toMatch(/Student register/);
    await page.getByRole('button', { name: 'Import register (CSV)' }).click();
    const dlg = page.getByRole('dialog'); const box = dlg.getByLabel(/Register \(one student per line\)/);
    await box.fill(`${reg},Zainab Test,09/03/2004,MBBS,2,2025`); await expect(dlg).toContainText('1 to fix'); await expect(dlg).toContainText('date of birth must look like'); await expect(dlg.getByRole('button', { name: /^Import/ })).toBeDisabled();
    await box.fill(`regNo,fullName,dateOfBirth,programCode,semester,batchYear\n${reg},Zainab Test,2004-03-09,MBBS,2,2025`); await expect(dlg).toContainText('ready to import');
    await dlg.getByRole('button', { name: /^Import 1 entry/ }).click(); await expect(page.getByRole('status').filter({ hasText: '1 student added' })).toBeVisible();
    await page.getByLabel('Search').fill(reg); await expect(page.locator('tbody tr', { hasText: reg })).toContainText('Not registered yet'); await expect(page.locator('body')).not.toContainText('2004-03-09');
  });

  test('registration page validates inline, then the emailed code creates the account', async ({ page }) => {
    await page.goto('/login'); await page.getByRole('link', { name: 'Create your account' }).click(); await expect(page).toHaveURL(/\/register/);
    await expect(page.getByRole('heading', { name: 'Student registration' })).toBeVisible(); await expect.poll(() => page.title()).toMatch(/Student registration/);
    await page.getByRole('button', { name: /Continue/ }).click();                                                    // nothing filled: every field explains itself
    for (const m of [/Enter your registration number\./, /Enter your date of birth/, /Enter a valid email address\./]) await expect(page.getByText(m)).toBeVisible();
    await fill(page, { regNo: reg, dob: '2004-03-09', email, pw: PW, pw2: PW + 'x' }); await expect(page.getByText('Passwords do not match.')).toBeVisible();
    await page.getByLabel(/Confirm password/).fill(PW); await expect(page.getByText('Passwords do not match.')).toHaveCount(0);
    await page.getByRole('button', { name: /Continue/ }).click();
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible(); await expect(page.getByTestId('register-info')).toContainText('If your details match');
    const code = (await page.getByTestId('dev-code').innerText()).replace(/\D/g, '').slice(-6);
    await page.getByLabel('Digit 1').click(); await page.keyboard.type('000000' === code ? '111111' : '000000'); await page.getByRole('button', { name: /Create my account/ }).click();
    await expect(page.getByRole('alert').filter({ hasText: /incorrect or has expired/ })).toBeVisible();
    await page.getByLabel('Digit 1').click(); await page.keyboard.type(code); await page.getByRole('button', { name: /Create my account/ }).click();
    await expect(page.getByRole('heading', { name: 'Account created' })).toBeVisible();
  });

  test('the new student can sign in, is a candidate of the right campus, and has no exams or enrolments', async ({ page }) => {
    await page.goto('/login'); await page.getByLabel('University email').fill(email); await page.getByLabel('Password').fill(PW); await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/dashboard/); await page.goto('/schedule'); await expect(page.getByRole('heading', { name: 'Exam schedule' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Start|Resume/ })).toHaveCount(0);
    await page.goto('/profile'); await expect(page.getByLabel('Registration no.')).toHaveValue(reg); await expect(page.getByLabel('Institution', { exact: true }).first()).toHaveValue(/Medical College A/i);
  });

  test('wrong date of birth, an unknown number and a claimed number all look the same to the visitor', async ({ page }) => {
    const seen: string[] = [];
    for (const v of [{ regNo: reg, dob: '2004-03-09' }, { regNo: reg, dob: '2001-01-01' }, { regNo: 'NOPE-' + letters(5), dob: '2004-03-09' }]) {
      await page.goto('/register'); await fill(page, { ...v, email: `${letters(8).toLowerCase()}@example.test`, pw: PW }); await page.getByRole('button', { name: /Continue/ }).click();
      await expect(page.getByTestId('register-info')).toBeVisible(); seen.push(await page.getByTestId('register-info').innerText()); await expect(page.getByTestId('dev-code')).toHaveCount(0);
    }
    expect(new Set(seen).size).toBe(1);
  });

  test('phone width: no sideways scroll on the registration page', async ({ browser }) => {
    const c = await browser.newContext({ viewport: { width: 360, height: 740 } }); const p = await c.newPage(); await p.goto('/register');
    await expect(p.getByRole('heading', { name: 'Student registration' })).toBeVisible();
    expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); await c.close();
  });
});

test('staff roles that cannot manage students do not see the register', async ({ page }) => {
  await login(page, 'lecturer.a'); await page.goto('/roster'); await expect(page.getByRole('heading', { name: 'You do not have access to Student register' })).toBeVisible();
});

test('UI-039: login, forgot, register and verify pages do not scroll sideways at 360 and 390 px', async ({ browser }) => {
  for (const w of [360, 390]) {
    const c = await browser.newContext({ viewport: { width: w, height: 740 } }); const p = await c.newPage();
    for (const url of ['/login', '/forgot', '/register']) { await p.goto(url); await p.locator('h1').first().waitFor(); expect(await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `${url} @${w}`).toBeLessThanOrEqual(0); }
    await c.close();
  }
});
