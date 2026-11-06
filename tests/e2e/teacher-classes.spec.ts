import { expect, test, type APIRequestContext } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { email, PASSWORD } from './helpers';

/** Phase 7: My Classes & Subjects shows subject, class, session, campus, status, students, MCQs and banks, and opens the right question banks. */
const BASE = 'http://localhost:3000'; const TEACHER = 'classes.teacher@example.test'; const PW = 'Sturdy-Pass-2026!x';
type PWX = { request: { newContext: (o: object) => Promise<APIRequestContext> } };
const staff = async (playwright: PWX, local: string) => { const r = await playwright.request.newContext({ baseURL: BASE }); expect((await r.post('/api/auth/login', { data: { email: email(local), password: PASSWORD } })).ok()).toBe(true); return r; };

test('approved assignments show real counts and open their own question banks', async ({ page, playwright }) => {
  const anon = await playwright.request.newContext({ baseURL: BASE }); const cat = await (await anon.get('/api/teacher-registration/catalog')).json();
  const inst = cat.institutions.find((i: any) => i.code === 'DMC-A').id; const prog = cat.programs.find((p: any) => p.code === 'MBBS').id;
  const path = cat.courses.find((c: any) => c.code === 'MBBS-PATH-4'); const pharm = cat.courses.find((c: any) => c.code === 'MBBS-PHARM-4');
  const start = await anon.post('/api/teacher-registration', { data: { fullName: 'Dr Classes Check', email: TEACHER, password: PW, employeeId: 'CLS-0001', department: 'Pathology', designation: 'Lecturer', phone: '+92 300 1234567',
    assignments: [path, pharm].map((c) => ({ institutionId: inst, programId: prog, semester: c.semester, term: '2026-SPRING', courseId: c.id })) } });
  expect((await anon.post('/api/teacher-registration/verify', { data: { email: TEACHER, code: (await start.json()).devCode } })).ok()).toBe(true);
  const admin = await staff(playwright, 'admin.a'); const userId = (await (await admin.get('/api/admin/teachers?search=CLS-0001')).json()).items[0].userId; const det = await (await admin.get(`/api/admin/teachers/${userId}`)).json();
  await admin.post(`/api/admin/teachers/${userId}/decision`, { data: { decision: 'APPROVE' } });
  for (const a of det.assignments) await admin.post(`/api/admin/teachers/assignments/${a.id}/decision`, { data: { decision: 'APPROVE' } });

  await page.goto('/login'); await page.getByLabel('University email').fill(TEACHER); await page.getByLabel('Password').fill(PW); await page.getByRole('button', { name: /sign in/i }).click(); await expect(page).toHaveURL(/\/dashboard/);
  const mine = await (await page.request.get('/api/teacher/assignments')).json(); const pathA = mine.find((a: any) => a.course.code === 'MBBS-PATH-4'); const pharmA = mine.find((a: any) => a.course.code === 'MBBS-PHARM-4');
  const mk = async (aid: string, name: string, n: number) => { const id = (await (await page.request.post('/api/teacher/pools', { data: { assignmentId: aid, name } })).json()).id; for (let i = 0; i < n; i++) await page.request.post(`/api/teacher/pools/${id}/questions`, { data: { stem: `${name} question ${i + 1}: which organ produces insulin?`, options: ['Liver', 'Pancreas', 'Kidney', 'Spleen'], correctIndex: 1, difficulty: 'EASY', marks: 1 } }); };
  await mk(pathA.id, 'Pathology bank', 3); await mk(pharmA.id, 'Pharmacology bank', 1);

  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'My Classes & Subjects' }).click();
  const tbl = page.getByTestId('approved-assignments'); await expect(tbl.locator('tbody tr')).toHaveCount(2);
  const row = tbl.locator('tbody tr', { hasText: 'MBBS-PATH-4' });
  await expect(row).toContainText('MBBS · Semester 4'); await expect(row).toContainText('2026-SPRING'); await expect(row).toContainText('Demo Medical College A'); await expect(row).toContainText('Approved');
  await expect(row.locator('td[data-label="MCQs"]')).toHaveText('3'); await expect(row.locator('td[data-label="Question banks"]')).toContainText('1'); await expect(tbl.locator('tbody tr', { hasText: 'MBBS-PHARM-4' }).locator('td[data-label="MCQs"]')).toHaveText('1');
  await expect(row.locator('td[data-label="Students"]')).toHaveText(/^\d+$/);
  const ax = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze(); expect(ax.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ') + ' ' + n.html.slice(0, 140)).join(' | ')}`)).toEqual([]);

  await row.getByRole('link', { name: /Open question banks for/ }).click();
  await expect(page.getByTestId('pool-scope')).toContainText('MBBS-PATH-4'); const list = page.getByTestId('pool-list'); await expect(list).toContainText('Pathology bank'); await expect(list).not.toContainText('Pharmacology bank');
  await page.getByRole('button', { name: 'Show all my question banks' }).click(); await expect(list).toContainText('Pharmacology bank'); await expect(page.getByTestId('pool-scope')).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/classes');
  const pr = page.getByTestId('approved-assignments').locator('tbody tr').first(); await expect(pr.locator('td[data-label="Campus"]')).toBeHidden(); await pr.getByRole('button', { name: /^Show details/ }).click(); await expect(pr.locator('td[data-label="Campus"]')).toBeVisible();
});
