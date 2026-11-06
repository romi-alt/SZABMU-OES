import { expect, test, type Page } from '@playwright/test';
import { login } from './helpers';

/**
 * Teacher registration (three steps, mobile-first), administrator approval, the five-page teacher workspace and its boundaries — in a real browser against the real API.
 * One teacher is registered through the UI and then taken through pending → approved → revoked.
 */
test.describe.configure({ mode: 'serial' });
const EMAIL = 'e2e.teacher@example.test'; const PW = 'Sturdy-Pass-2026!x'; const NAME = 'Dr Ayesha E2E';
const signIn = async (page: Page, email: string, pw = PW) => { await page.goto('/login'); await page.getByLabel('University email').fill(email); await page.getByLabel('Password').fill(pw); await page.getByRole('button', { name: /sign in/i }).click(); await expect(page).toHaveURL(/\/dashboard/); };

test('registration: three steps on a phone, validation, selection kept between steps, email code, submitted', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/register/teacher');
  await expect(page.getByRole('navigation', { name: 'Registration progress' })).toBeVisible(); await expect(page.getByText('Step 1 of 3')).toBeVisible();
  // step 1: clear validation
  await page.getByRole('button', { name: /Continue/ }).click();
  await expect(page.getByText('Enter your full name.')).toBeVisible(); await expect(page.getByText('Enter a valid email address.')).toBeVisible();
  await page.getByLabel('Full name').fill(NAME); await page.getByLabel(/^Email\b/).fill(EMAIL); await page.getByLabel(/^Password\b/).fill(PW); await page.getByLabel('Confirm password').fill('different');
  await page.getByRole('button', { name: /Continue/ }).click(); await expect(page.getByText('Passwords do not match.')).toBeVisible();
  await page.getByLabel('Confirm password').fill(PW);
  await page.getByRole('button', { name: 'Show characters' }).first().click(); await expect(page.getByLabel(/^Password\b/)).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: /Continue/ }).click();
  // step 2: options come from the real database; several combinations; Back keeps them
  await expect(page.getByText('Step 2 of 3')).toBeVisible(); await expect(page.getByRole('button', { name: /Continue/ })).toBeVisible();
  await page.getByRole('button', { name: /Continue/ }).click(); await expect(page.getByText('Add at least one class and subject to continue.')).toBeVisible();
  await page.getByLabel('Institution').selectOption({ label: 'Demo Medical College A (synthetic)' }); await page.getByLabel('Programme').selectOption({ label: 'Bachelor of Medicine, Bachelor of Surgery' });
  await page.getByLabel('Semester').selectOption('4'); await page.getByLabel('Academic session').selectOption('2026-SPRING');
  await expect(page.getByRole('checkbox')).toHaveCount(2); await page.getByRole('checkbox').nth(0).check(); await page.getByRole('checkbox').nth(1).check();
  await page.getByRole('button', { name: /Add 2 subjects/ }).click(); await expect(page.getByTestId('selected-combos').locator('li')).toHaveCount(2);
  await page.getByLabel('Institution').selectOption({ label: 'Demo Medical College B (synthetic)' }); await page.getByLabel('Academic session').selectOption('2026-SPRING'); await page.getByRole('checkbox').nth(0).check(); await page.getByRole('button', { name: /Add 1 subject/ }).click();
  await expect(page.getByTestId('selected-combos').locator('li')).toHaveCount(3);
  await page.getByTestId('selected-combos').getByRole('button', { name: /^Remove/ }).last().click(); await expect(page.getByTestId('selected-combos').locator('li')).toHaveCount(2);
  await page.getByRole('button', { name: 'Back' }).click(); await expect(page.getByLabel('Full name')).toHaveValue(NAME); await page.getByLabel(/^Password\b/).fill(PW); await page.getByLabel('Confirm password').fill(PW);
  await page.getByRole('button', { name: /Continue/ }).click(); await expect(page.getByTestId('selected-combos').locator('li')).toHaveCount(2);
  await page.getByRole('button', { name: /Continue/ }).click();
  // step 3: profile + review; submit
  await expect(page.getByText('Step 3 of 3')).toBeVisible(); await page.getByRole('button', { name: 'Submit Registration' }).click(); await expect(page.getByText('Enter your department.')).toBeVisible();
  await page.getByLabel('Faculty / employee ID').fill('E2E-0001'); await page.getByLabel('Phone number').fill('+92 300 1234567'); await page.getByLabel('Department').fill('Pathology'); await page.getByLabel('Designation').fill('Assistant Professor');
  await expect(page.getByTestId('review')).toContainText(NAME); await expect(page.getByTestId('review')).toContainText('Classes and subjects requested');
  await page.getByRole('button', { name: 'Submit Registration' }).click();
  // email proof
  const code = (await page.getByTestId('dev-code').locator('b').innerText()).trim(); for (let i = 0; i < 6; i++) await page.getByLabel(`Digit ${i + 1}`).fill(code[i]!);
  await page.getByRole('button', { name: /Confirm and submit/ }).click(); await expect(page.getByTestId('register-done')).toContainText('cannot use the teacher workspace until an administrator approves');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
});

