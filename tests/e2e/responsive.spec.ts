import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { PASSWORD, email, login } from './helpers';

/**
 * Responsive shell: below 1024 px the navigation is a drawer, wide tables become labelled cards on phones, and the exam
 * palette is a bottom sheet. These tests run against the real stack at phone, tablet and desktop widths.
 * The phone player test builds its own examination (and force-closes it afterwards), so it never touches the seeded demo exam that other specs change.
 */
const SIZES = [{ name: 'phone 390', width: 390, height: 844 }, { name: 'tablet 768', width: 768, height: 1024 }] as const;
const noSideways = async (page: Page, where: string) => {
  const over = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  expect(over.sw, `${where}: page scrolls sideways (${over.sw} > ${over.iw})`).toBeLessThanOrEqual(over.iw + 1);
};
const demoExamId = async (page: Page) => {
  const r = await page.request.get('/api/exams'); const j = await r.json();
  return ((j.items ?? j) as { id: string; title: string }[]).find((e) => /Pathology Mid-term/.test(e.title))!.id;
};

for (const size of SIZES) {
  test.describe(`staff shell at ${size.name}`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test('the menu is a drawer: closed by default, opens, navigates and closes itself', async ({ page }) => {
      await login(page, 'cce');
      await expect(page.getByTestId('menu-button')).toBeVisible();
      await expect(page.locator('#primary-nav')).toBeHidden();                       // the sidebar no longer occupies the first screen
      await page.getByTestId('menu-button').click();
      await expect(page.locator('#primary-nav')).toBeVisible(); await expect(page.getByTestId('menu-button')).toHaveAttribute('aria-expanded', 'true');
      await page.locator('#primary-nav').getByRole('link', { name: 'Live monitor' }).click();
      await expect(page).toHaveURL(/\/monitor/); await expect(page.locator('#primary-nav')).toBeHidden();          // closes on navigation
      await page.getByTestId('menu-button').click(); await page.keyboard.press('Escape'); await expect(page.locator('#primary-nav')).toBeHidden();
      await page.getByTestId('menu-button').click(); await page.getByTestId('nav-scrim').click({ position: { x: size.width - 10, y: 200 } }); await expect(page.locator('#primary-nav')).toBeHidden();
    });

    test('the control centre starts at the top of the page and nothing makes the page scroll sideways', async ({ page }) => {
      await login(page, 'cce'); const id = await demoExamId(page);
      for (const url of ['/dashboard', '/exams', `/monitor/${id}`, `/exams/${id}/control`, '/audit', '/incidents']) { await page.goto(url); await page.waitForLoadState('networkidle'); await noSideways(page, url); }
      await page.goto(`/exams/${id}/control`);
      const h = page.getByRole('heading', { name: /Pathology Mid-term/ }); await expect(h).toBeVisible();
      expect((await h.boundingBox())!.y, 'heading should be on the first screen, not below a stacked menu').toBeLessThan(220);
      await expect(page.getByTestId('cmd-extend')).toBeVisible();
      await expect(page.getByTestId('stats')).toBeVisible();
    });
  });
}

test.describe('phone tables become labelled cards', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('the monitor lists each candidate as a card with every value labelled', async ({ page }) => {
    await login(page, 'cce'); const id = await demoExamId(page); await page.goto(`/monitor/${id}`); await page.waitForLoadState('networkidle');
    const first = page.locator('.tbl-wrap tbody tr').first(); await expect(first).toBeVisible();
    await expect(page.locator('.tbl-wrap thead').first()).not.toBeInViewport();                                    // header row is visually hidden
    const labels = await first.locator('td').evaluateAll((tds) => tds.map((t) => (t as HTMLElement).dataset.label));
    expect(labels).toEqual(expect.arrayContaining(['Reg. no.', 'Name', 'Status']));
    await noSideways(page, 'monitor cards');
  });
});

test.describe('desktop keeps the permanent sidebar', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test('no menu button, sidebar visible', async ({ page }) => {
    await login(page, 'cce'); await expect(page.getByTestId('menu-button')).toBeHidden(); await expect(page.locator('#primary-nav')).toBeVisible();
  });
});

