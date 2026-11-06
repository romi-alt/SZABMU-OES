import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, as, boot, type Ctx } from './helpers';

/** Teacher MCQ editor, step 3: subtopic / Bloom / image, version history on create and edit, richer import and export. */
let ctx: Ctx; let A: string; let PATH: string; let PROG: string; let seq = 0;
const TERM = '2026-SPRING'; const PW = 'Sturdy-Pass-2026!x';
const anon = () => new Client(ctx.app);
beforeAll(async () => {
  ctx = await boot({ studentsPerCampus: 4 });
  A = (ctx.seeded.institutions as Record<'a', { id: string }>).a.id; PATH = ctx.seeded.courses.path.id; PROG = ctx.seeded.programs.mbbs.id;
});
afterAll(async () => { await ctx.app.close(); });

async function teacher(approve = true) {
  await ctx.kv.clearPrefix('rl:treg:'); const n = `${Date.now()}${++seq}`;
  const f = { fullName: `Dr Editor ${n}`, email: `ed${n}@example.test`, password: PW, employeeId: `ED-${n}`, department: 'Pathology', designation: 'Lecturer', phone: '+92 300 1234567', assignments: [{ institutionId: A, programId: PROG, semester: 4, term: TERM, courseId: PATH }] };
  const s = await anon().post('/teacher-registration', f); expect((await anon().post('/teacher-registration/verify', { email: f.email, code: s.body.devCode })).status).toBe(200);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email: f.email } });
  const c = new Client(ctx.app, ''); const l = await c.req('POST', '/auth/login', { email: f.email, password: PW }); const sc = l.headers['set-cookie']; c.cookie = String(Array.isArray(sc) ? sc[0] : sc).split(';')[0]!;
  const row = await ctx.prisma.courseAssignment.findFirstOrThrow({ where: { userId: user.id } });
  if (approve) { const a = await as(ctx, 'admin.a'); await a.post(`/admin/teachers/${user.id}/decision`, { decision: 'APPROVE' }); await a.post(`/admin/teachers/assignments/${row.id}/decision`, { decision: 'APPROVE' }); }
  const pool = approve ? (await c.post('/teacher/pools', { assignmentId: row.id, name: `Bank ${n}` })).body.id as string : '';
  return { c, userId: user.id, assignmentId: row.id, pool };
}
const mcq = (extra: Record<string, unknown> = {}) => ({ stem: 'Which organ produces insulin in the human body?', options: ['Liver', 'Pancreas', 'Kidney', 'Spleen'], correctIndex: 1, difficulty: 'EASY', topic: 'Endocrine', marks: 1, ...extra });
// 1×1 PNG, and the same bytes labelled as a different type
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const png = `data:image/png;base64,${PNG}`;

describe('subtopic, Bloom level and image', () => {
  it('stores and returns them; refuses unknown Bloom levels; duplicates keep them', async () => {
    const t = await teacher();
    const img = (await t.c.post('/teacher/images', { data: png })); expect(img.status).toBe(201); expect(img.body.id).toBeTruthy();
    const q = (await t.c.post(`/teacher/pools/${t.pool}/questions`, mcq({ subtopic: 'Pancreatic hormones', bloom: 'UNDERSTAND', imageId: img.body.id }))).body;
    expect(q).toMatchObject({ topic: 'Endocrine', subtopic: 'Pancreatic hormones', bloom: 'UNDERSTAND', imageId: img.body.id, status: 'DRAFT' });
    expect((await t.c.post(`/teacher/pools/${t.pool}/questions`, mcq({ bloom: 'GENIUS' }))).status).toBe(400);
    expect((await t.c.post(`/teacher/pools/${t.pool}/questions`, mcq({ subtopic: 'x'.repeat(200) }))).status).toBe(400);
    const edited = (await t.c.put(`/teacher/questions/${q.id}`, mcq({ subtopic: 'Islets', bloom: null, imageId: null }))).body;
    expect(edited).toMatchObject({ subtopic: 'Islets', bloom: null, imageId: null, version: 2 });
    const dup = (await t.c.post(`/teacher/questions/${q.id}/duplicate`)).body; expect(dup).toMatchObject({ subtopic: 'Islets', bloom: null, status: 'DRAFT' });
    expect((await t.c.get(`/teacher/questions?poolId=${t.pool}&search=Islets`)).body.total).toBe(2);        // subtopic is searchable
  });
});

