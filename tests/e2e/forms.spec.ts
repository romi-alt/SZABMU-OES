import { expect, test } from '@playwright/test';
import { login } from './helpers';

/** UI-026: required markers, inline "is required" on blur, a list of what is missing, and protection against losing typed data. */
test.describe('form dialogs', () => {
  test('institution form: required markers, blur validation, missing list, and the primary action explains itself', async ({ page }) => {
    await login(page, 'super.admin'); await page.goto('/institutions');
    await page.getByRole('button', { name: '+ Register institution' }).click();
    const dlg = page.getByRole('dialog'); const code = dlg.getByLabel(/^Code/); const name = dlg.getByLabel(/^Name/);
    await expect(code).toHaveAttribute('aria-required', 'true'); await expect(dlg.locator('label.f', { hasText: 'Code' }).locator('.req')).toBeVisible();
    await expect(dlg.getByTestId('modal-missing')).toHaveText('Still needed: Code, Name.'); await expect(dlg.getByRole('button', { name: 'Register', exact: true })).toBeDisabled();
    await code.focus(); await name.focus();                                                              // leave Code empty
    await expect(dlg.getByText('Code is required.')).toBeVisible(); await expect(code).toHaveAttribute('aria-invalid', 'true');
    await code.fill('ZZ-TEST'); await expect(dlg.getByText('Code is required.')).toHaveCount(0); await expect(dlg.getByTestId('modal-missing')).toHaveText('Still needed: Name.');
    await name.fill('Form drill'); await expect(dlg.getByTestId('modal-missing')).toHaveCount(0); await expect(dlg.getByRole('button', { name: 'Register', exact: true })).toBeEnabled();
  });

  test('typed data survives an accidental Escape, backdrop click, ✕ or Cancel; a pristine dialog closes immediately', async ({ page }) => {
    await login(page, 'super.admin'); await page.goto('/institutions');
    const open = () => page.getByRole('button', { name: '+ Register institution' }).click();
    const dlg = page.getByRole('dialog');
    await open(); await page.keyboard.press('Escape'); await expect(dlg).toHaveCount(0);                      // nothing typed: no prompt
    await open(); await dlg.getByLabel(/^Name/).fill('Typed text'); await expect(dlg.getByTestId('modal-missing')).toBeVisible();
    for (const how of ['escape', 'backdrop', 'x', 'cancel']) {
      if (how === 'escape') await page.keyboard.press('Escape');
      if (how === 'backdrop') await page.mouse.click(5, 5);
      if (how === 'x') await dlg.getByRole('button', { name: 'Dismiss dialog' }).click();
      if (how === 'cancel') await dlg.getByRole('button', { name: 'Cancel' }).click();
      await expect(page.getByRole('alertdialog', { name: 'Discard changes?' }), how).toBeVisible(); await expect(dlg).toBeVisible(); await expect(dlg.getByLabel(/^Name/)).toHaveValue('Typed text');
      await expect(page.getByTestId('keep-editing')).toBeFocused();
      await page.getByTestId('keep-editing').click(); await expect(page.getByRole('alertdialog')).toHaveCount(0);
    }
    await page.keyboard.press('Escape'); await page.getByTestId('discard-changes').click(); await expect(dlg).toHaveCount(0);
    await open(); await expect(dlg.getByLabel(/^Name/)).toHaveValue('');                                       // discarded for real
  });

  test('exam and question dialogs list what is missing; the question dialog keeps its buttons on screen at laptop height', async ({ browser }) => {
    const c = await browser.newContext({ viewport: { width: 1366, height: 700 } }); const page = await c.newPage(); await login(page, 'examiner');
    await page.goto('/exams'); await page.getByRole('button', { name: /New exam|Schedule/ }).first().click();
    const dlg = page.getByRole('dialog'); await expect(dlg.getByTestId('modal-missing')).toContainText('Exam title'); await expect(dlg.getByTestId('modal-missing')).toContainText('participating institution');
    await expect(dlg.getByRole('button', { name: 'Create draft' })).toBeDisabled(); await dlg.getByRole('button', { name: 'Dismiss dialog' }).click();
    await page.goto('/questions'); await page.getByRole('button', { name: /New question/ }).first().click();
    await expect(dlg.getByTestId('modal-missing')).toContainText('correct option');
    const box = await dlg.boundingBox(); expect(box!.y + box!.height).toBeLessThanOrEqual(700);                // dialog fits the viewport; its body scrolls
    const save = await dlg.getByRole('button', { name: 'Save draft' }).boundingBox(); expect(save!.y + save!.height).toBeLessThanOrEqual(700);
    await c.close();
  });
});
