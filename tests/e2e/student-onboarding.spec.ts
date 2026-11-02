import { expect, test, type Page } from '@playwright/test';
import { login } from './helpers';

/**
 * Student onboarding end to end: sign up with registration number + email + password, emailed code, straight to the one-time profile,
 * save, straight to My Examinations; returning and incomplete students; no eligibility from a completed profile.
 */
const letters = (n: number) => Array.from({ length: n }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('');
const PW = 'Sturdy-Pass-2026!x';

async function signUp(page: Page, regNo: string, email: string) {
  await page.goto('/register'); await page.getByLabel(/Registration number/).fill(regNo); await page.getByLabel(/Email address/).fill(email);
  await page.getByLabel(/^Password\b/).fill(PW); await page.getByLabel(/Confirm password/).fill(PW); await page.getByRole('button', { name: 'Create Account' }).click();
  const code = (await page.getByTestId('dev-code').locator('b').innerText()).trim(); for (let i = 0; i < 6; i++) await page.getByLabel(`Digit ${i + 1}`).fill(code[i]!);
  await page.getByRole('button', { name: 'Create Account' }).click();
}
async function completeProfile(page: Page) {
  await page.getByLabel(/^Full name/).fill('Amna Onboarding'); await page.getByLabel(/Father's name/).fill('Tariq Onboarding'); await page.getByLabel(/^Gender/).selectOption('FEMALE'); await page.getByLabel(/Mobile number/).fill('+92 300 1234567');
  await page.getByLabel(/College/).selectOption({ label: 'Demo Medical College A (synthetic)' }); await page.getByLabel(/Degree programme/).selectOption({ index: 1 }); await page.getByLabel(/^Semester/).selectOption('4'); await page.getByLabel(/Academic year/).selectOption('2024');
}
async function signInAgain(page: Page, email: string) { await page.context().clearCookies(); await page.goto('/login'); await page.getByLabel('University email').fill(email); await page.getByLabel('Password').fill(PW); await page.getByRole('button', { name: /sign in/i }).click(); await page.waitForURL(/\/(complete-profile|dashboard|schedule)/); }
async function liveExamId(page: Page) {
  const staff = await page.context().browser()!.newPage(); await login(staff, 'cce'); const list = await (await staff.request.get('/api/exams?pageSize=50')).json(); await staff.close();
  return (list.items ?? list).find((e: any) => e.code === 'MBBS-PATH-MT').id as string;
}

test.describe.serial('student onboarding', () => {
  const reg = `ONB/${letters(6).toUpperCase()}`; const email = `${letters(8)}@example.test`;

  test('simplified sign-up (no date of birth), validation, then the code lands on Complete your profile', async ({ page }) => {
    await page.goto('/register'); await expect(page.getByLabel(/Date of birth/)).toHaveCount(0);
    await page.getByRole('button', { name: 'Create Account' }).click(); await expect(page.getByText(/Enter your registration number/)).toBeVisible(); await expect(page.getByText('Enter a valid email address.')).toBeVisible();
    await signUp(page, reg, email);
    await expect(page).toHaveURL(/\/complete-profile$/); await expect(page.getByRole('heading', { name: 'Complete your profile' })).toBeVisible(); await expect(page.getByLabel('Registration number')).toHaveValue(reg);
  });

  test('an incomplete profile resumes onboarding; the form validates, keeps what was typed, and uses dependent dropdowns', async ({ page }) => {
    await signInAgain(page, email);
    await expect(page).toHaveURL(/\/complete-profile$/);
    await page.goto('/schedule'); await expect(page).toHaveURL(/\/complete-profile$/);                                          // cannot reach the examination interface first
    await page.getByRole('button', { name: 'Save and continue' }).click(); await expect(page.getByText('Enter your full name.')).toBeVisible(); await expect(page.getByText('Select your college.')).toBeVisible();
    await expect(page.getByLabel(/Degree programme/)).toBeDisabled(); await expect(page.getByLabel(/^Semester/)).toBeDisabled();
    await page.getByLabel(/College/).selectOption({ label: 'Demo Medical College A (synthetic)' });
    const cat = await (await page.request.get('/api/onboarding/catalog')).json(); const inst = cat.institutions.find((i: any) => i.code === 'DMC-A').id;
    const offered = cat.programs.filter((p: any) => !cat.programsByInstitution[inst]?.length || cat.programsByInstitution[inst].includes(p.id)).map((p: any) => p.name).sort();
    const progs = (await page.getByLabel(/Degree programme/).locator('option').allInnerTexts()).filter((t) => !/^Select/.test(t)).sort(); expect(progs).toEqual(offered); expect(progs.join('|')).toContain('Bachelor of Medicine');   // exactly what the database offers at that college
    await page.getByLabel(/Degree programme/).selectOption({ index: 1 }); const sems = await page.getByLabel(/^Semester/).locator('option').allInnerTexts(); expect(sems.join('|')).toContain('Semester 4');
    await page.getByLabel(/^Full name/).fill('Amna Onboarding'); await page.getByLabel(/Mobile number/).fill('abc'); await page.getByRole('button', { name: 'Save and continue' }).click(); await expect(page.getByText(/Use digits only/)).toBeVisible();
    await expect(page.getByLabel(/^Full name/)).toHaveValue('Amna Onboarding');                                                 // nothing lost
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
    await completeProfile(page); await page.getByRole('button', { name: 'Save and continue' }).click();
    await expect(page).toHaveURL(/\/schedule$/); await expect(page.getByRole('heading', { name: 'My Examinations' })).toBeVisible();
    await expect(page.getByTestId('no-exams')).toContainText('No examinations are currently assigned to your account.');
  });

  test('a returning student skips onboarding; the form is never shown again; academic identity is read-only', async ({ page }) => {
    await signInAgain(page, email); await expect(page).toHaveURL(/\/dashboard/); await page.goto('/complete-profile'); await expect(page).toHaveURL(/\/schedule$/);
    await page.goto('/profile'); await expect(page.getByTestId('unverified-note')).toBeVisible(); await expect(page.getByText(reg)).toBeVisible(); await expect(page.locator(`input[value="${reg}"]`)).toHaveCount(0);
    await page.getByRole('button', { name: 'Request a change' }).click(); await page.getByLabel(/What should change/).fill('Please correct my semester, I was promoted.'); await page.getByRole('button', { name: 'Send request' }).click(); await expect(page.getByText('Request sent to your campus examination office')).toBeVisible();
    const r = await page.request.patch('/api/auth/profile', { data: { phone: '0300-7654321', semester: 1, regNo: 'HACK', institutionId: '00000000-0000-4000-8000-000000000000' } }); expect(r.status()).toBe(200);
    expect((await (await page.request.get('/api/auth/me')).json()).student).toMatchObject({ regNo: reg, semester: 4, selfDeclared: true });
  });

  test('a completed profile does not make the student eligible: no exams listed, and the live exam is refused by URL and API', async ({ page }) => {
    await signInAgain(page, email); expect((await (await page.request.get('/api/me/exams')).json()).items).toEqual([]);
    const examId = await liveExamId(page);
    await page.goto(`/exam/${examId}`); await expect(page.getByRole('button', { name: /Begin examination|Resume/ })).toHaveCount(0);
    expect((await page.request.post('/api/attempts/start', { data: { examId, clientId: 'c' + letters(12) } })).status()).toBe(403);
  });
});

test('existing students are unaffected: they land on the dashboard, see My Examinations in sections, and can still reach the live exam', async ({ page }) => {
  await login(page, 'student.b005'); await expect(page).toHaveURL(/\/dashboard/); await expect(page.getByRole('link', { name: 'My Examinations' }).first()).toBeVisible();
  await page.goto('/schedule'); await expect(page.getByTestId('exams-available')).toContainText('MBBS-PATH-MT');
  const row = page.getByTestId('exams-available').locator('tbody tr').first(); await expect(row).toContainText('Pathology'); await expect(row).toContainText(/\d+ min/);
  await row.getByRole('link', { name: /Start/ }).click(); await expect(page.getByRole('button', { name: /Begin examination/ })).toBeVisible();
});
