import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import path from 'node:path';

/** Teacher portal step 3: fast MCQ editor (subtopic, Bloom, image, Save & add another, unsaved-changes guard), history, Excel import/export. */
test.describe.configure({ mode: 'serial' });
const BASE = 'http://localhost:3000'; const TEACHER = 'editor.teacher@example.test'; const PW = 'Sturdy-Pass-2026!x';
const FIX = (n: string) => path.join(__dirname, 'fixtures', n);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const dialog = (p: Page) => p.getByRole('dialog');
/** Each test starts in a fresh browser context: sign in and open the bank. */
async function openBank(page: Page) {
  await page.goto('/login'); await page.getByLabel('University email').fill(TEACHER); await page.getByLabel('Password').fill(PW); await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.goto('/pools'); await page.getByRole('button', { name: 'Editor bank' }).click(); await expect(page.getByRole('heading', { name: 'Editor bank' })).toBeVisible();
}

async function approvedTeacher(request: APIRequestContext, admin: APIRequestContext) {
  const cat = await (await request.get(`${BASE}/api/teacher-registration/catalog`)).json(); const course = cat.courses.find((c: any) => c.code === 'MBBS-PATH-4');
  const start = await request.post(`${BASE}/api/teacher-registration`, { data: { fullName: 'Dr Editor Check', email: TEACHER, password: PW, employeeId: 'EDT-0001', department: 'Pathology', designation: 'Lecturer', phone: '+92 300 1234567',
    assignments: [{ institutionId: cat.institutions.find((i: any) => i.code === 'DMC-A').id, programId: cat.programs.find((p: any) => p.code === 'MBBS').id, semester: course.semester, term: '2026-SPRING', courseId: course.id }] } });
  expect((await request.post(`${BASE}/api/teacher-registration/verify`, { data: { email: TEACHER, code: (await start.json()).devCode } })).ok()).toBe(true);
  const userId = (await (await admin.get('/api/admin/teachers?search=EDT-0001')).json()).items[0].userId; const det = await (await admin.get(`/api/admin/teachers/${userId}`)).json();
  await admin.post(`/api/admin/teachers/${userId}/decision`, { data: { decision: 'APPROVE' } }); await admin.post(`/api/admin/teachers/assignments/${det.assignments[0].id}/decision`, { data: { decision: 'APPROVE' } });
}

test('setup: an approved teacher and an empty question bank', async ({ page, playwright }) => {
  const admin = await playwright.request.newContext({ baseURL: BASE }); expect((await admin.post('/api/auth/login', { data: { email: 'admin.a@demo.szabmu.invalid', password: 'Demo-Passw0rd-2026!' } })).ok()).toBe(true);
  await approvedTeacher(await playwright.request.newContext(), admin);
  await page.goto('/login'); await page.getByLabel('University email').fill(TEACHER); await page.getByLabel('Password').fill(PW); await page.getByRole('button', { name: /sign in/i }).click();
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'MCQ Question Banks' }).click();
  await page.getByRole('button', { name: '+ New question bank' }).click(); await page.getByLabel('Bank title').fill('Editor bank'); await page.getByRole('button', { name: 'Create question bank' }).click();
  await expect(page.getByRole('heading', { name: 'Editor bank' })).toBeVisible();
});

