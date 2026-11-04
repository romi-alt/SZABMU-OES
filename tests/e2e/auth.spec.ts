import { expect, test } from '@playwright/test';
import { PASSWORD, email, login, totp } from './helpers';

/**
 * The two-factor spec enrols a privileged account in MFA, which changes how that account signs in. It therefore owns a seeded
 * account that NO other spec uses (examiner2: an MFA-enforced role), and removes the enrolment afterwards through the real admin
 * endpoint (POST /auth/mfa/reset/:userId), so the suite is order-independent and can be repeated on the same database.
 */
const MFA_USER = 'examiner2';

test.describe('authentication', () => {
  test.afterAll(async ({ playwright }) => {
    const api = await playwright.request.newContext({ baseURL: 'http://localhost:3000' });
    try {
      const sa = await api.post('/api/auth/login', { data: { email: email('super.admin'), password: PASSWORD } });
      if (!sa.ok()) return;
      const users = await (await api.get('/api/users?role=EXAMINER&pageSize=100')).json();
      const target = (users.items ?? []).find((u: { email: string }) => u.email === email(MFA_USER));
      if (target) await api.post(`/api/auth/mfa/reset/${target.id}`, { data: {} });
    } finally { await api.dispose(); }
  });

  test('sign-in page shows the university identity and rejects bad credentials accessibly', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('img', { name: /Shaheed Zulfiqar Ali Bhutto Medical University/i }).first()).toBeVisible();
    await page.getByLabel('University email').fill(email('student.a002'));
    await page.getByLabel('Password').fill('wrong-password-1');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.locator('.notice.bad')).toContainText(/incorrect email or password/i);
    await expect(page).toHaveURL(/\/login/);
  });

  test('unauthenticated visitors are redirected to sign-in', async ({ page }) => {
    await page.goto('/students');
    await expect(page).toHaveURL(/\/login/);
  });

  test('student signs in, sees the student navigation only, and signs out', async ({ page }) => {
    await login(page, 'student.a002');
    const nav = page.getByRole('navigation', { name: 'Primary' });
    await expect(nav.getByRole('link', { name: 'My Examinations' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Students' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Audit trail' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });

  test('a student who types an admin URL gets a permission error, not data', async ({ page }) => {
    await login(page, 'student.a003');
    await page.goto('/users');
    await expect(page.getByRole('heading', { name: /do not have access to Staff & accounts/ })).toBeVisible();
  });

  test('password recovery: code → new password → sign in with it', async ({ page }) => {
    await page.goto('/forgot');
    await page.getByLabel('University email').fill(email('student.b004'));
    await page.getByRole('button', { name: /send verification code/i }).click();
    const dev = await page.getByTestId('dev-code').locator('b').innerText();
    await page.getByLabel('Digit 1').click();
    await page.keyboard.type(dev);
    await page.getByRole('button', { name: /^verify/i }).click();
    await page.getByLabel('New password', { exact: true }).fill('weak');
    await expect(page.getByRole('button', { name: /update password/i })).toBeDisabled();
    const strong = 'Playwright-New-Passw0rd!';
    await page.getByLabel('New password', { exact: true }).fill(strong);
    await expect(page.getByText('Strong password')).toBeVisible();
    await page.getByLabel('Confirm password').fill(strong);
    await page.getByRole('button', { name: /update password/i }).click();
    await expect(page.getByText(/password has been changed/i)).toBeVisible();
    await page.getByRole('link', { name: /back to sign in/i }).click();
    await page.getByLabel('University email').fill(email('student.b004'));
    await page.getByLabel('Password').fill(strong);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('public certificate verification rejects unknown serials', async ({ page }) => {
    await page.goto('/verify');
    await page.getByLabel('Serial').fill('SZABMU/2026/9999');
    await page.getByLabel('Verify code').fill('NOPE12');
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page.getByTestId('verify-bad')).toBeVisible();
    void PASSWORD;
  });

  test('two-factor: a staff member opts in with an authenticator app, then must pass the code step at the next sign-in', async ({ page, browser }) => {
    await login(page, MFA_USER);
    await page.goto('/profile');
    await page.getByRole('link', { name: 'Set up two-factor authentication' }).click();
    await page.getByRole('button', { name: 'Begin setup' }).click();
    const secret = (await page.getByTestId('mfa-secret').innerText()).trim();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    await page.getByLabel(/6-digit code/).fill('000000');
    await page.getByRole('button', { name: 'Verify and turn on' }).click();
    await expect(page.locator('.notice.bad')).toContainText(/not valid/i);                // wrong code is refused
    await page.getByLabel(/6-digit code/).fill(totp(secret));
    await page.getByRole('button', { name: 'Verify and turn on' }).click();
    await expect(page.getByRole('heading', { name: 'Save your recovery codes' })).toBeVisible();
    await expect(page.getByLabel('Recovery codes')).toContainText(/[0-9A-F]{5}-[0-9A-F]{5}/);
    await page.getByLabel(/I have stored these codes/).check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    // a fresh browser: password alone is not enough any more
    const ctx2 = await browser.newContext(); const p2 = await ctx2.newPage();
    await p2.goto('/login');
    await p2.getByLabel('University email').fill(email(MFA_USER));
    await p2.getByLabel('Password').fill(PASSWORD);
    await p2.getByRole('button', { name: /sign in/i }).click();
    await expect(p2).toHaveURL(/\/mfa/);
    await expect(p2.getByRole('heading', { name: 'Two-factor verification' })).toBeVisible();
    await p2.goto('/dashboard');                                                       // cannot skip the step by typing a URL
    await expect(p2).toHaveURL(/\/mfa/);
    await p2.getByLabel('Authentication code').fill('123456');
    await p2.getByRole('button', { name: 'Verify' }).click();
    await expect(p2.locator('.notice.bad')).toContainText(/not valid/i);
    await p2.getByLabel('Authentication code').fill(totp(secret, Date.now() + 30_000)); // next step: the enrolment code cannot be replayed
    await p2.getByRole('button', { name: 'Verify' }).click();
    await expect(p2).toHaveURL(/\/dashboard/);
    await ctx2.close();
  });
});
