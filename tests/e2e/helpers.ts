import { createHmac } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
export const PASSWORD = 'Demo-Passw0rd-2026!';
export const email = (local: string) => `${local}@demo.szabmu.invalid`;

export async function login(page: Page, local: string) {
  await page.goto('/login');
  await page.getByLabel('University email').fill(email(local));
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}
export const qnum = (page: Page) => page.locator('.q-head span').first();

/** RFC 6238 TOTP (HMAC-SHA1, 6 digits, 30 s) for driving the authenticator step in browser tests. */
export function totp(secretBase32: string, atMs = Date.now()): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = 0, value = 0; const bytes: number[] = [];
  for (const ch of secretBase32.replace(/=+$/, '')) { value = (value << 5) | alphabet.indexOf(ch); bits += 5; if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(Math.floor(atMs / 30000)));
  const h = createHmac('sha1', Buffer.from(bytes)).update(msg).digest(); const o = h[h.length - 1]! & 15;
  return String((((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!) % 1_000_000).padStart(6, '0');
}

/**
 * Collects Content-Security-Policy violations for a page: both the browser's console report and the securitypolicyviolation event.
 * A test that drives a real flow asserts the returned list is empty, so a policy that breaks rendering fails loudly.
 */
export function watchCsp(page: Page): string[] {
  const seen: string[] = [];
  page.on('console', (m) => { if (/violates the following Content Security Policy|CSPVIOLATION/i.test(m.text())) seen.push(m.text().slice(0, 240)); });
  void page.addInitScript(() => document.addEventListener('securitypolicyviolation', (e) => console.error(`CSPVIOLATION ${e.violatedDirective} ${e.blockedURI}`)));
  return seen;
}
