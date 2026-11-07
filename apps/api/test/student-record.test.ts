import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, as, boot, type Ctx } from './helpers';

/** UI-034: a read-only student record for people who manage a campus: identity, placement, enrolments and exam admission decisions. Never marks. */
let ctx: Ctx; let a: Client; let sid: string; let otherSid: string;
beforeAll(async () => {
  ctx = await boot({ studentsPerCampus: 3 }); a = await as(ctx, 'admin.a');
  sid = (await ctx.prisma.student.findFirstOrThrow({ where: { institution: { code: 'DMC-A' }, enrollments: { some: {} }, candidacies: { some: {} } } })).id;   // a seeded student with enrolments and an exam entry
  otherSid = (await ctx.prisma.student.findFirstOrThrow({ where: { institution: { code: 'DMC-B' } } })).id;
});
afterAll(async () => { await ctx.app.close(); });

describe('GET /students/:id', () => {
  it('shows a student of the caller\'s own campus with placement, enrolments and exam admission', async () => {
    const r = await a.get(`/students/${sid}`); expect(r.status, r.raw).toBe(200);
    expect(r.body).toMatchObject({ id: sid, regNo: expect.any(String), fullName: expect.any(String), email: expect.stringMatching(/@demo\.szabmu\.invalid$/), institution: { code: 'DMC-A' }, program: { code: expect.any(String) }, semester: expect.any(Number), status: 'ACTIVE' });
    expect(r.body).toHaveProperty('verification'); expect(Array.isArray(r.body.enrolments)).toBe(true); expect(Array.isArray(r.body.exams)).toBe(true);
    expect(r.body.enrolments.length).toBeGreaterThan(0); expect(r.body.enrolments[0]).toMatchObject({ course: { code: expect.any(String), title: expect.any(String) }, term: expect.any(String), eligibility: expect.any(String) });
    expect(r.body.exams.length).toBeGreaterThan(0); expect(r.body.exams[0]).toMatchObject({ exam: { code: expect.any(String), status: expect.any(String) }, admission: expect.any(String) });
  });
  it('never carries marks, scores, answers or sensitive contact fields', async () => {
    const r = await a.get(`/students/${sid}`); expect(r.status).toBe(200); const text = JSON.stringify(r.body).toLowerCase();
    for (const word of ['score', 'marks', 'percent', 'answer', 'passwordhash', 'guardianphone', 'address', 'dateofbirth', 'photo']) expect(text, word).not.toContain(word);
  });
  it('is campus-scoped: another campus\'s student, or an unknown id, is not found', async () => {
    expect((await a.get(`/students/${otherSid}`)).status).toBe(404); expect((await a.get('/students/00000000-0000-4000-8000-000000000000')).status).toBe(404); expect((await a.get('/students/not-a-uuid')).status).toBe(400);
    const su = await as(ctx, 'super.admin'); expect((await su.get(`/students/${otherSid}`)).status).toBe(200);
  });
  it('is for staff who can read students; candidates and teachers cannot', async () => {
    for (const who of ['student.a001']) expect((await (await as(ctx, who)).get(`/students/${sid}`)).status, who).toBe(403);
    expect((await new Client(ctx.app).get(`/students/${sid}`)).status).toBe(401);
    expect((await (await as(ctx, 'lecturer.a')).get(`/students/${sid}`)).status).toBe(200);
  });
});
