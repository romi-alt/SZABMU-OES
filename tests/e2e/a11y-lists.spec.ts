import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { login } from './helpers';

/** Audit A-07: list pages with many small controls (question bank, exams, audit trail) — WCAG 2.2 AA incl. target-size. */
for (const [who, path, heading] of [['examiner', '/questions', 'Question bank'], ['cce', '/exams', 'Examinations'], ['super.admin', '/audit', /Audit/]] as const) {
  test(`axe: ${path}`, async ({ page }, ti) => {
    await login(page, who); await page.goto(path); await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible();
    await expect(page.locator('tbody tr').first()).toBeVisible();
    const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    if (violations.length) await ti.attach('axe.json', { body: JSON.stringify(violations, null, 2), contentType: 'application/json' });
    expect(violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.length} nodes — ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
  });
}
