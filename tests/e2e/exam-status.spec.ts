import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { PASSWORD, email, login } from './helpers';

/**
 * UI-006 / UI-007 / UI-008: one status model on the dashboard, schedule and entry page, driven through a REAL lifecycle:
 * scheduled → admission open → live → in progress → suspended → resumed → submitted → closed → scoring → published.
 * The planned window is deliberately in the future for a manually controlled exam: the audit showed "Live" next to "Starts in 00:58:34".
 */
const BASE = 'http://localhost:3000'; let manual = ''; let auto = ''; const tag = () => Math.random().toString(36).replace(/[0-9.]/g, '').slice(0, 5).toUpperCase().padEnd(5, 'X');   // letters only: another spec asserts the schedule text never contains "404"
const T = `Status lifecycle ${tag()}`; const TA = `Status automatic ${tag()}`;
async function apiAs(playwright: { request: { newContext: (o: object) => Promise<APIRequestContext> } }, local: string) {
  const r = await playwright.request.newContext({ baseURL: BASE }); const res = await r.post('/api/auth/login', { data: { email: email(local), password: PASSWORD } });
  expect(res.ok(), `login ${local}`).toBe(true); return r;
}
const ok = async (p: Promise<{ ok(): boolean; status(): number; text(): Promise<string> }>, what: string) => { const r = await p; expect(r.ok(), `${what}: ${r.status()} ${await r.text()}`).toBe(true); return r; };
const row = (page: Page, title: string) => page.locator('tbody tr', { hasText: title });
const sched = async (page: Page) => { await page.goto('/schedule'); await expect(page.getByRole('heading', { name: 'Exam schedule' })).toBeVisible(); };