test('a pending teacher sees only the approval status and cannot reach any workspace page, even by URL', async ({ page }) => {
  await signIn(page, EMAIL);
  await expect(page.getByTestId('teacher-approval')).toContainText('awaiting approval'); await expect(page.getByTestId('teacher-approval').locator('tbody tr')).toHaveCount(2);
  await expect(page.getByRole('link', { name: 'MCQ Question Banks' })).toHaveCount(0);
  for (const url of ['/pools', '/classes', '/my-students', '/profile']) { await page.goto(url); await expect(page.getByTestId('teacher-approval'), url).toBeVisible(); }
  expect((await page.request.get('/api/teacher/students')).status()).toBe(403); expect((await page.request.get('/api/teacher/overview')).status()).toBe(403);
});

test('administrator reviews identity, approves one class-subject and rejects the other with a reason', async ({ page }) => {
  await login(page, 'admin.a'); await page.goto('/teachers'); await expect(page.getByRole('tab', { name: /Pending registrations/ })).toBeVisible();
  await page.getByRole('button', { name: NAME }).click(); const d = page.getByTestId('teacher-detail'); await expect(d).toContainText('E2E-0001'); await expect(d).toContainText('Pathology');
  await page.getByRole('button', { name: 'Approve registration' }).click(); await expect(d).toContainText('Approved');
  await expect(d.locator('tbody tr')).toHaveCount(2);
  const path = d.locator('tbody tr', { hasText: 'MBBS-PATH-4' }); const pharm = d.locator('tbody tr', { hasText: 'MBBS-PHARM-4' });
  await path.getByRole('button', { name: 'Approve' }).click(); await expect(path).toContainText('Approved');
  await pharm.getByRole('button', { name: 'Reject' }).click(); await page.getByLabel('Reason').fill('Not on the panel this session'); await page.getByRole('button', { name: 'Reject', exact: true }).last().click(); await expect(pharm).toContainText('Rejected');
});

