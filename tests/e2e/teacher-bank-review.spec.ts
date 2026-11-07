import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { email, PASSWORD } from './helpers';

/** Teacher portal step 4 in a browser: submit → read-only → returned with a comment → revise → history → resubmit → approved → exam-use warning. */
const BASE = 'http://localhost:3000'; const TEACHER = 'review.teacher@example.test'; const PW = 'Sturdy-Pass-2026!x';
type PWX = { request: { newContext: (o: object) => Promise<APIRequestContext> } };
const staff = async (playwright: PWX, local: string) => { const r = await playwright.request.newContext({ baseURL: BASE }); expect((await r.post('/api/auth/login', { data: { email: email(local), password: PASSWORD } })).ok()).toBe(true); return r; };
const axe = async (page: Page) => { const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze(); return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`); };

test('a bank goes through review and back, with the lock, the feedback, the history and the exam-use warning visible to the teacher', async ({ page, playwright }) => {
  const anon = await playwright.request.newContext({ baseURL: BASE }); const cat = await (await anon.get('/api/teacher-registration/catalog')).json(); const course = cat.courses.find((c: any) => c.code === 'MBBS-PATH-4'); const inst = cat.institutions.find((i: any) => i.code === 'DMC-A').id;
  const start = await anon.post('/api/teacher-registration', { data: { fullName: 'Dr Review Flow', email: TEACHER, password: PW, employeeId: 'RVW-0001', department: 'Pathology', designation: 'Lecturer', phone: '+92 300 1234567',
    assignments: [{ institutionId: inst, programId: cat.programs.find((p: any) => p.code === 'MBBS').id, semester: course.semester, term: '2026-SPRING', courseId: course.id }] } });
  expect((await anon.post('/api/teacher-registration/verify', { data: { email: TEACHER, code: (await start.json()).devCode } })).ok()).toBe(true);
  const admin = await staff(playwright, 'admin.a'); const userId = (await (await admin.get('/api/admin/teachers?search=RVW-0001')).json()).items[0].userId; const det = await (await admin.get(`/api/admin/teachers/${userId}`)).json();
  await admin.post(`/api/admin/teachers/${userId}/decision`, { data: { decision: 'APPROVE' } }); await admin.post(`/api/admin/teachers/assignments/${det.assignments[0].id}/decision`, { data: { decision: 'APPROVE' } });
  await page.goto('/login'); await page.getByLabel('University email').fill(TEACHER); await page.getByLabel('Password').fill(PW); await page.getByRole('button', { name: /sign in/i }).click(); await expect(page).toHaveURL(/\/dashboard/);

  const mcq = (n: number) => ({ stem: `Flow question ${n}: which organ produces insulin?`, options: ['Liver', 'Pancreas', 'Kidney', 'Spleen'], correctIndex: 1, difficulty: 'EASY', topic: 'Endocrine', marks: 1 });
  const aid = (await (await page.request.get('/api/teacher/assignments')).json())[0].id;
  const bankId = (await (await page.request.post('/api/teacher/pools', { data: { assignmentId: aid, name: 'Review flow bank' } })).json()).id as string;
  const q1 = (await (await page.request.post(`/api/teacher/pools/${bankId}/questions`, { data: mcq(1) })).json()).id as string; await page.request.post(`/api/teacher/pools/${bankId}/questions`, { data: mcq(2) });

  // draft → submit from the page → read-only
  await page.goto('/pools'); await expect(page.getByTestId('pool-list')).toContainText('Draft');
  await page.getByRole('button', { name: 'Review flow bank' }).click(); await expect(page.getByRole('heading', { name: 'Review flow bank' })).toBeVisible();
  await page.getByRole('button', { name: /Submit question bank for review/ }).click(); await page.getByRole('dialog').getByRole('button', { name: 'Submit for review' }).click();
  await expect(page.getByTestId('bank-banner')).toContainText('Under review — read only');
  await expect(page.getByRole('button', { name: '+ Add MCQ' })).toBeDisabled(); await expect(page.getByRole('button', { name: 'Import from CSV or Excel' })).toBeDisabled();
  const rows = page.getByTestId('question-list').locator('tbody tr'); await expect(rows).toHaveCount(2);
  for (const name of ['Edit', 'Duplicate', 'Delete']) await expect(rows.first().getByRole('button', { name })).toBeDisabled();
  await expect(rows.first().getByRole('button', { name: 'History' })).toBeEnabled();
  expect(await axe(page)).toEqual([]);

  // the examiner returns it with a comment
  const ex = await staff(playwright, 'examiner'); const queue = await (await ex.get('/api/question-banks?status=SUBMITTED')).json(); expect(queue.items.map((b: any) => b.id)).toContain(bankId);
  expect((await ex.post(`/api/question-banks/${bankId}/review`, { data: { decision: 'REJECT', note: 'Option C is also defensible; tighten the stem' } })).ok()).toBe(true);
  await page.reload(); await expect(page.getByTestId('bank-banner')).toContainText('Returned for changes'); await expect(page.getByTestId('bank-banner')).toContainText('Option C is also defensible');
  await expect(page.getByTestId('question-list')).toContainText('Reviewer: Option C is also defensible');
  await expect(page.getByRole('button', { name: '+ Add MCQ' })).toBeEnabled();
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Question Submissions' }).click(); await expect(page.getByTestId('submission-list')).toContainText('Option C is also defensible');

  // revise the first question, see its history, submit again
  await page.goto(`/pools?pool=${bankId}`); const first = page.getByTestId('question-list').locator('tbody tr', { hasText: 'Flow question 1' });
  await first.getByRole('button', { name: 'Edit' }).click(); await page.getByRole('dialog').getByLabel('Question statement').fill('Flow question 1 (tightened): which organ secretes insulin?'); await page.getByRole('dialog').getByRole('button', { name: 'Save draft' }).click();
  await first.getByRole('button', { name: 'History' }).click(); const hist = page.getByTestId('version-history');
  await expect(hist.getByTestId('version-2')).toContainText('Version 2 (current)'); await expect(hist.getByTestId('version-2')).toContainText('Changed: statement'); await expect(hist.getByTestId('version-1')).toContainText('First saved version');
  await hist.getByTestId('version-1').getByText('Show this version').click(); await expect(hist.getByTestId('version-1')).toContainText('Flow question 1: which organ produces insulin?');
  expect(await axe(page)).toEqual([]); await page.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: /Submit question bank for review/ }).click(); await page.getByRole('dialog').getByRole('button', { name: 'Submit for review' }).click(); await expect(page.getByTestId('bank-banner')).toContainText('Under review');

  // approved
  expect((await ex.post(`/api/question-banks/${bankId}/review`, { data: { decision: 'APPROVE', note: 'Thank you' } })).ok()).toBe(true);
  await page.reload(); await expect(page.getByTestId('bank-banner')).toContainText('Approved'); await expect(page.getByTestId('bank-banner')).toContainText('Thank you');
  await page.goto('/pools'); await expect(page.getByTestId('pool-list')).toContainText('Approved');

  // an examination freezes the approved question; the teacher is warned before editing and the history marks the frozen version
  const cce = await staff(playwright, 'cce');
  const exam = await (await ex.post('/api/exams', { data: { code: `RVW-${Date.now() % 100000}`, title: 'Review flow exam', courseId: course.id, term: '2026-SPRING', opensAt: new Date(Date.now() + 86_400_000).toISOString(), closesAt: new Date(Date.now() + 2 * 86_400_000).toISOString(), durationMin: 30, institutionIds: [inst] } })).json();
  expect((await ex.put(`/api/exams/${exam.id}/paper`, { data: { items: [{ questionId: q1, marks: 1 }] } })).ok()).toBe(true); expect((await ex.post(`/api/exams/${exam.id}/paper/submit`, { data: {} })).ok()).toBe(true);
  expect((await cce.post(`/api/exams/${exam.id}/paper/review`, { data: { decision: 'APPROVE', note: 'ok' } })).ok()).toBe(true);
  await page.goto(`/pools?pool=${bankId}`); const row1 = page.getByTestId('question-list').locator('tbody tr', { hasText: 'tightened' });
  await row1.getByRole('button', { name: 'Edit' }).click(); await expect(page.getByTestId('used-in-exams')).toContainText('used in 1 examination'); await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await row1.getByRole('button', { name: 'History' }).click(); await expect(page.getByTestId('version-history').getByTestId('version-2')).toContainText('Used in 1 examination'); await expect(page.getByTestId('version-history').getByTestId('version-1')).not.toContainText('Used in');
});