test('Save & add another saves, opens a fresh form with the same classification, and Save draft closes', async ({ page }) => {
  await openBank(page);
  await page.getByRole('button', { name: '+ Add MCQ' }).click(); const d = dialog(page);
  await d.getByRole('button', { name: 'Save & add another' }).click();                                              // nothing entered: clear errors, nothing saved
  await expect(d.getByText('Enter the question.')).toBeVisible(); await expect(page.getByTestId('modal-missing')).toContainText('Question statement');
  await d.getByLabel('Question statement').fill('Which enzyme is deficient in classic phenylketonuria?');
  for (const [i, t] of ['Tyrosinase', 'Phenylalanine hydroxylase', 'Homogentisate oxidase', 'Fumarylacetoacetase'].entries()) await d.getByLabel(`Option ${'ABCD'[i]}`, { exact: true }).fill(t);
  await d.getByLabel('Option B is correct').check();
  await d.getByLabel('Topic', { exact: true }).fill('Biochemistry'); await d.getByLabel('Subtopic').fill('Amino acid disorders'); await d.getByLabel("Bloom's level (optional)").selectOption('UNDERSTAND'); await d.getByLabel('Difficulty').selectOption('HARD'); await d.getByLabel('Marks').fill('2');
  await d.getByLabel('Image or diagram').setInputFiles({ name: 'pathway.png', mimeType: 'image/png', buffer: PNG });
  await expect(d.getByAltText('Image attached to the question').first()).toBeVisible();
  await d.getByRole('button', { name: 'Preview' }).click(); await expect(page.getByTestId('editor-preview')).toContainText('Phenylalanine hydroxylase'); await expect(page.getByTestId('editor-preview')).toContainText('Bloom: Understand'); await d.getByRole('button', { name: 'Back to editing' }).click();
  await d.getByRole('button', { name: 'Save & add another' }).click();
  await expect(page.getByTestId('added-count')).toContainText('1 question saved');
  await expect(d.getByLabel('Question statement')).toHaveValue(''); await expect(d.getByLabel('Question statement')).toBeFocused();   // fresh form, ready to type
  await expect(d.getByLabel('Topic', { exact: true })).toHaveValue('Biochemistry'); await expect(d.getByLabel('Subtopic')).toHaveValue('Amino acid disorders'); await expect(d.getByLabel('Difficulty')).toHaveValue('HARD'); await expect(d.getByLabel('Marks')).toHaveValue('2');
  await expect(d.getByLabel('Option A', { exact: true })).toHaveValue('');
  // keyboard: Enter moves to the next option; Ctrl+Enter saves and opens another
  await d.getByLabel('Question statement').fill('Which cranial nerve supplies the muscles of facial expression?');
  await d.getByLabel('Option A', { exact: true }).fill('Trigeminal'); await page.keyboard.press('Enter'); await expect(d.getByLabel('Option B', { exact: true })).toBeFocused();
  await page.keyboard.type('Facial'); await page.keyboard.press('Enter'); await page.keyboard.type('Vagus'); await page.keyboard.press('Enter'); await page.keyboard.type('Hypoglossal');
  await d.getByLabel('Option B is correct').check(); await d.getByLabel('Question statement').press('Control+Enter');
  await expect(page.getByTestId('added-count')).toContainText('2 questions saved');
  // nothing typed in the fresh form → Cancel closes without asking
  await d.getByRole('button', { name: 'Cancel' }).click(); await expect(dialog(page)).toHaveCount(0);
  const list = page.getByTestId('question-list'); await expect(list.locator('tbody tr')).toHaveCount(2);
  await expect(list).toContainText('Amino acid disorders'); await expect(list).toContainText('Understand');
});