test.describe.serial('examination status is consistent across screens (lifecycle)', () => {
  test.setTimeout(240_000);
  let examiner: APIRequestContext; let cce: APIRequestContext; let lect: APIRequestContext;
  test.beforeAll(async ({ playwright }) => {
    examiner = await apiAs(playwright, 'examiner'); cce = await apiAs(playwright, 'cce'); lect = await apiAs(playwright, 'lecturer.a');
    const courses = await (await examiner.get('/api/courses')).json(); const course = (Array.isArray(courses) ? courses : courses.items).find((c: { code: string }) => c.code === 'MBBS-PATH-4');
    const insts = await (await examiner.get('/api/institutions')).json(); const ids = (Array.isArray(insts) ? insts : insts.items).filter((i: { code: string }) => ['DMC-A', 'DMC-B'].includes(i.code)).map((i: { id: string }) => i.id);
    const qs = await (await examiner.get('/api/questions?status=APPROVED&pageSize=100')).json(); const qids = (qs.items as { id: string; courseId: string }[]).filter((q) => q.courseId === course.id).slice(0, 4).map((q) => q.id);
    const make = async (title: string, controlMode: 'MANUAL' | 'AUTOMATIC', opensInMin: number) => {
      const e = await (await ok(examiner.post('/api/exams', { data: { code: `ST-${tag()}`, title, courseId: course.id, term: '2026-SPRING', opensAt: new Date(Date.now() + opensInMin * 60e3).toISOString(), closesAt: new Date(Date.now() + 86400e3).toISOString(), durationMin: 45, passPercent: 50, negativeMarking: 0, shuffleQuestions: false, institutionIds: ids, controlMode, timingPolicy: 'INDIVIDUAL' } }), 'create')).json();
      await ok(examiner.put(`/api/exams/${e.id}/paper`, { data: { items: qids.map((questionId) => ({ questionId, marks: 1 })) } }), 'paper'); await ok(examiner.post(`/api/exams/${e.id}/paper/submit`, { data: {} }), 'submit');
      await ok(cce.post(`/api/exams/${e.id}/paper/review`, { data: { decision: 'APPROVE', note: 'ok' } }), 'approve'); await ok(examiner.post(`/api/exams/${e.id}/schedule`, { data: {} }), 'schedule');
      await ok(cce.post(`/api/exams/${e.id}/control/policy`, { data: { suspendTimePolicy: 'FREEZE_CLOCK' } }), 'policy'); return e.id as string;
    };
    manual = await make(T, 'MANUAL', 60); auto = await make(TA, 'AUTOMATIC', 90);
  });
  test.afterAll(async () => { for (const id of [manual, auto]) if (id) await cce.post(`/api/exams/${id}/control/close`, { data: { force: true, reason: 'Test cleanup: close the status examination' } }).catch(() => undefined); });

  test('before opening: a manually controlled exam shows its planned time without any countdown; an automatic one counts down to its start', async ({ page }) => {
    await login(page, 'student.a003'); await sched(page);
    const m = row(page, T); await expect(m.getByTestId('exam-status-SCHEDULED_MANUAL')).toBeVisible(); await expect(m).toContainText('Planned for'); await expect(m).not.toContainText('Starts in'); await expect(m.getByRole('link', { name: /Start|Resume/ })).toHaveCount(0);
    const a = row(page, TA); await expect(a.getByTestId('exam-status-SCHEDULED_AUTO')).toBeVisible(); await expect(a).toContainText(/Starts in\s+\d\d:\d\d:\d\d/);
  });

  test('admission open → live: the state says what the candidate can do and never combines "live" with a start countdown', async ({ page }) => {
    await ok(cce.post(`/api/exams/${manual}/control/open-admission`, { data: {} }), 'open'); await login(page, 'student.a003'); await sched(page);
    const m = row(page, T); await expect(m.getByTestId('exam-status-ADMISSION_OPEN')).toContainText('Admission is open'); await expect(m).toContainText('You may begin now'); await expect(m).not.toContainText('Starts in'); await expect(m.getByRole('link', { name: 'Start →' })).toBeVisible();
    await ok(cce.post(`/api/exams/${manual}/control/start`, { data: {} }), 'start'); await sched(page);
    await expect(m.getByTestId('exam-status-OPEN_TO_START')).toContainText('Open — you can start now'); await expect(m).toContainText(/Closes in\s+\d/); await expect(m).not.toContainText(/Starts in|Opens /);
    await page.screenshot({ path: `${process.env.SHOTS ?? '/tmp'}/status-schedule-live.png`, fullPage: false }).catch(() => undefined);
    // the dashboard uses the same words and puts it first, with a direct Start (no "Go to schedule" detour)
    await page.goto('/dashboard'); const card = page.getByText('Your examinations').locator("xpath=ancestor::*[contains(concat(' ',normalize-space(@class),' '),' card ')][1]");
    await expect(card.getByTestId('exam-status-OPEN_TO_START').first()).toBeVisible(); await expect(card).not.toContainText('Opens 0'); await expect(page.getByText('Upcoming exams')).toHaveCount(0);
    const mine = card.locator('div.row.between', { hasText: T }).first(); await expect(mine.getByTestId('exam-status-OPEN_TO_START')).toBeVisible();
    await mine.getByRole('link', { name: 'Start →' }).click(); await expect(page).toHaveURL(new RegExp(`/exam/${manual}`));       // one click from the dashboard to this examination
  });

  test('in progress → suspended → resumed → submitted: each state is named; entry page uses the same words', async ({ page }) => {
    await login(page, 'student.a003'); await page.goto(`/exam/${manual}`); await page.getByRole('button', { name: /begin|resume/i }).click(); await expect(page.getByRole('timer')).toBeVisible();
    await page.getByTestId('opt-A').click(); await expect(page.getByTestId('save-state')).toHaveText('✓ Saved');
    await sched(page); await expect(row(page, T).getByTestId('exam-status-IN_PROGRESS')).toContainText('In progress'); await expect(row(page, T).getByRole('link', { name: 'Resume →' })).toBeVisible();
    await ok(cce.post(`/api/exams/${manual}/control/suspend`, { data: { scope: 'EXAM', reason: 'Power failure in the hall — drill', confirm: true } }), 'suspend'); await sched(page);
    await expect(row(page, T).getByTestId('exam-status-SUSPENDED')).toContainText('Suspended by the examination office');
    await ok(cce.post(`/api/exams/${manual}/control/resume`, { data: { confirm: true } }), 'resume'); await sched(page); await expect(row(page, T).getByTestId('exam-status-IN_PROGRESS')).toBeVisible();
    await page.goto(`/exam/${manual}`); await page.getByRole('button', { name: /resume/i }).click(); await page.getByRole('button', { name: 'Review & submit' }).click(); await page.getByRole('button', { name: 'Submit examination…' }).click();
    await page.getByRole('dialog').getByRole('checkbox').check(); await page.getByTestId('confirm-submit').click(); await expect(page.getByTestId('receipt-code')).toHaveText(/^RC-/, { timeout: 30_000 });
    await sched(page); await expect(row(page, T).getByTestId('exam-status-SUBMITTED')).toContainText('Submitted'); await expect(row(page, T)).toContainText('Receipt RC-');
  });

  test('closed → scoring → results pending → published: waiting and published states, and an absentee sees an honest "closed / did not sit"', async ({ page, browser }) => {
    await ok(cce.post(`/api/exams/${manual}/control/close`, { data: { force: true, reason: 'Examination ended — lifecycle test' } }), 'close');
    await expect.poll(async () => (await (await cce.get(`/api/exams/${manual}/control`)).json()).exam?.status, { timeout: 40_000 }).toBe('CLOSED');
    await ok(cce.post(`/api/exams/${manual}/control/initiate-scoring`, { data: {} }), 'scoring');
    await login(page, 'student.a003'); await sched(page);
    await expect(row(page, T).getByTestId(/exam-status-(AWAITING_RESULTS)/)).toContainText('Submitted — awaiting results');
    const other = await browser.newContext(); const op = await other.newPage(); await login(op, 'student.a004'); await sched(op); await expect(row(op, T).getByTestId('exam-status-CLOSED_NOT_SAT')).toContainText('you did not sit it'); await other.close();
    await expect.poll(async () => (await (await cce.get(`/api/results/exams/${manual}`)).json()).batch?.status, { timeout: 60_000 }).toBe('GRADED');
    await ok(lect.post(`/api/grading/exams/${manual}/review`, { data: { note: 'Reviewed' } }), 'review'); await ok(examiner.post(`/api/results/exams/${manual}/approve`, { data: {} }), 'approve'); await ok(cce.post(`/api/results/exams/${manual}/publish`, { data: {} }), 'publish');
    await sched(page); await expect(row(page, T).getByTestId('exam-status-RESULTS_PUBLISHED')).toContainText('Results published'); await row(page, T).getByRole('link', { name: /View result/ }).click(); await expect(page).toHaveURL(/\/results/);
  });

  test('an exam that is not open to this candidate explains why on the entry page, using the same status words', async ({ page }) => {
    await login(page, 'student.a003'); await page.goto(`/exam/${auto}`);
    await expect(page.getByText('Scheduled.', { exact: false }).first()).toBeVisible(); await expect(page.getByRole('button', { name: /begin/i })).toBeDisabled();
  });
});

