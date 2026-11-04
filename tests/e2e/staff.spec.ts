import { expect, test } from '@playwright/test';
import { login } from './helpers';

test.describe('staff workflows', () => {
  test('campus admin sees only their own campus and can add a student (temporary password shown once)', async ({ page }) => {
    await login(page, 'admin.a');
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Students' }).click();
    await expect(page.getByRole('heading', { name: 'Students' })).toBeVisible();
    await expect(page.locator('tbody tr').first()).toBeVisible();
    const campuses = await page.locator('tbody tr td:nth-child(6)').allInnerTexts();
    expect(campuses.length).toBeGreaterThan(0);
    expect(new Set(campuses)).toEqual(new Set(['DMC-A']));
    await page.getByRole('button', { name: '+ Add student' }).click();
    const dlg = page.getByRole('dialog', { name: 'Add student' });
    await dlg.getByLabel('Full name').fill('Playwright Student (demo)');
    await dlg.getByLabel('Email').fill('pw.student@demo.szabmu.invalid');
    await dlg.getByLabel('Registration no.').fill('DMC-A-2025-9001');
    await dlg.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByText(/Temporary password \(shown once\)/)).toBeVisible();
    await page.getByPlaceholder('Name or registration number').fill('9001');
    await expect(page.getByText('DMC-A-2025-9001')).toBeVisible();
  });

  test('lecturer authors a clinical MCQ → submits → examiner approves', async ({ page, browser }) => {
    await login(page, 'lecturer.a');
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Question bank' }).click();
    await page.getByRole('button', { name: '+ New question' }).click();
    const dlg = page.getByRole('dialog', { name: 'New question' });
    await dlg.getByLabel('Type').selectOption('CLINICAL_MCQ');
    await dlg.getByLabel('Clinical vignette').fill('A 34-year-old woman presents with fatigue, pallor and koilonychia. Haemoglobin is 8.2 g/dL with a low MCV.');
    await dlg.getByLabel('Lead-in question').fill('Which investigation best confirms the underlying cause of this anaemia?');
    const opts = ['Serum ferritin', 'Vitamin B12 level', 'Bone marrow biopsy', 'Hb electrophoresis'];
    for (const [i, t] of opts.entries()) await dlg.getByLabel(`Option ${'ABCD'[i]} text`).fill(t);
    await expect(dlg.getByRole('button', { name: 'Save draft' })).toBeEnabled();
    await dlg.getByRole('button', { name: 'Save draft' }).click();
    const row = page.locator('tbody tr', { hasText: 'underlying cause of this anaemia' });
    await expect(row).toContainText('Draft');
    await row.getByRole('button', { name: 'Submit' }).click();
    await expect(row).toContainText('Submitted');

    const ctx = await browser.newContext(); const ex = await ctx.newPage();
    await login(ex, 'examiner');
    await ex.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Question bank' }).click();
    const r2 = ex.locator('tbody tr', { hasText: 'underlying cause of this anaemia' });
    await expect(r2).toContainText('Submitted');
    await r2.getByRole('button', { name: 'Approve' }).click();
    await expect(r2).toContainText('Approved');
    await ctx.close();
  });

  test('invigilator monitors only their campus and sees a live candidate', async ({ page, browser }) => {
    const ctx = await browser.newContext(); const s = await ctx.newPage();
    await login(s, 'student.b003');
    await s.goto('/schedule'); await s.getByRole('link', { name: /Start|Resume/ }).click();
    await s.getByRole('button', { name: /begin|resume/i }).click();
    await expect(s.getByRole('timer')).toBeVisible();
    await s.getByTestId('opt-A').click();
    await expect(s.getByTestId('save-state')).toHaveText('✓ Saved');

    await login(page, 'invigilator.b');
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Live monitor' }).click();
    await page.getByRole('link', { name: /Monitor/ }).first().click();
    await expect(page.getByRole('heading', { name: 'Live monitor' })).toBeVisible();
    const rows = page.locator('tbody tr');
    await expect(rows.first()).toBeVisible();
    // The first row can be visible before the candidate rows have rendered: wait for a campus cell before reading the column.
    await expect(page.locator('tbody tr td:nth-child(3)').first()).toHaveText(/DMC-/);
    const campus = await page.locator('tbody tr td:nth-child(3)').allInnerTexts();
    expect(new Set(campus)).toEqual(new Set(['DMC-B']));
    const mine = page.locator('tbody tr', { hasText: 'DMC-B-2024-0003' });
    await expect(mine).toContainText('In progress');
    await expect(mine.getByRole('button', { name: 'Add time for DMC-B-2024-0003' })).toBeVisible();
    await expect(mine.getByRole('button', { name: 'End attempt for DMC-B-2024-0003' })).toHaveText('End attempt…');
    await expect(mine.getByRole('button', { name: 'Report incident for DMC-B-2024-0003' })).toBeVisible();
    await ctx.close();
  });

  test('CCE dashboard and audit chain verification', async ({ page }) => {
    await login(page, 'cce');
    await expect(page.getByText('Papers to approve')).toBeVisible();
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Audit trail' }).click();
    await page.getByRole('button', { name: 'Verify chain integrity' }).click();
    await expect(page.getByText(/Chain intact/)).toBeVisible();
  });

  test('CCE withdraws a candidate admission with a mandatory reason; campus admin has no override control', async ({ page, browser }) => {
    await login(page, 'cce');
    await page.goto('/exams');
    await page.getByRole('link', { name: /MBBS-PATH-MT|Pathology Mid-term/ }).first().click();
    const row = page.locator('tbody tr', { hasText: 'DMC-B-2024-0006' });
    await expect(row).toBeVisible();
    await expect(row.getByText('Admitted')).toBeVisible();
    await row.getByRole('button', { name: 'Withdraw…' }).click();
    const dlg = page.getByRole('dialog', { name: /Withdraw admission of DMC-B-2024-0006/ });
    const submit = dlg.getByRole('button', { name: 'Record decision' });
    await expect(submit).toBeDisabled(); // reason required
    await dlg.getByLabel(/Reason/).fill('Synthetic test: examination-office instruction');
    await submit.click();
    await expect(row.getByText('Revoked')).toBeVisible();
    await expect(row.getByRole('button', { name: 'Admit…' })).toBeVisible();

    const ctx2 = await browser.newContext(); const p2 = await ctx2.newPage();
    await login(p2, 'admin.a');
    await p2.goto('/exams');
    await p2.getByRole('link', { name: /MBBS-PATH-MT|Pathology Mid-term/ }).first().click();
    await expect(p2.locator('tbody tr').first()).toBeVisible();
    await expect(p2.getByRole('button', { name: /Withdraw…|Admit…/ })).toHaveCount(0);
    await ctx2.close();
  });

  test('course assignments: campus admin manages their campus only; a lecturer sees only assigned courses in the question bank', async ({ page, browser }) => {
    await login(page, 'admin.a');
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Lecturer assignments' }).click();
    await expect(page.getByRole('heading', { name: 'Lecturer course assignments' })).toBeVisible();
    await expect(page.locator('tbody tr')).toHaveCount(3); // lecturer.a ×2 (PATH, PHARM) + lecturer.a2 ×1; campus B's assignment is invisible
    const text = await page.locator('tbody').innerText();
    expect(text).not.toContain('Saqib'); // lecturer.b belongs to campus B

    const ctx2 = await browser.newContext(); const p2 = await ctx2.newPage();
    await login(p2, 'lecturer.a2');
    await p2.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Question bank' }).click();
    await expect(p2.getByRole('heading', { name: /Question bank/ })).toBeVisible();
    await expect(p2.getByLabel('Course').first().locator('option')).toHaveCount(2); // "All courses" + the single assigned course
    await ctx2.close();
  });
});
