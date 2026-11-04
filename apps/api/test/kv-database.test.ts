import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Config } from '../src/config';
import { KvService } from '../src/infra/kv.service';
import { PrismaService } from '../src/infra/prisma.service';
import { boot, type Ctx } from './helpers';

/**
 * The database backend of the coordination store (REDIS_URL unset, as on Hostinger). Built explicitly here, so it is exercised whichever
 * backend the rest of the suite runs on.
 */
let ctx: Ctx; let kv: KvService; let prisma: PrismaService;
beforeAll(async () => { ctx = await boot({ studentsPerCampus: 1 }); prisma = ctx.prisma; kv = new KvService({ REDIS_URL: undefined } as Config, prisma); });
afterAll(async () => { await kv.onModuleDestroy(); await ctx?.app.close(); });
beforeEach(async () => { await kv.flushAll(); });
const expire = (prefix: string) => prisma.$executeRaw`UPDATE kv_entries SET "expiresAt" = NOW(3) - INTERVAL 1 SECOND WHERE k LIKE ${prefix + '%'}`;

describe('database coordination store', () => {
  it('is the database backend and answers probes', async () => {
    expect(kv.backend).toBe('database'); expect(await kv.ping()).toBe(true);
  });

  it('rate-limit windows count atomically under concurrency and restart after expiry', async () => {
    const counts = await Promise.all(Array.from({ length: 20 }, () => kv.hit('rl:test:ip', 60)));
    expect([...counts].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));   // every request saw a distinct count
    await expire('rl:test:');
    expect(await kv.hit('rl:test:ip', 60)).toBe(1);                                                    // a lapsed window starts again
    expect(await kv.hit('rl:test:other', 60)).toBe(1);
  });

  it('values expire, keep their TTL, and take() is single use', async () => {
    await kv.setText('reg:a@x.test', '{"attempts":0}', 900);
    expect(await kv.getText('reg:a@x.test')).toBe('{"attempts":0}');
    const ttl = await kv.ttl('reg:a@x.test'); expect(ttl).toBeGreaterThan(890); expect(ttl).toBeLessThanOrEqual(900);
    await kv.setText('reg:a@x.test', '{"attempts":1}', ttl);                                           // overwrite keeps the remaining lifetime
    expect(await kv.getText('reg:a@x.test')).toBe('{"attempts":1}');
    await kv.setText('rt:token', 'user-1', 600);
    const [a, b] = await Promise.all([kv.take('rt:token'), kv.take('rt:token')]);
    expect([a, b].filter(Boolean)).toEqual(['user-1']);                                                 // exactly one caller gets it
    await kv.setText('rt:old', 'user-2', 600); await expire('rt:old');
    expect(await kv.getText('rt:old')).toBeNull(); expect(await kv.ttl('rt:old')).toBe(-2); expect(await kv.take('rt:old')).toBeNull();
    expect(await kv.ttl('missing')).toBe(-2);
  });

  it('keys longer than the column are stored by digest and still match', async () => {
    const key = `rl:forgot:${'x'.repeat(240)}@example.test:203.0.113.9`;
    expect(await kv.hit(key, 60)).toBe(1); expect(await kv.hit(key, 60)).toBe(2);
    await kv.setJson(`paper:${'y'.repeat(300)}`, [{ id: 1 }], 60);
    expect(await kv.getJson(`paper:${'y'.repeat(300)}`)).toEqual([{ id: 1 }]);
  });

  it('sets back the session index: members, then drop', async () => {
    await kv.setJson('sess:h1', { id: 'u1' }, 120); await kv.setJson('sess:h2', { id: 'u1' }, 120);
    await kv.addToSet('usess:u1', 'h1'); await kv.addToSet('usess:u1', 'h2'); await kv.addToSet('usess:u1', 'h2');
    expect((await kv.members('usess:u1')).sort()).toEqual(['h1', 'h2']);
    await kv.del(...(await kv.members('usess:u1')).map((h) => `sess:${h}`)); await kv.dropSet('usess:u1');
    expect(await kv.members('usess:u1')).toEqual([]); expect(await kv.getJson('sess:h1')).toBeNull();
  });

  it('heartbeats: per-campus online counts, last beat per attempt, full map', async () => {
    const now = Date.now();
    await kv.recordHeartbeat('ex1', 'campA', 'att1', now, true);
    await kv.recordHeartbeat('ex1', 'campA', 'att2', now - 120_000, true);
    await kv.recordHeartbeat('ex1', 'campB', 'att3', now, false);
    await kv.recordHeartbeat('ex1', 'campB', 'att3', now + 5, false);                                   // upsert, not a second row
    const online = await kv.onlineByCampus('ex1', ['campA', 'campB', 'campC'], now - 45_000);
    expect(Object.fromEntries(online!)).toEqual({ campA: 1, campB: 1, campC: 0 });
    expect(await kv.lastBeats('ex1', ['att1', 'att2', 'nope'])).toEqual([now, now - 120_000, null]);
    const all = await kv.beatsOf('ex1');
    expect(all.size).toBe(3); expect(all.get('att3')).toEqual({ t: now + 5, online: false });
  });

  it('clearPrefix removes only matching keys (treating % and _ literally)', async () => {
    await kv.hit('rl:reg:ip:1', 60); await kv.hit('rl:treg:ip:1', 60); await kv.hit('rl_reg', 60);
    await kv.clearPrefix('rl:reg:');
    expect(await prisma.kvEntry.count()).toBe(2);
  });
});
