import { expect, test, type APIRequestContext } from '@playwright/test';
import { email, PASSWORD } from './helpers';

/**
 * Teacher approval, two separate decisions: the account and each class-subject. An approved subject on a not-yet-approved account must say so
 * (not look usable), and when the account is approved the workspace and its menu appear without signing out.
 */
const BASE = 'http://localhost:3000';
const TEACHER = 'live.teacher@example.test'; const PW = 'Sturdy-Pass-2026!x';
async function admin(playwright: { request: { newContext: (o: object) => Promise<APIRequestContext> } }) {
  const r = await playwright.request.newContext({ baseURL: BASE }); const res = await r.post('/api/auth/login', { data: { email: email('admin.a'), password: PASSWORD } });
  expect(res.ok()).toBe(true); return r;
}

test('a subject approved before the account says it waits for the account; approving the account opens the workspace without signing out', async ({ page, playwright }) => {
  const anon = await playwright.request.newContext({ baseURL: BASE });
  const cat = await (await anon.get('/api/teacher-registration/catalog')).json();
  const inst = cat.institutions.find((i: any) => i.code === 'DMC-A').id; const prog = cat.programs.find((p: any) => p.code === 'MBBS').id;
  const course = cat.courses.find((c: any) => c.code === 'MBBS-PATH-4');
  const start = await anon.post('/api/teacher-registration', { data: { fullName: 'Dr Live Approval', email: TEACHER, password: PW, employeeId: 'LIVE-0001', department: 'Pathology', designation: 'Lecturer', phone: '+92 300 1234567',
    assignments: [{ institutionId: inst, programId: prog, semester: course.semester, term: '2026-SPRING', courseId: course.id }] } });
  expect(start.ok(), await start.text()).toBe(true);
  expect((await anon.post('/api/teacher-registration/verify', { data: { email: TEACHER, code: (await start.json()).devCode } })).ok()).toBe(true);

  // the administrator approves the SUBJECT first
  const a = await admin(playwright); const list = await (await a.get('/api/admin/teachers?search=LIVE-0001')).json(); const userId = list.items[0].userId;
  const detail = await (await a.get(`/api/admin/teachers/${userId}`)).json();
  expect((await a.post(`/api/admin/teachers/assignments/${detail.assignments[0].id}/decision`, { data: { decision: 'APPROVE' } })).ok()).toBe(true);

  await page.goto('/login'); await page.getByLabel('University email').fill(TEACHER); await page.getByLabel('Password').fill(PW); await page.getByRole('button', { name: /sign in/i }).click();
  const box = page.getByTestId('teacher-approval');
  await expect(box).toContainText('Your registration is awaiting approval');
  await expect(box).toContainText('Approved — starts when your account is approved');                       // not a bare "approved" badge
  await expect(page.getByRole('link', { name: 'My Classes & Subjects' })).toHaveCount(0);

  // the administrator approves the ACCOUNT; the open page notices (on focus here; otherwise on its 15 s re-check) and opens the workspace
  expect((await a.post(`/api/admin/teachers/${userId}/decision`, { data: { decision: 'APPROVE' } })).ok()).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByTestId('teacher-approval')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'My Classes & Subjects' })).toBeVisible();
  await page.getByRole('link', { name: 'My Classes & Subjects' }).click();
  await expect(page.getByTestId('approved-assignments')).toContainText('MBBS-PATH-4');
});
