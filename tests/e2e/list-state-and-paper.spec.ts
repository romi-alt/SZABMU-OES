import { expect, test, type APIRequestContext } from '@playwright/test';
import { PASSWORD, email, login } from './helpers';

/** UI-028 list state in the URL + empty-state echo; UI-027 paper builder (search/filter, bulk select, marks, order, totals, unsaved changes). */
const BASE = 'http://localhost:3000';
const letters = (n: number) => Array.from({ length: n }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join('');
async function apiAs(playwright: { request: { newContext: (o: object) => Promise<APIRequestContext> } }, local: string) {
  const r = await playwright.request.newContext({ baseURL: BASE }); const res = await r.post('/api/auth/login', { data: { email: email(local), password: PASSWORD } }); expect(res.ok()).toBe(true); return r;
}

test.describe('list state lives in the address bar (UI-028)', () => {
  test('search survives opening another page and pressing Back, a reload, and a pasted link; the empty state echoes the search and clears it', async ({ page }) => {
    await login(page, 'admin.a'); await page.goto('/students');
    await expect(page.locator('tbody tr').first()).toBeVisible(); const all = await page.locator('tbody tr').count();
    await page.getByLabel('Search').fill('Hira'); await expect(page).toHaveURL(/search=Hira/); await expect.poll(() => page.locator('tbody tr').count()).toBeLessThan(all);
    const filtered = await page.locator('tbody tr').count();
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Enrolment & eligibility' }).click(); await expect(page).toHaveURL(/\/enrolment/);
    await page.goBack(); await expect(page).toHaveURL(/search=Hira/); await expect(page.getByLabel('Search')).toHaveValue('Hira'); await expect.poll(() => page.locator('tbody tr').count()).toBe(filtered);
    await page.reload(); await expect(page.getByLabel('Search')).toHaveValue('Hira'); await expect.poll(() => page.locator('tbody tr').count()).toBe(filtered);
    await page.getByLabel('Search').fill('zzzqq'); const empty = page.getByTestId('list-empty'); await expect(empty).toContainText('No students match “zzzqq”');
    await empty.getByRole('button', { name: 'Clear filters' }).click(); await expect(page.getByLabel('Search')).toHaveValue(''); await expect(page).not.toHaveURL(/search=/); await expect.poll(() => page.locator('tbody tr').count()).toBe(all);
  });
  test('filters and page are in the URL for accounts and the audit trail too', async ({ page }) => {
    await login(page, 'super.admin'); await page.goto('/users?role=LECTURER'); await expect(page.getByLabel('Role')).toHaveValue('LECTURER');
    await expect(page.locator('tbody tr td:nth-child(3)').first()).toHaveText('Lecturer');
    await page.goto('/audit?action=auth.login'); await expect(page.getByLabel('Action starts with')).toHaveValue('auth.login');
  });
});

test('enrolment course/term and the monitor candidate search are kept in the URL', async ({ page }) => {
  await login(page, 'admin.a'); await page.goto('/enrolment'); await expect(page.getByLabel('Course')).toBeVisible();
  await page.getByLabel('Course').selectOption({ label: 'MBBS-PATH-4 — Pathology' }); await expect(page).toHaveURL(/course=/);
  const chosen = new URL(page.url()).searchParams.get('course')!; expect(chosen.length).toBeGreaterThan(10);
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Students' }).click(); await expect(page).toHaveURL(/\/students/); await page.goBack();
  await expect(page).toHaveURL(/\/enrolment\?.*course=/); await expect(page.getByLabel('Course')).toHaveValue(chosen, { timeout: 15_000 }); await expect(page.locator('tbody tr').first()).toBeVisible();
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Live monitor' }).click(); await page.getByRole('link', { name: /Monitor/ }).first().click();
  await expect(page.locator('tbody tr').first()).toBeVisible(); await page.getByLabel('Find candidate').fill('zzzqq'); await expect(page).toHaveURL(/q=zzzqq/);
  await expect(page.getByTestId('list-empty')).toContainText('No candidates match “zzzqq”'); await page.reload(); await expect(page.getByLabel('Find candidate')).toHaveValue('zzzqq');
});

test.describe.serial('paper builder (UI-027)', () => {
  let examId = '';
  test.afterAll(async ({ playwright }) => { if (!examId) return; const cce = await apiAs(playwright, 'cce'); await cce.post(`/api/exams/${examId}/cancel`, { data: {} }).catch(() => undefined); await cce.dispose(); });

  test('search, filter, add everything shown, set marks for all, reorder, see totals, and Save', async ({ page, playwright }) => {
    const ex = await apiAs(playwright, 'examiner');
    const courses = await (await ex.get('/api/courses')).json(); const course = (Array.isArray(courses) ? courses : courses.items).find((c: { code: string }) => c.code === 'MBBS-PATH-4');
    const insts = await (await ex.get('/api/institutions')).json(); const ids = (Array.isArray(insts) ? insts : insts.items).filter((i: { code: string }) => i.code === 'DMC-A').map((i: { id: string }) => i.id);
    const made = await ex.post('/api/exams', { data: { code: `PB-${letters(6)}`, title: `Paper builder drill ${letters(5)}`, courseId: course.id, term: '2026-SPRING', opensAt: new Date(Date.now() + 3600e3).toISOString(), closesAt: new Date(Date.now() + 86400e3).toISOString(), durationMin: 30, passPercent: 50, negativeMarking: 0, shuffleQuestions: false, institutionIds: ids } });
    expect(made.ok(), await made.text()).toBe(true); examId = (await made.json()).id; await ex.dispose();

    await login(page, 'examiner'); await page.goto(`/exams/${examId}`);
    await expect(page.getByText(/Question paper \(0 questions · 0 marks\)/)).toBeVisible();
    const count = page.getByTestId('bank-count'); await expect(count).toContainText(/Showing \d+/);
    const shown = async () => Number((await count.innerText()).match(/Showing (\d+)/)?.[1] ?? NaN);
    await expect.poll(shown).toBeGreaterThan(3); const total = await shown();

    await page.getByLabel('Difficulty').selectOption('EASY'); await expect.poll(shown).toBeLessThan(total);
    const easy = await shown();
    await page.getByTestId('select-matching').click(); await expect(page.getByText(new RegExp(`Question paper \\(${easy} questions · ${easy} marks\\)`))).toBeVisible();
    await expect(page.getByTestId('paper-unsaved')).toBeVisible(); await expect(page.getByTestId('paper-summary')).toContainText(`Easy ${easy}`);
    await page.getByLabel('Search').fill('zzzqq'); await expect(page.getByTestId('list-empty')).toContainText('No approved questions match “zzzqq”');
    await page.getByTestId('list-empty').getByRole('button', { name: 'Clear filters' }).click(); await expect(page.getByLabel('Search')).toHaveValue('');

    await page.getByTestId('tab-paper').click(); const list = page.getByTestId('paper-list'); await expect(list.locator('li')).toHaveCount(easy);
    await page.getByLabel('Marks for every question').fill('2'); await page.getByRole('button', { name: new RegExp(`Apply to all ${easy}`) }).click(); await expect(page.getByText(new RegExp(`${easy} questions · ${easy * 2} marks`))).toBeVisible();
    const first = await list.locator('li').nth(0).locator('.paper-stem').innerText(); const second = await list.locator('li').nth(1).locator('.paper-stem').innerText();
    await page.getByRole('button', { name: 'Move question 1 down' }).click(); await expect(list.locator('li').nth(0).locator('.paper-stem')).toHaveText(second); await expect(list.locator('li').nth(1).locator('.paper-stem')).toHaveText(first);
    await page.getByRole('button', { name: 'Remove question 3' }).click(); await expect(page.getByText(new RegExp(`${easy - 1} questions`))).toBeVisible();
    await expect(page.getByRole('button', { name: 'Submit for approval' })).toBeDisabled();                       // must save first

    await page.getByRole('button', { name: 'Save paper' }).click(); await expect(page.getByText('Paper saved')).toBeVisible(); await expect(page.getByTestId('paper-unsaved')).toHaveCount(0);
    await page.reload(); await page.getByTestId('tab-paper').click(); await expect(page.getByTestId('paper-list').locator('li')).toHaveCount(easy - 1);
    await expect(page.getByTestId('paper-list').locator('li').nth(0).locator('.paper-stem')).toHaveText(second);   // order persisted
    await expect(page.getByRole('button', { name: 'Submit for approval' })).toBeEnabled();
  });
});
