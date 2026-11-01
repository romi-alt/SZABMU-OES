import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, boot, type Ctx } from './helpers';

/** UI-0xx regression: free-text phone fields accepted "abc". The server now enforces the shared phone format. */
let ctx: Ctx;
beforeAll(async () => { ctx = await boot({ studentsPerCampus: 2 }); });
afterAll(async () => { await ctx.app.close(); });

describe('profile phone validation', () => {
  it('rejects non-phone text for phone and guardianPhone, and stores nothing', async () => {
    const sa = await as(ctx, 'super.admin');
    const before = (await ctx.prisma.user.findFirstOrThrow({ where: { email: { contains: 'super.admin' } } })).phone;
    for (const body of [{ phone: 'abc' }, { phone: '12' }, { phone: '<script>' }, { guardianPhone: 'abc' }]) {
      const r = await sa.patch('/auth/profile', body); expect(r.status, JSON.stringify(body)).toBe(400);
    }
    expect((await ctx.prisma.user.findFirstOrThrow({ where: { email: { contains: 'super.admin' } } })).phone).toBe(before);
  });
  it('accepts valid formats and an empty value (clearing)', async () => {
    const sa = await as(ctx, 'super.admin');
    expect((await sa.patch('/auth/profile', { phone: '+92 300 1234567' })).status).toBe(200);
    expect((await sa.patch('/auth/profile', { phone: '' })).status).toBe(200);
  });
});