describe('images', () => {
  it('accepts PNG/JPEG/WebP only, checks the real bytes and the size, and serves an image only to its uploader', async () => {
    const t = await teacher(); const other = await teacher();
    expect((await t.c.post('/teacher/images', { data: `data:image/svg+xml;base64,${Buffer.from('<svg onload=alert(1)/>').toString('base64')}` })).status).toBe(400);
    expect((await t.c.post('/teacher/images', { data: `data:image/jpeg;base64,${PNG}` })).status).toBe(400);            // PNG bytes labelled JPEG
    expect((await t.c.post('/teacher/images', { data: `data:image/png;base64,${Buffer.alloc(1_100_000, 1).toString('base64')}` })).status).toBe(400);   // too large
    expect((await t.c.post('/teacher/images', { data: 'not an image' })).status).toBe(400);
    const id = (await t.c.post('/teacher/images', { data: png })).body.id as string;
    expect((await t.c.get(`/teacher/images/${id}`)).body).toEqual({ id, mime: 'image/png', data: png });
    expect((await other.c.get(`/teacher/images/${id}`)).status).toBe(404);                                                // someone else's image
    expect((await other.c.post(`/teacher/pools/${other.pool}/questions`, mcq({ imageId: id }))).status).toBe(400);        // cannot attach it either
    const row = await ctx.prisma.questionImage.findUniqueOrThrow({ where: { id } }); expect(row).toMatchObject({ mime: 'image/png', uploadedById: t.userId }); expect(row.sha256).toHaveLength(64);
  });
  it('a pending teacher cannot upload', async () => {
    const p = await teacher(false); const r = await p.c.post('/teacher/images', { data: png }); expect(r.status).toBe(403);
  });
});

describe('version history', () => {
  it('records version 1 on create and a new version on every edit, with the answer key, and the rows cannot be changed', async () => {
    const t = await teacher();
    const q = (await t.c.post(`/teacher/pools/${t.pool}/questions`, mcq({ stem: 'Original statement: which gland secretes insulin?' }))).body;
    await t.c.put(`/teacher/questions/${q.id}`, mcq({ stem: 'Edited statement: which gland secretes insulin?', correctIndex: 2 }));
    await t.c.put(`/teacher/questions/${q.id}`, mcq({ stem: 'Edited again: which gland secretes insulin?', subtopic: 'Islets', bloom: 'APPLY' }));
    const rows = await ctx.prisma.questionVersion.findMany({ where: { questionId: q.id }, orderBy: { version: 'asc' } });
    expect(rows.map((r) => r.version)).toEqual([1, 2, 3]); expect(rows.every((r) => r.changedById === t.userId)).toBe(true);
    const snap = (i: number) => rows[i]!.snapshot as any;
    expect(snap(0).stem).toMatch(/^Original/); expect(snap(0).options.find((o: any) => o.isCorrect).label).toBe('B');
    expect(snap(1).stem).toMatch(/^Edited statement/); expect(snap(1).options.find((o: any) => o.isCorrect).label).toBe('C');
    expect(snap(2)).toMatchObject({ subtopic: 'Islets', bloom: 'APPLY' });
    await expect(ctx.prisma.$executeRaw`UPDATE question_versions SET version = 99 WHERE questionId = ${q.id}`).rejects.toThrow(/append-only/);
    await expect(ctx.prisma.$executeRaw`DELETE FROM question_versions WHERE questionId = ${q.id}`).rejects.toThrow(/append-only/);
  });
  it('a question that existed before history was recorded gets its earlier content captured on the first edit', async () => {
    const t = await teacher();
    const legacy = await ctx.prisma.question.create({ data: { courseId: PATH, institutionId: A, authorId: t.userId, type: 'MCQ', tags: [], stem: 'Legacy statement written before history existed', difficulty: 'EASY', poolId: t.pool, topic: 'Old', defaultMarks: 1,
      options: { create: ['Liver', 'Pancreas', 'Kidney', 'Spleen'].map((text, i) => ({ label: 'ABCD'[i]!, text, isCorrect: i === 1 })) } } });
    expect(await ctx.prisma.questionVersion.count({ where: { questionId: legacy.id } })).toBe(0);
    expect((await t.c.put(`/teacher/questions/${legacy.id}`, mcq({ stem: 'Legacy statement after the first edit' }))).body.version).toBe(2);
    const rows = await ctx.prisma.questionVersion.findMany({ where: { questionId: legacy.id }, orderBy: { version: 'asc' } });
    expect(rows.map((r) => r.version)).toEqual([1, 2]); expect((rows[0]!.snapshot as any).stem).toBe('Legacy statement written before history existed'); expect((rows[1]!.snapshot as any).stem).toBe('Legacy statement after the first edit');
  });
  it('import writes version 1 for every imported question; lecturer-authored questions get history too', async () => {
    const t = await teacher();
    const r = await t.c.post(`/teacher/pools/${t.pool}/import`, { rows: [{ statement: 'Imported one: which organ filters blood?', options: ['Kidney', 'Heart', 'Lung', 'Skin'], correct: 'A' }] }); expect(r.status).toBe(200);
    const qs = await ctx.prisma.question.findMany({ where: { poolId: t.pool } }); expect(qs).toHaveLength(1);
    expect(await ctx.prisma.questionVersion.count({ where: { questionId: qs[0]!.id, version: 1 } })).toBe(1);
    const lect = await as(ctx, 'lecturer.a'); const made = await lect.post('/questions', { courseId: ctx.seeded.courses.path.id, type: 'MCQ', stem: 'Lecturer question: which vitamin prevents scurvy?', difficulty: 'EASY', options: [{ label: 'A', text: 'A', isCorrect: false }, { label: 'B', text: 'B12', isCorrect: false }, { label: 'C', text: 'C', isCorrect: true }, { label: 'D', text: 'D', isCorrect: false }] });
    expect([200, 201]).toContain(made.status); expect(await ctx.prisma.questionVersion.count({ where: { questionId: made.body.id } })).toBe(1);
  });
});

