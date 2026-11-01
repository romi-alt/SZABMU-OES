import { expect, test } from '@playwright/test';
import { login } from './helpers';

// student.b007 is used by no other spec (the specs share one seeded database; each state-changing spec owns its candidate).
test('all MCQs on one page: answer several, skip and mark in place, palette jumps, survives reload, review and submit', async ({ page }) => {
  await login(page, 'student.b007');
  await page.goto('/schedule'); await page.getByRole('link', { name: /Start|Resume/ }).click();
  await page.getByRole('button', { name: /begin|resume/i }).click();
  await expect(page.getByRole('timer')).toBeVisible();

  await page.getByTestId('layout-all').click();
  const cards = page.locator('[data-testid="all-questions"] section.q-card');
  await expect(cards).toHaveCount(12);                                            // every MCQ is on the page at once

  await page.getByTestId('all-opt-3-B').click();
  await page.getByTestId('all-opt-7-D').click();
  await expect(cards.nth(2).locator('.save-state')).toHaveText('✓ Saved');         // per-question server confirmation
  await expect(cards.nth(6).locator('.save-state')).toHaveText('✓ Saved');
  await expect(page.locator('.exam-bar')).toContainText('Answered 2 / 12');

  await expect(cards.nth(4).getByRole('button', { name: 'Skip question' })).toHaveCount(0);   // one way to leave a question unanswered: don't answer it
  await cards.nth(2).getByRole('button', { name: 'Mark for review' }).click();    // answered + marked
  await expect(page.getByTestId('all-opt-3-B')).toHaveAttribute('aria-checked', 'true');

  await page.locator('#question-navigator').getByRole('button', { name: /^Question 11,/ }).click();             // palette jumps to question 11
  await expect(cards.nth(10)).toBeInViewport();

  await page.reload();                                                            // layout and answers survive a reload; it resumes directly (UI-040)
  await expect(page.getByRole('timer')).toBeVisible();
  await page.getByTestId('layout-all').click();
  await expect(page.getByTestId('all-opt-3-B')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('all-opt-7-D')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.exam-bar')).toContainText('Answered 2 / 12');

  await page.getByRole('button', { name: /review & submit/i }).first().click();
  await expect(page.getByRole('heading', { name: 'Review your answers' })).toBeVisible();
  await page.getByRole('button', { name: /submit examination/i }).click();
  await page.getByLabel(/I have reviewed/).check();
  await page.getByTestId('confirm-submit').click();
  await expect(page.getByTestId('receipt-code')).toHaveText(/^RC-/);
});
