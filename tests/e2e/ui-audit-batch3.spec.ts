import { expect, test } from '@playwright/test';
import { login } from './helpers';

/** UI audit A-03, A-09, A-14, A-15, A-17 (docs/audits/UI_UX_FINDINGS.md). */
test.describe('UI audit batch: profile, roster, exam list, question bank, sign-out', () => {
  test('A-17: sign-out has a visible label, not only an icon', async ({ page }) => {
    await login(page, 'student.a001');
    const b = page.getByRole('button', { name: 'Sign out' });
    await expect(b).toBeVisible(); await expect(b).toContainText('Sign out');
  });

  test('A-03: managed identity fields are plain text, not inputs that look editable', async ({ page }) => {
    await login(page, 'student.a001'); await page.goto('/profile');
    await expect(page.getByRole('textbox', { name: 'Full name' })).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Email' })).toHaveCount(0);
    await expect(page.getByText('student.a001@demo.szabmu.invalid')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Phone' })).toBeEditable();
  });

  test('A-14: the exam list has one link per exam, and the code does not wrap', async ({ page }) => {
    await login(page, 'cce'); await page.goto('/exams');
    await expect(page.getByRole('link', { name: /^Open ›/ })).toHaveCount(0);
    const code = page.locator('tbody tr').first().locator('a.code');
    await expect(code).toHaveCSS('white-space', 'nowrap');
  });

  test('A-15: question bank headers are plain words', async ({ page }) => {
    await login(page, 'examiner'); await page.goto('/questions');
    for (const h of ['Difficulty', 'In papers', 'Correct']) await expect(page.getByRole('columnheader', { name: h })).toBeVisible();
    for (const h of ['Diff.', 'Used', 'Key']) await expect(page.getByRole('columnheader', { name: h, exact: true })).toHaveCount(0);
  });

  test('A-09: Withdraw on a roster row is a quiet link-style control', async ({ page }) => {
    await login(page, 'cce'); await page.goto('/exams');
    await page.getByRole('link', { name: /MBBS-PATH-MT|Pathology Mid-term/ }).first().click();
    const w = page.locator('tbody tr', { hasText: 'DMC-B-2024-0006' }).getByRole('button', { name: 'Withdraw…' });
    await expect(w).toHaveClass(/btn-link/); await expect(w).not.toHaveClass(/(^|\s)btn(\s|$)/);
  });
});