test('teacher workspace: five pages only; real counts; MCQ pool lifecycle; names-only students; profile', async ({ page }) => {
  await signIn(page, EMAIL);
  const nav = page.getByRole('navigation', { name: 'Primary' }); await expect(nav.getByRole('link')).toHaveText(['Overview', 'My Classes & Subjects', 'MCQ Question Banks', 'My Students', 'Question Submissions', 'My Profile']);
  const kpis = page.getByTestId('teacher-kpis'); await expect(kpis).toContainText('Assigned classes'); await expect(kpis.locator('div').nth(0).locator('dd')).toHaveText('1'); await expect(kpis.locator('div').nth(1).locator('dd')).toHaveText('1');
  await nav.getByRole('link', { name: 'My Classes & Subjects' }).click(); const approved = page.getByTestId('approved-assignments'); await expect(approved.locator('tbody tr')).toHaveCount(1); await expect(page.getByText('Not on the panel this session')).toBeVisible();
  // pool
  await nav.getByRole('link', { name: 'MCQ Question Banks' }).click(); await page.getByRole('button', { name: '+ New question bank' }).click(); await page.getByLabel('Bank title').fill('Endocrine basics'); await page.getByRole('button', { name: 'Create question bank' }).click();
  await expect(page.getByRole('heading', { name: 'Endocrine basics' })).toBeVisible(); await page.getByRole('button', { name: '+ Add MCQ' }).click();
  await page.getByRole('button', { name: 'Add question' }).click(); await expect(page.getByText('Enter the question.')).toBeVisible();
  await page.getByLabel('Question statement').fill('Which organ produces insulin?'); for (const [i, t] of ['Liver', 'Pancreas', 'Kidney', 'Spleen'].entries()) await page.getByLabel(`Option ${'ABCD'[i]}`, { exact: true }).fill(t);
  await page.getByLabel('Option B is correct').check(); await page.getByRole('dialog').getByLabel('Topic').fill('Endocrine'); await page.getByRole('button', { name: 'Add question' }).click();
  const list = page.getByTestId('question-list'); await expect(list.locator('tbody tr')).toHaveCount(1); await list.getByRole('button', { name: 'Preview' }).click(); await expect(page.getByTestId('question-preview')).toContainText('correct'); await page.getByRole('button', { name: 'Close' }).click();
  await list.getByRole('button', { name: 'Duplicate' }).click(); await expect(list.locator('tbody tr')).toHaveCount(2);
  await page.getByLabel('Search').fill('insulin'); await expect(list.locator('tbody tr')).toHaveCount(2); await page.getByLabel('Search').fill('zzzz'); await expect(page.getByTestId('question-empty')).toBeVisible(); await page.getByLabel('Search').fill('');
  await page.getByRole('button', { name: 'Import CSV' }).click(); await page.getByLabel('CSV content').fill('statement,option_a,option_b,option_c,option_d,option_e,correct,explanation,difficulty,topic,marks\nNormal resting heart rate?,20-30,60-100,150-200,300-400,,B,,easy,Cardio,1\n');
  await page.getByRole('button', { name: /Import 1 question/ }).click(); await expect(list.locator('tbody tr')).toHaveCount(3);
  const dl = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export CSV' }).click(); expect((await dl).suggestedFilename()).toBe('Endocrine-basics.csv');
  await page.getByRole('button', { name: /Submit question bank for review/ }).click(); await page.getByRole('button', { name: 'Submit for review' }).click(); await expect(list.getByText('Submitted').first()).toBeVisible();
  // students: names only
  await nav.getByRole('link', { name: 'My Students' }).click(); const names = page.getByTestId('student-names'); await expect(names.locator('tbody tr').first()).toBeVisible(); await expect(names.locator('th')).toHaveText(['Student name']);
  const text = await page.locator('main').innerText(); expect(text).not.toMatch(/@|DMC-|attendance|marks|grade|result|phone|email/i);
  await page.getByLabel('Search').fill('zzzz-nobody'); await expect(page.getByText(/No students/i)).toBeVisible();
  // profile
  await nav.getByRole('link', { name: 'My Profile' }).click(); await expect(page.getByText('E2E-0001')).toBeVisible(); await page.getByLabel('Designation').fill('Professor'); await page.getByRole('button', { name: 'Save changes' }).click(); await expect(page.getByText('Profile saved')).toBeVisible();
  // boundaries by URL and API
  for (const url of ['/exams', '/students', '/results', '/audit', '/enrolment']) { await page.goto(url); await expect(page.getByTestId('error-forbidden'), url).toBeVisible(); }
  for (const api of ['/api/results/exams/x', '/api/me/results', '/api/students', '/api/exams', '/api/questions', '/api/reports/dashboard']) expect([401, 403, 404], api).toContain((await page.request.get(api)).status());
});

test('revoking the approved class-subject removes access at once; suspension signs the teacher out', async ({ browser, page }) => {
  await signIn(page, EMAIL); await page.goto('/classes'); await expect(page.getByTestId('approved-assignments').locator('tbody tr')).toHaveCount(1);
  const admin = await browser.newPage(); await login(admin, 'admin.a'); await admin.goto('/teachers?tab=directory'); await admin.getByRole('button', { name: NAME }).click();
  await admin.getByTestId('teacher-detail').locator('tbody tr', { hasText: 'Approved' }).getByRole('button', { name: 'Revoke' }).click(); await admin.getByLabel('Reason').fill('Moved to another department'); await admin.getByRole('button', { name: 'Remove access' }).click(); await expect(admin.getByTestId('teacher-detail')).toContainText('Revoked');
  await page.reload(); await expect(page.getByTestId('approved-assignments')).toHaveCount(0); await expect(page.getByText('You have no approved class or subject yet.')).toBeVisible();
  expect((await page.request.get('/api/teacher/students')).status()).toBe(200); expect((await (await page.request.get('/api/teacher/students')).json()).total).toBe(0);
  await admin.getByRole('button', { name: 'Suspend access' }).click(); await admin.getByLabel('Reason').fill('Under review'); await admin.getByRole('button', { name: 'Suspend access' }).last().click(); await expect(admin.getByTestId('teacher-detail')).toContainText('Suspended');
  await page.reload(); await expect(page).toHaveURL(/\/login/);
  await signIn(page, EMAIL).catch(() => undefined); await expect(page.getByTestId('teacher-approval')).toContainText('suspended');
  await admin.close();
});
