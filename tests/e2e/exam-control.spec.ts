import { expect, test, type APIRequestContext } from '@playwright/test';
import { PASSWORD, email, login } from './helpers';

/**
 * A real, centrally controlled examination, driven through the browser: the controller uses the control centre, candidates sit in their own
 * windows, and everything shown comes from the backend (push over SSE with polling fallback). The exam is built through the real API.
 */
const BASE = 'http://localhost:3000';
async function apiAs(playwright: { request: { newContext: (o: object) => Promise<APIRequestContext> } }, local: string) {
  const r = await playwright.request.newContext({ baseURL: BASE }); const res = await r.post('/api/auth/login', { data: { email: email(local), password: PASSWORD } });
  expect(res.ok(), `login ${local}`).toBe(true); return r;
}
const ok = async (p: Promise<{ ok(): boolean; status(): number; text(): Promise<string> }>, what: string) => { const r = await p; expect(r.ok(), `${what}: ${r.status()} ${await r.text()}`).toBe(true); return r; };
let examId = ''; let title = ''; const madeExams: string[] = [];   // every exam this spec makes is closed afterwards so other specs' candidates see no stray "Start" link

test.describe.serial('central examination control', () => {
  test.setTimeout(240_000);
  // Leave nothing open: a stray admission-open exam would show every candidate a second "Start" link in the other specs.
  test.afterAll(async ({ playwright }) => {
    const cce = await apiAs(playwright, 'cce');
    for (const id of madeExams) await cce.post(`/api/exams/${id}/control/close`, { data: { force: true, reason: 'Test cleanup: close the drill examination' } }).catch(() => undefined);
    await cce.dispose();
  });

  test('setup: build a MANUAL-control exam through the real workflow (examiner builds, CCE approves, examiner schedules, CCE approves the suspension policy)', async ({ playwright }) => {
    const examiner = await apiAs(playwright, 'examiner'); const cce = await apiAs(playwright, 'cce');
    const courses = await (await examiner.get('/api/courses')).json(); const course = (Array.isArray(courses) ? courses : courses.items).find((c: { code: string }) => c.code === 'MBBS-PATH-4');
    const insts = await (await examiner.get('/api/institutions')).json(); const ids = (Array.isArray(insts) ? insts : insts.items).filter((i: { code: string }) => ['DMC-A', 'DMC-B'].includes(i.code)).map((i: { id: string }) => i.id);
    const qs = await (await examiner.get('/api/questions?status=APPROVED&pageSize=100')).json(); const qids = (qs.items as { id: string; courseId: string }[]).filter((q) => q.courseId === course.id).slice(0, 5).map((q) => q.id);
    expect(qids.length).toBe(5); title = `Control centre drill ${Date.now() % 100000}`;
    const created = await (await ok(examiner.post('/api/exams', { data: { code: `CC-${Date.now() % 1e7}`, title, courseId: course.id, term: '2026-SPRING', opensAt: new Date(Date.now() + 3600e3).toISOString(), closesAt: new Date(Date.now() + 86400e3).toISOString(), durationMin: 45, passPercent: 50, negativeMarking: 0, shuffleQuestions: true, institutionIds: ids, controlMode: 'MANUAL', timingPolicy: 'INDIVIDUAL' } }), 'create')).json();
    examId = created.id; madeExams.push(examId);
    await ok(examiner.put(`/api/exams/${examId}/paper`, { data: { items: qids.map((questionId) => ({ questionId, marks: 2 })) } }), 'paper');
    await ok(examiner.post(`/api/exams/${examId}/paper/submit`, { data: {} }), 'submit paper'); await ok(cce.post(`/api/exams/${examId}/paper/review`, { data: { decision: 'APPROVE', note: 'ok' } }), 'approve paper');
    await ok(examiner.post(`/api/exams/${examId}/schedule`, { data: {} }), 'schedule');
    await ok(cce.post(`/api/exams/${examId}/control/policy`, { data: { suspendTimePolicy: 'FREEZE_CLOCK' } }), 'policy');
  });

  test('the whole control cycle: admission → candidate enters → suspend → resume → extend → force-close → scoring, each reflected live on the candidate’s screen', async ({ browser }) => {
    const cceCtx = await browser.newContext(); const cp = await cceCtx.newPage(); await login(cp, 'cce');
    const stuCtx = await browser.newContext(); const sp = await stuCtx.newPage(); await login(sp, 'student.a007');
    const cmd = (slug: string) => cp.getByTestId(`cmd-${slug}`); const go = () => cp.getByTestId('dlg-go');

    await cp.goto(`/exams/${examId}/control`);
    await expect(cp.getByRole('heading', { name: new RegExp(title) })).toBeVisible();
    await expect(cp.getByTestId('state-chips')).toContainText('Individual attempt timing'); await expect(cp.getByTestId('state-chips')).toContainText('Manual control');
    await expect(cp.getByTestId('suspend-policy')).toContainText('frozen');
    await expect(cp.getByTestId('stats')).toContainText('Allocated');
    await expect(cmd('suspend')).toBeDisabled(); await expect(cmd('resume')).toBeDisabled(); await expect(cmd('initiate-scoring')).toBeDisabled();   // state machine drives the buttons

    // candidate cannot enter before admission
    await sp.goto(`/exam/${examId}`); await expect(sp.getByRole('button', { name: /begin examination/i })).toBeDisabled();

    await cmd('open-admission').click(); await go().click();
    await expect(cp.getByRole('heading', { name: new RegExp(title) })).toContainText(/Admission open/i);
    await expect(cmd('open-admission')).toBeDisabled();

    await sp.reload(); await sp.getByRole('button', { name: /begin examination/i }).click(); await expect(sp.getByRole('timer')).toBeVisible();
    await sp.getByTestId('opt-A').click(); await expect(sp.getByTestId('save-state')).toHaveText('✓ Saved');
    await expect(cp.getByTestId('stats')).toContainText(/Admitted \(entered\)\s*1/, { timeout: 15_000 });             // the entry arrived on the controller's screen

    await cmd('start').click(); await go().click(); await expect(cp.getByRole('heading', { name: new RegExp(title) })).toContainText(/Live/i);

    // ── suspend ──
    await cmd('suspend').click();
    await cp.getByRole('dialog').getByRole('textbox').fill('Power failure in the main hall — drill');
    await expect(go()).toBeDisabled(); await cp.getByTestId('confirm-box').check(); await go().click();
    await expect(cp.getByRole('heading', { name: new RegExp(title) })).toContainText(/Suspended/i);
    await expect(sp.getByTestId('suspended-banner')).toBeVisible({ timeout: 15_000 });                                // pushed to the candidate
    await expect(sp.locator('.exam-body')).toHaveCSS('pointer-events', 'none');
    await expect(sp.getByRole('button', { name: /review & submit/i })).toBeDisabled();
    await expect(cp.getByRole('table').first()).toBeVisible();

    // ── resume ──
    await cmd('resume').click(); await cp.getByTestId('confirm-box').check(); await go().click();
    await expect(cp.getByRole('heading', { name: new RegExp(title) })).toContainText(/Live/i);
    await expect(sp.getByTestId('suspended-banner')).toHaveCount(0, { timeout: 15_000 });
    await expect(sp.getByTestId('control-message')).toContainText(/resumed/i);
    await sp.getByTestId('opt-B').click(); await expect(sp.getByTestId('save-state')).toHaveText('✓ Saved');             // saving works again

    // ── extend (preview first) ──
    await cmd('extend').click();
    const dlg = cp.getByRole('dialog'); await dlg.getByRole('spinbutton').fill('10'); await dlg.getByRole('textbox').fill('Verified hall disturbance — drill');
    await expect(go()).toBeDisabled();                                                                                // cannot apply before previewing
    await cp.getByTestId('preview').click(); await expect(cp.getByTestId('preview-result')).toContainText(/1\s*attempt/);
    await cp.getByTestId('confirm-box').check(); await go().click();
    await expect(sp.getByTestId('control-message')).toContainText(/extended by 10 minute/i, { timeout: 15_000 });
    await expect(cp.getByText(/Verified hall disturbance/).first()).toBeVisible();                                    // in the extension history

    if (process.env.SHOTS) { await cp.setViewportSize({ width: 1440, height: 900 }); await cp.screenshot({ path: `${process.env.SHOTS}/control-centre.png`, fullPage: true }); await sp.screenshot({ path: `${process.env.SHOTS}/candidate.png` }); }   // opt-in evidence capture

    // ── force-close → candidate settles into a receipt ──
    await cmd('close').click(); await cp.getByTestId('force-box').check(); await cp.getByRole('dialog').getByRole('textbox').fill('Examination ended at the controller’s decision — drill'); await go().click();
    await expect(sp.getByTestId('receipt-code')).toHaveText(/^RC-/, { timeout: 30_000 });
    await expect(cp.getByRole('heading', { name: new RegExp(title) })).toContainText(/Closed/i, { timeout: 30_000 });
    await expect(cmd('initiate-scoring')).toBeEnabled();
    await cmd('initiate-scoring').click(); await go().click();
    await expect(cp.getByRole('heading', { name: new RegExp(title) })).toContainText(/Result pending/i, { timeout: 30_000 });
    await expect(cp.getByTestId('health')).toContainText('Lifecycle worker');
    await cceCtx.close(); await stuCtx.close();
  });

  test('campus staff see only their campus and have no exam-wide control; a candidate cannot open the command centre', async ({ browser, playwright }) => {
    const ctx = await browser.newContext(); const p = await ctx.newPage(); await login(p, 'admin.a');
    await p.goto(`/monitor/${examId}`); await expect(p.getByRole('heading', { name: 'Live monitor' })).toBeVisible();
    const campus = await p.locator('tbody tr td:nth-child(3)').allInnerTexts(); expect(campus.length).toBeGreaterThan(0); expect(new Set(campus)).toEqual(new Set(['DMC-A']));
    await p.goto(`/exams/${examId}/control`); await expect(p.getByTestId('error-forbidden')).toBeVisible();
    const api = await apiAs(playwright, 'admin.a'); for (const slug of ['suspend', 'start', 'close']) expect((await api.post(`/api/exams/${examId}/control/${slug}`, { data: {} })).status()).toBe(403);
    await ctx.close();
    const sctx = await browser.newContext(); const sp = await sctx.newPage(); await login(sp, 'student.a008'); await sp.goto(`/exams/${examId}/control`); await expect(sp.getByTestId('error-forbidden')).toBeVisible(); await sctx.close();
  });

  test('synchronized exam: candidates wait in a lobby and the examination opens for them when the controller starts it', async ({ browser, playwright }) => {
    const examiner = await apiAs(playwright, 'examiner'); const cce = await apiAs(playwright, 'cce');
    const courses = await (await examiner.get('/api/courses')).json(); const course = (Array.isArray(courses) ? courses : courses.items).find((c: { code: string }) => c.code === 'MBBS-PATH-4');
    const insts = await (await examiner.get('/api/institutions')).json(); const ids = (Array.isArray(insts) ? insts : insts.items).filter((i: { code: string }) => ['DMC-A', 'DMC-B'].includes(i.code)).map((i: { id: string }) => i.id);
    const qs = await (await examiner.get('/api/questions?status=APPROVED&pageSize=100')).json(); const qids = (qs.items as { id: string; courseId: string }[]).filter((q) => q.courseId === course.id).slice(0, 3).map((q) => q.id);
    const ex = await (await ok(examiner.post('/api/exams', { data: { code: `SY-${Date.now() % 1e7}`, title: 'Synchronized drill', courseId: course.id, term: '2026-SPRING', opensAt: new Date(Date.now() + 3600e3).toISOString(), closesAt: new Date(Date.now() + 86400e3).toISOString(), durationMin: 30, passPercent: 50, negativeMarking: 0, shuffleQuestions: true, institutionIds: ids, controlMode: 'MANUAL', timingPolicy: 'SYNCHRONIZED' } }), 'create')).json();
    madeExams.push(ex.id);
    await ok(examiner.put(`/api/exams/${ex.id}/paper`, { data: { items: qids.map((questionId) => ({ questionId, marks: 2 })) } }), 'paper'); await ok(examiner.post(`/api/exams/${ex.id}/paper/submit`, { data: {} }), 'submit');
    await ok(cce.post(`/api/exams/${ex.id}/paper/review`, { data: { decision: 'APPROVE' } }), 'approve'); await ok(examiner.post(`/api/exams/${ex.id}/schedule`, { data: {} }), 'schedule'); await ok(cce.post(`/api/exams/${ex.id}/control/open-admission`, { data: {} }), 'open');
    const ctx = await browser.newContext(); const sp = await ctx.newPage(); await login(sp, 'student.b002');
    await sp.goto(`/exam/${ex.id}`); await sp.getByRole('button', { name: /begin examination/i }).click();
    await expect(sp.getByTestId('lobby')).toBeVisible(); await expect(sp.getByRole('timer')).toHaveCount(0);                // admitted, but no paper and no clock yet
    await ok(cce.post(`/api/exams/${ex.id}/control/start`, { data: {} }), 'start');
    await expect(sp.getByRole('timer')).toBeVisible({ timeout: 20_000 });                                              // the lobby opened the exam on the push
    await ctx.close();
  });
});
