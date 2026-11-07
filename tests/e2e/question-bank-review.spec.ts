import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { email, login, PASSWORD } from './helpers';

/** Teacher portal step 5: the examiner's queue and review screen, decisions, administrators' teacher activity history, and who may not see any of it. */
test.describe.configure({ mode: 'serial' });
const BASE = 'http://localhost:3000'; const TEACHER = 'bank.reviewer.teacher@example.test'; const PW = 'Sturdy-Pass-2026!x';
type PWX = { request: { newContext: (o: object) => Promise<APIRequestContext> } };
const staff = async (playwright: PWX, local: string) => { const r = await playwright.request.newContext({ baseURL: BASE }); expect((await r.post('/api/auth/login', { data: { email: email(local), password: PASSWORD } })).ok()).toBe(true); return r; };
const axe = async (page: Page) => { const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze(); return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`); };
let bankId = ''; let teacherId = '';

test('setup: an approved teacher submits a three-question bank', async ({ playwright }) => {
  const anon = await playwright.request.newContext({ baseURL: BASE }); const cat = await (await anon.get('/api/teacher-registration/catalog')).json(); const course = cat.courses.find((c: any) => c.code === 'MBBS-PATH-4');
  const start = await anon.post('/api/teacher-registration', { data: { fullName: 'Dr Bank Reviewer Subject', email: TEACHER, password: PW, employeeId: 'BRS-0001', department: 'Pathology', designation: 'Assistant Professor', phone: '+92 300 1234567',
    assignments: [{ institutionId: cat.institutions.find((i: any) => i.code === 'DMC-A').id, programId: cat.programs.find((p: any) => p.code === 'MBBS').id, semester: course.semester, term: '2026-SPRING', courseId: course.id }] } });
  expect((await anon.post('/api/teacher-registration/verify', { data: { email: TEACHER, code: (await start.json()).devCode } })).ok()).toBe(true);
  const admin = await staff(playwright, 'admin.a'); teacherId = (await (await admin.get('/api/admin/teachers?search=BRS-0001')).json()).items[0].userId; const det = await (await admin.get(`/api/admin/teachers/${teacherId}`)).json();
  await admin.post(`/api/admin/teachers/${teacherId}/decision`, { data: { decision: 'APPROVE' } }); await admin.post(`/api/admin/teachers/assignments/${det.assignments[0].id}/decision`, { data: { decision: 'APPROVE' } });
  const t = await playwright.request.newContext({ baseURL: BASE }); expect((await t.post('/api/auth/login', { data: { email: TEACHER, password: PW } })).ok()).toBe(true);
  const aid = (await (await t.get('/api/teacher/assignments')).json())[0].id; bankId = (await (await t.post('/api/teacher/pools', { data: { assignmentId: aid, name: 'Pathology week 3' } })).json()).id;
  for (const n of [1, 2, 3]) await t.post(`/api/teacher/pools/${bankId}/questions`, { data: { stem: `Reviewer screen question ${n}: which organ produces insulin?`, options: ['Liver', 'Pancreas', 'Kidney', 'Spleen'], correctIndex: 1, difficulty: 'EASY', topic: 'Endocrine', subtopic: 'Islets', bloom: 'REMEMBER', marks: 1 } });
  expect((await t.post(`/api/teacher/pools/${bankId}/submit`, { data: {} })).ok()).toBe(true);
});

test('the examiner finds the bank from the dashboard and the menu, sees answer keys, and returns two questions with comments', async ({ page }) => {
  await login(page, 'examiner');
  await expect(page.getByTestId('attention-list')).toContainText('waiting for your review');
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Teacher Question Banks' }).click();
  await expect(page.getByRole('heading', { name: 'Teacher Question Banks' })).toBeVisible(); const queue = page.getByTestId('bank-queue'); await expect(queue).toContainText('Pathology week 3'); await expect(queue).toContainText('Dr Bank Reviewer Subject'); await expect(queue).toContainText('3 waiting');
  expect(await axe(page)).toEqual([]);
  await page.getByLabel('Search').fill('zzzz'); await expect(page.getByText(/No question banks match/i).or(page.getByText(/no .*question banks/i)).first()).toBeVisible(); await page.getByLabel('Search').fill('Bank Reviewer');
  await queue.getByRole('button', { name: 'Review Pathology week 3' }).click();
  await expect(page.getByTestId('bank-info')).toContainText('Dr Bank Reviewer Subject'); await expect(page.getByTestId('bank-info')).toContainText('BRS-0001'); await expect(page.getByTestId('bank-info')).toContainText('Under review');
  const cards = page.getByTestId('review-question'); await expect(cards).toHaveCount(3); await expect(cards.first()).toContainText('correct answer'); await expect(cards.first().locator('li.correct')).toContainText('Pancreas');
  await expect(cards.first()).toContainText('Islets'); await expect(cards.first()).toContainText('Bloom: Remember');
  // decisions: nothing saved until every question is decided; a returned question needs a comment
  const save = page.getByRole('button', { name: 'Save decisions' }); await expect(save).toBeDisabled(); await expect(page.getByTestId('decision-progress')).toContainText('0 of 3');
  await cards.nth(0).getByLabel('Approve').check(); await cards.nth(1).getByLabel('Return for changes').check(); await cards.nth(2).getByLabel('Return for changes').check();
  await expect(save).toBeDisabled(); await expect(page.getByTestId('decision-progress')).toContainText('2 returned questions need a comment');
  await cards.nth(1).getByLabel(/Comment for the teacher on question 2/).fill('The stem does not say which hormone.'); await expect(save).toBeDisabled();
  await page.getByLabel('Comment for the teacher about the whole bank (optional)').fill('Two questions need work.');                       // covers question 3
  await expect(save).toBeEnabled(); expect(await axe(page)).toEqual([]);
  await save.click();
  await expect(page.getByTestId('review-closed')).toContainText('returned to the teacher'); await expect(page.getByTestId('bank-feedback')).toContainText('Two questions need work.');
  await expect(cards.nth(1)).toContainText('The stem does not say which hormone.'); await expect(cards.nth(0)).toContainText('Approved');
  await page.getByTestId('bank-activity').locator('summary').click(); await expect(page.getByTestId('bank-activity')).toContainText('Reviewed a question bank');
});

test('after the teacher resubmits only the returned questions, the examiner approves the bank in one step', async ({ page, playwright }) => {
  const t = await playwright.request.newContext({ baseURL: BASE }); await t.post('/api/auth/login', { data: { email: TEACHER, password: PW } });
  const pool = (await (await t.get('/api/teacher/pools')).json()).find((p: any) => p.id === bankId); expect(pool).toMatchObject({ status: 'REJECTED' });
  const qs = (await (await t.get(`/api/teacher/questions?poolId=${bankId}&status=REJECTED`)).json()).items; expect(qs).toHaveLength(2);
  for (const q of qs) expect((await t.put(`/api/teacher/questions/${q.id}`, { data: { stem: `${q.stem} (revised)`, options: q.options.map((o: any) => o.text), correctIndex: 1, difficulty: 'EASY', topic: 'Endocrine', marks: 1 } })).ok()).toBe(true);
  expect((await (await t.post(`/api/teacher/pools/${bankId}/submit`, { data: {} })).json()).submitted).toBe(2);
  await login(page, 'cce'); await page.goto('/question-banks'); await expect(page.getByTestId('bank-queue')).toContainText('2 waiting'); await page.getByRole('button', { name: 'Review Pathology week 3' }).click();
  await expect(page.getByTestId('review-question')).toHaveCount(3); await expect(page.getByTestId('decision-progress')).toContainText('0 of 2');
  await page.getByRole('button', { name: 'Approve all 2' }).click(); await page.getByRole('dialog').getByRole('button', { name: 'Approve all' }).click();
  await expect(page.getByTestId('review-closed')).toContainText('approved'); await expect(page.getByRole('button', { name: 'Save decisions' })).toHaveCount(0);
  await page.goto('/question-banks?status=APPROVED'); await expect(page.getByTestId('bank-queue')).toContainText('Pathology week 3');
});

test('a campus administrator sees the teacher’s activity history, including the reviewers’ decisions', async ({ page }) => {
  await login(page, 'admin.a'); await page.goto('/teachers?tab=directory'); await page.getByLabel('Search').fill('BRS-0001');
  await page.getByRole('button', { name: 'Dr Bank Reviewer Subject' }).click(); const d = page.getByTestId('teacher-detail');
  await d.getByRole('button', { name: 'View activity history' }).click(); const act = page.getByTestId('teacher-activity');
  await expect(act).toContainText('Question banks: 1'); await expect(act).toContainText('3 approved'); await expect(act).toContainText('Reviewed a question bank'); await expect(act).toContainText('Created a question bank'); await expect(act).toContainText('Two questions need work.');
  await expect(act).not.toContainText('Pancreas');                                                                                           // no answer keys in the activity view
  expect(await axe(page)).toEqual([]);
});

test('teachers, lecturers, campus administrators and students cannot open the review screens; the menu hides them', async ({ page }) => {
  for (const who of ['lecturer.a', 'admin.a', 'student.a001']) {
    await login(page, who); await page.goto('/question-banks'); await expect(page.getByRole('heading', { name: /do not have access to Teacher Question Banks/ }), who).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Teacher Question Banks' }), who).toHaveCount(0);
    await page.context().clearCookies();
  }
  const r = await page.request.get(`/api/question-banks/${bankId}`); expect([401, 403]).toContain(r.status());
});

test('the queue and the review screen are usable on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await login(page, 'examiner'); await page.goto('/question-banks?status=APPROVED');
  const row = page.getByTestId('bank-queue').locator('tbody tr').first(); await expect(row).toBeVisible(); await expect(row.locator('td[data-label="Campus"]')).toBeHidden(); await row.getByRole('button', { name: /^Show details/ }).click(); await expect(row.locator('td[data-label="Campus"]')).toBeVisible();
  await row.getByRole('button', { name: /^Open / }).click(); await expect(page.getByTestId('bank-info')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true); expect(await axe(page)).toEqual([]);
});