const BASE = 'http://localhost:3000';
async function apiAs(playwright: { request: { newContext: (o: object) => Promise<APIRequestContext> } }, local: string) {
  const r = await playwright.request.newContext({ baseURL: BASE }); const res = await r.post('/api/auth/login', { data: { email: email(local), password: PASSWORD } });
  expect(res.ok(), `login ${local}`).toBe(true); return r;
}
test.describe.serial('exam player on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  let examId = '';
  test.afterAll(async ({ playwright }) => { if (!examId) return; const cce = await apiAs(playwright, 'cce'); await cce.post(`/api/exams/${examId}/control/close`, { data: { force: true, reason: 'Test cleanup: close the responsive drill examination' } }).catch(() => undefined); await cce.dispose(); });

  test('setup: an examination with admission open', async ({ playwright }) => {
    const examiner = await apiAs(playwright, 'examiner'); const cce = await apiAs(playwright, 'cce');
    const courses = await (await examiner.get('/api/courses')).json(); const course = (Array.isArray(courses) ? courses : courses.items).find((c: { code: string }) => c.code === 'MBBS-PATH-4');
    const insts = await (await examiner.get('/api/institutions')).json(); const ids = (Array.isArray(insts) ? insts : insts.items).filter((i: { code: string }) => ['DMC-A', 'DMC-B'].includes(i.code)).map((i: { id: string }) => i.id);
    const qs = await (await examiner.get('/api/questions?status=APPROVED&pageSize=100')).json(); const qids = (qs.items as { id: string; courseId: string }[]).filter((q) => q.courseId === course.id).slice(0, 5).map((q) => q.id);
    const mk = await examiner.post('/api/exams', { data: { code: `RS-${Date.now() % 1e7}`, title: 'Responsive drill', courseId: course.id, term: '2026-SPRING', opensAt: new Date(Date.now() + 3600e3).toISOString(), closesAt: new Date(Date.now() + 86400e3).toISOString(), durationMin: 45, passPercent: 50, negativeMarking: 0, shuffleQuestions: true, institutionIds: ids, controlMode: 'MANUAL', timingPolicy: 'INDIVIDUAL' } });
    expect(mk.ok(), await mk.text()).toBe(true); examId = (await mk.json()).id;
    expect((await examiner.put(`/api/exams/${examId}/paper`, { data: { items: qids.map((questionId) => ({ questionId, marks: 2 })) } })).ok()).toBe(true);
    expect((await examiner.post(`/api/exams/${examId}/paper/submit`, { data: {} })).ok()).toBe(true);
    expect((await cce.post(`/api/exams/${examId}/paper/review`, { data: { decision: 'APPROVE', note: 'ok' } })).ok()).toBe(true);
    expect((await examiner.post(`/api/exams/${examId}/schedule`, { data: {} })).ok()).toBe(true);
    expect((await cce.post(`/api/exams/${examId}/control/open-admission`, { data: {} })).ok()).toBe(true);
    expect((await cce.post(`/api/exams/${examId}/control/start`, { data: {} })).ok()).toBe(true);
  });

  test('question first, palette in a bottom sheet, nothing sideways, controls large enough to tap', async ({ page }) => {
    await login(page, 'student.b006');
    await page.goto(`/exam/${examId}`); await page.getByRole('button', { name: /begin|resume/i }).click(); await expect(page.getByRole('timer')).toBeVisible();
    await noSideways(page, 'player');
    await expect(page.locator('#question-navigator')).toBeHidden();                                                // palette is not in the way of the question
    const opt = page.getByTestId('opt-A'); await expect(opt).toBeInViewport();
    expect((await opt.boundingBox())!.height).toBeGreaterThanOrEqual(40);
    await opt.click(); await expect(page.getByTestId('save-state')).toHaveText('✓ Saved');
    await page.getByTestId('palette-toggle').click(); await expect(page.locator('#question-navigator')).toBeVisible();
    await page.locator('#question-navigator').getByRole('listitem', { name: /^Question 3,/ }).click();
    await expect(page.locator('#question-navigator')).toBeHidden();                                                // selecting a question closes the sheet
    await expect(page.locator('.q-head span').first()).toContainText('03');
    await page.getByTestId('palette-toggle').click(); await page.getByRole('button', { name: 'Close ✕' }).click(); await expect(page.locator('#question-navigator')).toBeHidden();
  });
});
