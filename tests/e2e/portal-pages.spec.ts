import { expect, test } from '@playwright/test';

/** The staff portal serves every staff page. The teacher question-bank screens were missing from its allow-list and answered 404 on dashboard.szabmu.site. */
const STAFF = 'http://localhost:3002';
for (const path of ['/question-banks', '/submissions', '/pools', '/institutions']) {
  test(`the staff portal serves ${path} (a blocked page answers 404)`, async ({ request }) => {
    expect((await request.get(`${STAFF}${path}`)).status(), path).toBe(200);
  });
}
test('a candidate page is still not served on the staff portal', async ({ request }) => {
  expect((await request.get(`${STAFF}/schedule`)).status()).toBe(404);
});