test.describe('Live monitor is part of the Campus Administrator menu (UI-006)', () => {
  test('menu item, active state on a monitored exam, and campus-only rows', async ({ page }) => {
    await login(page, 'admin.a'); const nav = page.getByRole('navigation', { name: 'Primary' });
    await expect(nav.getByRole('link', { name: 'Live monitor' })).toBeVisible(); await nav.getByRole('link', { name: 'Live monitor' }).click();
    await expect(page.getByRole('heading', { name: 'Live monitor' })).toBeVisible(); await page.getByRole('link', { name: /Monitor ›/ }).first().click().catch(async () => { await page.getByRole('button', { name: /Monitor ›/ }).first().click(); });
    await expect(page).toHaveURL(/\/monitor\/[0-9a-f-]{36}/); await expect(nav.getByRole('link', { name: 'Live monitor' })).toHaveAttribute('aria-current', 'page');
    await expect.poll(async () => page.locator('tbody tr td:nth-child(3)').count()).toBeGreaterThan(0);
    const campus = await page.locator('tbody tr td:nth-child(3)').allInnerTexts(); expect(new Set(campus)).toEqual(new Set(['DMC-A']));
  });
  test('on a phone the same item is in the drawer', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); const p = await ctx.newPage(); await login(p, 'admin.a');
    await p.getByTestId('menu-button').click(); await expect(p.locator('#primary-nav').getByRole('link', { name: 'Live monitor' })).toBeVisible(); await ctx.close();
  });
});
