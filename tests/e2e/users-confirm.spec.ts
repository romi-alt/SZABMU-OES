import { expect, test } from '@playwright/test';
import { login } from './helpers';

/** Audit A-12: deactivating an account and resetting its password are confirmed first; Cancel changes nothing. Uses lecturer.b (no other spec does). */
test('staff account actions need confirmation; cancelling changes nothing, confirming deactivates and reactivation restores', async ({ page }) => {
  await login(page, 'super.admin'); await page.goto('/users');
  await page.getByLabel('Search').fill('lecturer.b'); const row = page.getByRole('row', { name: /lecturer\.b@/ });
  await expect(row).toContainText('Active');
  const stateOf = async () => { const r = await (await page.request.get('/api/users?staffOnly=true&search=lecturer.b')).json(); return r.items.find((u: { email: string }) => u.email.startsWith('lecturer.b@')); };
  const before = await stateOf();

  await row.getByRole('button', { name: 'Reset password…' }).click();
  const reset = page.getByRole('dialog', { name: /Reset the password of/ }); await expect(reset).toContainText('stops working at once');
  await reset.getByRole('button', { name: 'Cancel' }).click(); await expect(reset).toHaveCount(0);

  await row.getByRole('button', { name: 'Deactivate…' }).click();
  const off = page.getByRole('dialog', { name: /Deactivate/ }); await expect(off).toContainText('signed out everywhere');
  await off.getByRole('button', { name: 'Cancel' }).click(); await expect(off).toHaveCount(0);
  const unchanged = await stateOf(); expect(unchanged.active).toBe(true); expect(unchanged.mustChangePw ?? false).toBe(before.mustChangePw ?? false);

  await row.getByRole('button', { name: 'Deactivate…' }).click(); await page.getByRole('button', { name: 'Deactivate account' }).click();
  await expect(row).toContainText(/Cancelled|Inactive/i); expect((await stateOf()).active).toBe(false);
  await row.getByRole('button', { name: 'Reactivate' }).click(); await expect(row).toContainText('Active'); expect((await stateOf()).active).toBe(true);
});
