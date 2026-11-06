import { expect, test, type Page, type TestInfo } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { login } from './helpers';

/**
 * Accessibility scans of the screens with the highest stakes (audit 2026-11, UI-A11Y-01): sign-up, profile completion, the exam player
 * (instructions, a question, the review screen) and the receipt, teacher registration, and the staff screens used during a live exam.
 * Same rule set and threshold as a11y.spec.ts: WCAG 2.0/2.1/2.2 A and AA; serious/critical violations fail, the rest is attached.
 * An automated scan finds only part of the possible barriers; it is not a WCAG conformance claim.
 */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
async function scan(page: Page, label: string, ti: TestInfo) {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  if (violations.length) await ti.attach(`axe-${label}.json`, { body: JSON.stringify(violations, null, 2), contentType: 'application/json' });
  const blocking = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(blocking.map((v) => `${v.id} (${v.impact}): ${v.help} — ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`), `${label}: serious/critical axe violations`).toEqual([]);
}

test.describe('axe scans of critical journeys', () => {
  test('student sign-up and teacher registration', async ({ page }, ti) => {
    await page.goto('/register'); await expect(page.getByRole('button', { name: 'Create Account' })).toBeVisible(); await scan(page, 'register', ti);
    await page.getByRole('button', { name: 'Create Account' }).click(); await expect(page.getByText('Enter a valid email address.')).toBeVisible(); await scan(page, 'register-errors', ti);
    await page.goto('/register/teacher'); await expect(page.getByRole('heading').first()).toBeVisible(); await scan(page, 'teacher-register', ti);
  });

  test('exam player: instructions, a question, the review screen and the receipt', async ({ page }, ti) => {
    await login(page, 'student.a009');
    await page.goto('/schedule'); await page.getByTestId('exams-available').getByRole('link', { name: /Start/ }).click();
    await expect(page.getByRole('button', { name: /begin examination/i })).toBeVisible(); await scan(page, 'exam-instructions', ti);
    await page.getByRole('button', { name: /begin examination/i }).click(); await expect(page.getByRole('timer')).toBeVisible();
    await page.getByTestId('opt-B').click(); await expect(page.getByTestId('save-state')).toHaveText('✓ Saved');
    await page.getByRole('button', { name: 'Mark for review' }).click(); await scan(page, 'exam-question', ti);
    await page.getByRole('button', { name: /review & submit/i }).click(); await expect(page.getByRole('heading', { name: 'Review your answers' })).toBeVisible(); await scan(page, 'exam-review', ti);
    await page.getByRole('button', { name: /submit examination/i }).click(); await expect(page.getByTestId('confirm-submit')).toBeVisible(); await scan(page, 'exam-confirm', ti);
    await page.getByRole('checkbox').check(); await page.getByTestId('confirm-submit').click(); await expect(page.getByTestId('receipt')).toBeVisible(); await scan(page, 'exam-receipt', ti);
  });

  test('staff screens used during a live exam and for teacher approval', async ({ page }, ti) => {
    await login(page, 'cce');
    const list = await (await page.request.get('/api/exams?pageSize=50')).json(); const exam = (list.items ?? list).find((e: { code: string }) => e.code === 'MBBS-PATH-MT');
    await page.goto(`/exams/${exam.id}/control`); await expect(page.getByRole('heading').first()).toBeVisible(); await scan(page, 'exam-control', ti);
    await page.goto('/monitor'); await expect(page.getByRole('heading').first()).toBeVisible(); await scan(page, 'monitor', ti);
    await page.goto('/teachers'); await expect(page.getByRole('heading').first()).toBeVisible(); await scan(page, 'teachers-admin', ti);
  });
});