test('unsaved changes are protected; Save draft closes; editing keeps a version history', async ({ page }) => {
  await openBank(page);
  await page.getByRole('button', { name: '+ Add MCQ' }).click(); await dialog(page).getByLabel('Question statement').fill('A half-written question that must not be lost');
  await dialog(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('alertdialog', { name: 'Discard changes?' })).toBeVisible(); await page.getByTestId('keep-editing').click(); await expect(dialog(page).getByLabel('Question statement')).toHaveValue(/half-written/);
  await page.keyboard.press('Escape'); await expect(page.getByRole('alertdialog', { name: 'Discard changes?' })).toBeVisible();     // Escape asks too
  await page.getByTestId('discard-changes').click(); await expect(dialog(page)).toHaveCount(0);
  // edit a saved question: Save draft closes the dialog and bumps the version
  const row = page.getByTestId('question-list').locator('tbody tr', { hasText: 'cranial nerve' }); await row.getByRole('button', { name: 'Edit' }).click();
  await dialog(page).getByLabel('Question statement').fill('Which cranial nerve supplies the muscles of facial expression? (revised)'); await dialog(page).getByRole('button', { name: 'Save draft' }).click(); await expect(dialog(page)).toHaveCount(0);
  const qs = await (await page.request.get('/api/teacher/questions?pageSize=50')).json(); const q = qs.items.find((x: any) => x.stem.includes('(revised)'));
  expect(q.version).toBe(2); expect(q.status).toBe('DRAFT');
  const ax = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(ax.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
});

test('the editor has no serious accessibility violations and works on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await openBank(page);
  await page.getByRole('button', { name: '+ Add MCQ' }).click(); await expect(dialog(page).getByRole('button', { name: 'Save & add another' })).toBeVisible();
  const ax = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(ax.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
});

test('Excel: export, re-import the exported file, templates, a file made by another program, and hostile or wrong files', async ({ page }) => {
  await openBank(page);
  const list = page.getByTestId('question-list'); await expect(list.locator('tbody tr')).toHaveCount(2);
  const dl = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export Excel' }).click(); const file = await dl; expect(file.suggestedFilename()).toBe('Editor-bank.xlsx');
  const exported = path.join(test.info().outputDir, 'exported.xlsx'); await file.saveAs(exported);
  await page.getByRole('button', { name: 'Import from CSV or Excel' }).click(); const d = dialog(page);
  await d.getByLabel('CSV or Excel file').setInputFiles(exported);                                                  // our own writer, read back by our reader
  await expect(d.getByText('2 questions found.')).toBeVisible(); await expect(page.getByTestId('import-file')).toContainText('exported.xlsx');
  // a workbook produced by openpyxl: shared strings, compression, numbers, a second sheet to ignore, mixed-case headers/answers
  await d.getByLabel('CSV or Excel file').setInputFiles(FIX('mcq-import-ok.xlsx')); await expect(d.getByText('3 questions found.')).toBeVisible();
  const tpl = page.waitForEvent('download'); await d.getByRole('button', { name: 'Download Excel template' }).click(); const t = await tpl; expect(t.suggestedFilename()).toBe('mcq-template.xlsx');
  const tplPath = path.join(test.info().outputDir, 'template.xlsx'); await t.saveAs(tplPath); await d.getByLabel('CSV or Excel file').setInputFiles(tplPath); await expect(d.getByText('1 question found.')).toBeVisible();
  // wrong or hostile files: refused with a plain message, nothing imported
  await d.getByLabel('CSV or Excel file').setInputFiles(FIX('zip-bomb.xlsx')); await expect(d.getByText(/too large to read/)).toBeVisible();
  await d.getByLabel('CSV or Excel file').setInputFiles({ name: 'notes.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.from('this is plainly not a workbook') }); await expect(d.getByText('This is not an Excel (.xlsx) file.')).toBeVisible();
  await d.getByLabel('CSV or Excel file').setInputFiles({ name: 'old.xls', mimeType: 'application/vnd.ms-excel', buffer: Buffer.from('x') }); await expect(d.getByText(/Old \.xls files are not supported/)).toBeVisible();
  await expect(d.getByRole('button', { name: /^Import/ })).toBeDisabled();
  // a bad Bloom value: the server names the row and imports nothing
  await d.getByLabel('CSV or Excel file').setInputFiles(FIX('mcq-import-bad-bloom.xlsx')); await d.getByRole('button', { name: /Import 2 questions/ }).click();
  await expect(d.getByText(/Row 3.*Bloom level/)).toBeVisible(); await expect(list.locator('tbody tr')).toHaveCount(2);
  // the good file imports, with subtopic and Bloom carried over
  await d.getByLabel('CSV or Excel file').setInputFiles(FIX('mcq-import-ok.xlsx')); await d.getByRole('button', { name: /Import 3 questions/ }).click(); await expect(dialog(page)).toHaveCount(0);
  await expect(list.locator('tbody tr')).toHaveCount(5); await expect(list).toContainText('Amino acid disorders'); await expect(list).toContainText('Vitamins');
  const qs = await (await page.request.get('/api/teacher/questions?pageSize=50&search=scurvy')).json(); expect(qs.items[0]).toMatchObject({ topic: 'Nutrition', subtopic: 'Vitamins', bloom: 'REMEMBER', difficulty: 'EASY', marks: 1 });
  const pku = (await (await page.request.get('/api/teacher/questions?pageSize=50&search=phenylketonuria')).json()).items.find((x: any) => x.marks === 1.5); expect(pku).toMatchObject({ difficulty: 'HARD', bloom: null, options: expect.arrayContaining([expect.objectContaining({ label: 'B', isCorrect: true })]) });
});
