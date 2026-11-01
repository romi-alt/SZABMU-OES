import { expect, test } from '@playwright/test';
import { login, watchCsp } from './helpers';

const directive = (csp: string, name: string) => csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) ?? '';

test.describe('Content-Security-Policy and favicon', () => {
  test('every document response carries a strict, per-request-nonce policy (production build)', async ({ request }) => {
    const r1 = await request.get('/login'); const r2 = await request.get('/login');
    const c1 = r1.headers()['content-security-policy']!; const c2 = r2.headers()['content-security-policy']!;
    expect(c1).toBeTruthy();
    const script = directive(c1, 'script-src');
    expect(script).toMatch(/'nonce-[A-Za-z0-9+/=]+'/); expect(script).toContain("'strict-dynamic'");
    expect(script).not.toContain("'unsafe-inline'"); expect(script).not.toContain("'unsafe-eval'");   // no blanket workaround
    expect(directive(c1, 'style-src')).not.toContain("'unsafe-inline'");
    expect(directive(c1, 'style-src-attr')).toBe("style-src-attr 'unsafe-inline'");                    // the one documented relaxation
    for (const d of ["default-src 'self'", "connect-src 'self'", "object-src 'none'", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'"]) expect(c1).toContain(d);
    expect(c1).not.toMatch(/\*(?!:)/);                                                                  // no wildcard sources
    const nonce = (s: string) => /'nonce-([^']+)'/.exec(s)![1];
    expect(nonce(c1)).not.toBe(nonce(c2));                                                              // fresh nonce for every request
    const html = await r1.text();
    expect(html).toContain(`nonce="${nonce(c1)}"`);                                                     // Next applied it to the real script tags
    expect(r1.headers()['x-frame-options']).toBe('DENY');
  });

  test('authenticated and error pages carry the policy too; static assets and the API are untouched', async ({ page, request }) => {
    await login(page, 'student.a001');
    const r = await page.request.get('/dashboard'); expect(r.headers()['content-security-policy']).toContain('script-src');
    const nf = await request.get('/no-such-page'); expect(nf.status()).toBe(404); expect(nf.headers()['content-security-policy']).toContain('script-src');
    expect((await request.get('/api/health')).headers()['content-security-policy']).toBeUndefined();   // API: JSON, own helmet policy
  });

  test('no policy violation while using login, student dashboard, schedule, exam player (both layouts), results, performance, MFA and staff pages', async ({ page, browser }) => {
    const violations = watchCsp(page);
    await page.goto('/login'); await expect(page.getByRole('heading', { name: /sign in/i }).first()).toBeVisible();
    await login(page, 'student.b008');                                                                  // a seeded candidate no other spec uses
    for (const p of ['/dashboard', '/schedule', '/results', '/performance', '/profile']) { await page.goto(p); await page.waitForLoadState('networkidle'); }
    await page.goto('/schedule'); await page.getByRole('link', { name: /Start|Resume/ }).click();
    await page.getByRole('button', { name: /begin|resume/i }).click(); await expect(page.getByRole('timer')).toBeVisible();
    await page.getByTestId('opt-A').click(); await expect(page.getByTestId('save-state')).toHaveText('✓ Saved');
    await page.getByTestId('layout-all').click(); await expect(page.getByTestId('all-questions')).toBeVisible();   // inline style attributes (palette, bars) render
    await page.getByRole('button', { name: /review & submit/i }).first().click(); await expect(page.getByRole('heading', { name: 'Review your answers' })).toBeVisible();
    await page.goto('/mfa'); await page.waitForLoadState('networkidle');
    await page.goto('/dashboard'); const logo = page.locator('img[src*="logo"]').first();                  // next/image → /_next/image?url=…logo.png
    await expect(logo).toBeVisible(); expect(await logo.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);

    for (const [who, pages] of [['admin.a', ['/dashboard', '/students', '/assignments']], ['examiner', ['/exams', '/questions']], ['cce', ['/dashboard', '/audit', '/incidents']]] as const) {
      const ctx = await browser.newContext(); const p = await ctx.newPage(); const v = watchCsp(p);
      await login(p, who); for (const u of pages) { await p.goto(u); await p.waitForLoadState('networkidle'); }
      violations.push(...v); await ctx.close();
    }
    expect(violations).toEqual([]);
  });

  test('the favicon is served (no 404) and the browser requests it without error', async ({ page, request }) => {
    for (const url of ['/favicon.ico', '/icon.png']) { const r = await request.get(url); expect(r.status(), url).toBe(200); expect(r.headers()['content-type']).toMatch(/image\//); }
    const bad: string[] = []; page.on('response', (r) => { if (r.status() === 404) bad.push(r.url()); });
    await page.goto('/login'); await page.waitForLoadState('networkidle');
    await login(page, 'student.a001'); await page.waitForLoadState('networkidle');
    expect(bad).toEqual([]);
    expect(await page.locator('link[rel~="icon"]').count()).toBeGreaterThan(0);
  });
});
