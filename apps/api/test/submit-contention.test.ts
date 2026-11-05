import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { Client, boot, save, startExam, type Ctx } from './helpers';
import { sha256 } from '../src/common/auth';
import { DOMAIN } from '../src/seed/seed';
import { MetricsService } from '../src/infra/metrics.service';

/**
 * Regression for the 5,000-candidate run: during the submit wave, final submissions failed with HTTP 500
 * "Unable to start a transaction in the given time" because each seal held a pooled connection across many round
 * trips and Prisma gives up waiting for a connection after 2 s. Reproduced deterministically with a tiny pool and a
 * realistic per-seal delay (a trigger that sleeps while the attempt row is updated).
 */
let ctx: Ctx;
const CANDIDATES = 80;
beforeAll(async () => { process.env.DB_POOL_MAX = '3'; ctx = await boot({ studentsPerCampus: CANDIDATES / 2 + 1 }); });
afterAll(async () => {
  await ctx.prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS slow_seal_t`).catch(() => undefined);
  await ctx.app.close(); delete process.env.DB_POOL_MAX;
});

describe('submit wave under connection pressure', () => {
  it(`${CANDIDATES} simultaneous final submissions with a 3-connection pool all succeed (none 500), every attempt is sealed once`, async () => {
    const students: string[] = [];
    for (const campus of ['a', 'b']) for (let i = 2; i <= CANDIDATES / 2 + 1; i++) students.push(`student.${campus}${String(i).padStart(3, '0')}`);
    const sessions = await Promise.all(students.map(async (local) => {
      // sessions are minted directly: 80 logins from one IP would (correctly) trip the login rate limiter
      const user = await ctx.prisma.user.findFirstOrThrow({ where: { email: `${local}@${DOMAIN}` } }); const token = randomBytes(32).toString('base64url');
      await ctx.prisma.session.create({ data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 3600_000) } });
      const s = new Client(ctx.app, local); s.cookie = `oes_session=${token}`; const t = await startExam(ctx, s);
      expect((await save(s, t.attemptId, t.questions[0]!.id, t.clientId, 1, 'A')).status).toBe(200);
      return { s, t };
    }));
    // every seal now takes ≥ 80 ms inside its transaction (stands in for a loaded database)
    await ctx.prisma.$executeRawUnsafe(`CREATE TRIGGER slow_seal_t BEFORE UPDATE ON attempts FOR EACH ROW BEGIN IF OLD.status = 'IN_PROGRESS' AND NEW.status <> OLD.status THEN DO SLEEP(0.08); END IF; END`);
    const t0 = Date.now();
    const res = await Promise.all(sessions.map(({ s, t }, i) => s.post(`/attempts/${t.attemptId}/submit`, { clientId: t.clientId, submitKey: `contention-${i}-xxxx` })));
    const ms = Date.now() - t0;
    const failed = res.filter((r) => r.status !== 200);
    expect(failed.map((r) => `${r.status} ${r.body?.code}`), `wave took ${ms} ms`).toEqual([]);
    expect(new Set(res.map((r) => r.body.receiptCode)).size).toBe(CANDIDATES);
    const sealed = await ctx.prisma.attempt.count({ where: { status: 'SUBMITTED' } });
    expect(sealed).toBe(CANDIDATES);
    expect(ctx.app.get(MetricsService).submits.value({ result: 'error' })).toBe(0);
    console.log(`[submit wave] ${CANDIDATES} seals through a 3-connection pool in ${ms} ms, 0 errors`);
  }, 120_000);
});
