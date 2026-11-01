import { expect, test } from '@playwright/test';
import { login } from './helpers';

/** UI-025: Deactivate is a consequential action and needs an explicit confirmation; Cancel changes nothing; affiliation survives (UI-002). */
test('Super Admin must confirm deactivating an institution; cancelling changes nothing', async ({ page }) => {
  const code = 'ZZ-' + Array.from({ length: 5 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join('');
  await login(page, 'super.admin'); await page.goto('/institutions');
  await page.getByRole('button', { name: '+ Register institution' }).click();
  const dlg = page.getByRole('dialog'); await dlg.getByLabel('Code').fill(code); await dlg.getByLabel('Name').fill(`Confirm drill ${code}`);
  await dlg.getByLabel('Affiliation').selectOption('AFFILIATED'); await dlg.getByRole('button', { name: 'Register', exact: true }).click();
  const row = page.locator('tbody tr', { hasText: code }); await expect(row).toBeVisible();
  await row.getByRole('button', { name: /^Deactivate/ }).click();
  const confirm = page.getByRole('dialog', { name: /Deactivate Confirm drill/ }); await expect(confirm).toBeVisible(); await expect(confirm.getByText(/No student data is deleted/)).toBeVisible();
  await confirm.getByRole('button', { name: 'Cancel' }).click(); await expect(confirm).toHaveCount(0); await expect(row.getByText(/active/i).first()).toBeVisible();
  await row.getByRole('button', { name: /^Deactivate/ }).click(); await page.getByRole('button', { name: 'Deactivate institution' }).click();
  await expect(row.getByRole('button', { name: /^Activate/ })).toBeVisible();
  await expect(row).toContainText(/affiliated/i);
  await row.getByRole('button', { name: /^Activate/ }).click(); await expect(row.getByRole('button', { name: /^Deactivate/ })).toBeVisible(); await expect(row).toContainText(/affiliated/i);
});
