import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('a notification is a working link: it opens the page it refers to and marks itself read', async ({ page }) => {
  await login(page, 'student.b002');
  const bell = page.getByRole('button', { name: /^Notifications, \d+ unread/ });
  const unread = async () => Number(/(\d+) unread/.exec((await bell.getAttribute('aria-label')) ?? '')![1]);
  await expect.poll(unread).toBeGreaterThan(0);                                      // the bell loads its count asynchronously
  const before = await unread();
  await bell.click();
  const link = page.getByTestId('notification-link').filter({ hasText: /Exam scheduled/ }).first();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/schedule$/);                                          // an existing route, not a dead /student/schedule
  await expect(page.getByRole('heading', { name: 'My Examinations' })).toBeVisible();
  // The portal's own not-found page (app/not-found.tsx). A bare /404/ also matched schedule rows whose cells run together,
  // e.g. a close time of 12:40 followed by "40 min" — the test then failed depending on the time of day.
  await expect(page.getByRole('heading', { name: 'Page not found' })).toHaveCount(0);
  await expect.poll(unread).toBe(before - 1);                                           // clicking also marked it read
});