describe('import and export carry the new columns', () => {
  it('imports subtopic and Bloom level (case-insensitive), reports the row of a bad Bloom value, and exports them with a table for spreadsheets', async () => {
    const t = await teacher();
    const ok = await t.c.post(`/teacher/pools/${t.pool}/import`, { rows: [
      { statement: 'Row one: which organ pumps blood?', options: ['Heart', 'Lung', 'Liver', 'Kidney'], correct: 'A', topic: 'Cardio', subtopic: 'Anatomy', bloom: 'remember', difficulty: 'easy', marks: 2 },
      { statement: 'Row two: which vessel carries oxygenated blood to the body?', options: ['Aorta', 'Vena cava', 'Pulmonary artery', 'Portal vein'], correct: 'A', bloom: ' Apply ' }] });
    expect(ok.body).toEqual({ created: 2 });
    const bad = await t.c.post(`/teacher/pools/${t.pool}/import`, { rows: [{ statement: 'Fine row: which organ pumps blood?', options: ['Heart', 'Lung', 'Liver', 'Kidney'], correct: 'A' }, { statement: 'Bad row: which organ pumps blood?', options: ['Heart', 'Lung', 'Liver', 'Kidney'], correct: 'A', bloom: 'genius' }] });
    expect(bad.status).toBe(400); expect(bad.body.message).toMatch(/Row 3.*Bloom/i);
    expect(await ctx.prisma.question.count({ where: { poolId: t.pool } })).toBe(2);                                        // all or nothing
    const ex = (await t.c.get(`/teacher/pools/${t.pool}/export`)).body;
    expect(ex.csv.split('\r\n')[0]).toBe('statement,option_a,option_b,option_c,option_d,option_e,correct,explanation,difficulty,topic,subtopic,bloom,marks,status');
    expect(ex.table.head).toEqual(ex.csv.split('\r\n')[0].split(',')); expect(ex.table.rows).toHaveLength(2);
    const first = ex.table.rows.find((r: any[]) => String(r[0]).startsWith('Row one')); expect(first.slice(6, 14)).toEqual(['A', '', 'easy', 'Cardio', 'Anatomy', 'remember', 2, 'draft']);
  });
});
