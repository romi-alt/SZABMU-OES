import { expect, test, type APIRequestContext } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { email, PASSWORD } from './helpers';

/** Teacher portal step 1: six-item sidebar, Overview figures and recent activity from real data, Question Submissions with reviewer feedback. */
const BASE = 'http://localhost:3000'; const TEACHER = 'overview.teacher@example.test'; const PW = 'Sturdy-Pass-2026!x';
type PW = { request: { newContext: (o: object) => Promise<APIRequestContext> } };
const staff = async (playwright: PW, local: string) => { const r = await playwright.request.newContext({ baseURL: BASE }); expect((await r.post('/api/auth/login', { data: { email: email(local), password: PASSWORD } })).ok()).toBe(true); return r; };

test('sidebar, overview figures, recent activity and reviewer feedback are real and consistent', async ({ page, playwright }) => {
  // an approved teacher with one approved subject
  const anon = await playwright.request.newContext({ baseURL: BASE }); const cat = await (await anon.get('/api/teacher-registration/catalog')).json();
  const course = cat.courses.find((c: any) => c.code === 'MBBS-PATH-4');
  const start = await anon.post('/api/teacher-registration', { data: { fullName: 'Dr Overview Check', email: TEACHER, password: PW, employeeId: 'OVW-0001', department: 'Pathology', designation: 'Lecturer', phone: '+92 300 1234567',
    assignments: [{ institutionId: cat.institutions.find((i: any) => i.code === 'DMC-A').id, programId: cat.programs.find((p: any) => p.code === 'MBBS').id, semester: course.semester, term: '2026-SPRING', courseId: course.id }] } });
  expect((await anon.post('/api/teacher-registration/verify', { data: { email: TEACHER, code: (await start.json()).devCode } })).ok()).toBe(true);
  const admin = await staff(playwright, 'admin.a'); const userId = (await (await admin.get('/api/admin/teachers?search=OVW-0001')).json()).items[0].userId;
  const det = await (await admin.get(`/api/admin/teachers/${userId}`)).json();
  await admin.post(`/api/admin/teachers/${userId}/decision`, { data: { decision: 'APPROVE' } }); await admin.post(`/api/admin/teachers/assignments/${det.assignments[0].id}/decision`, { data: { decision: 'APPROVE' } });

  await page.goto('/login'); await page.getByLabel('University email').fill(TEACHER); await page.getByLabel('Password').fill(PW); await page.getByRole('button', { name: /sign in/i }).click();
  const nav = page.getByRole('navigation', { name: 'Primary' });
  await expect(nav.getByRole('link')).toHaveText(['Overview', 'My Classes & Subjects', 'MCQ Question Banks', 'My Students', 'Question Submissions', 'My Profile']);
  await expect(page.getByText(/Examination Results|Student Marks|Grades|Performance/)).toHaveCount(0);

  const kpi = (name: string) => page.getByTestId('teacher-kpis').locator('div', { has: page.getByText(name, { exact: true }) }).locator('dd');
  await expect(kpi('Approved subjects')).toHaveText('1'); await expect(kpi('Total MCQs')).toHaveText('0'); await expect(kpi('Draft questions')).toHaveText('0');
  await expect(page.getByTestId('teacher-recent-empty')).toBeVisible();

  // real data: a bank with two questions, submitted; the examiner approves one and returns the other with a comment
  const mcq = (n: number) => ({ stem: `Overview check ${n}: which organ produces insulin?`, options: ['Liver', 'Pancreas', 'Kidney', 'Spleen'], correctIndex: 1, difficulty: 'EASY', topic: 'Endocrine', marks: 1 });
  const aid = (await (await page.request.get('/api/teacher/assignments')).json())[0].id;
  const pool = (await (await page.request.post('/api/teacher/pools', { data: { assignmentId: aid, name: 'Endocrine bank' } })).json()).id;
  const q1 = (await (await page.request.post(`/api/teacher/pools/${pool}/questions`, { data: mcq(1) })).json()).id; const q2 = (await (await page.request.post(`/api/teacher/pools/${pool}/questions`, { data: mcq(2) })).json()).id;
  expect((await page.request.post(`/api/teacher/pools/${pool}/submit`, { data: {} })).ok()).toBe(true);
  const ex = await staff(playwright, 'examiner');
  expect((await ex.post(`/api/questions/${q1}/review`, { data: { decision: 'APPROVE' } })).ok()).toBe(true);
  expect((await ex.post(`/api/questions/${q2}/review`, { data: { decision: 'REJECT', note: 'Option C is also defensible' } })).ok()).toBe(true);

  await page.goto('/dashboard');
  await expect(kpi('Total MCQs')).toHaveText('2'); await expect(kpi('Returned banks')).toHaveText('1'); await expect(kpi('Banks under review')).toHaveText('0'); await expect(kpi('Approved banks')).toHaveText('0');
  const recent = page.getByTestId('teacher-recent'); await expect(recent).toContainText('Endocrine bank'); await expect(recent).toContainText('1 question approved'); await expect(recent).toContainText('1 question returned for changes');
  const dash = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(dash.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);

  await nav.getByRole('link', { name: 'Question Submissions' }).click();
  await expect(page.getByRole('heading', { name: 'Question Submissions' })).toBeVisible();
  const counts = page.getByTestId('submission-counts'); await expect(counts.locator('div', { hasText: 'Approved' }).locator('dd')).toHaveText('1'); await expect(counts.locator('div', { hasText: 'Returned for changes' }).locator('dd')).toHaveText('1');
  await expect(page.getByTestId('submission-list').locator('tbody tr')).toHaveCount(2); await expect(page.getByTestId('submission-list')).toContainText('Option C is also defensible');
  await page.getByRole('combobox', { name: 'Filter by state' }).selectOption('REJECTED'); await expect(page.getByTestId('submission-list').locator('tbody tr')).toHaveCount(1);
  const sub = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(sub.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);

  // phone: compact rows with details on demand
  await page.setViewportSize({ width: 390, height: 844 }); await page.reload();
  const row = page.getByTestId('submission-list').locator('tbody tr').first(); await expect(row.locator('td[data-label="Subject"]')).toBeHidden();
  await row.getByRole('button', { name: /^Show details/ }).click(); await expect(row.locator('td[data-label="Subject"]')).toBeVisible();
});
