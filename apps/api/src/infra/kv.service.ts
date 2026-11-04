import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { createHash } from 'node:crypto';
import Redis from 'ioredis';
import { CONFIG, type Config } from '../config';
import { PrismaService } from './prisma.service';
import { int, retryOnDeadlock } from './sql';

/** Where short-lived coordination state lives: Redis when REDIS_URL is set, otherwise the application database. */
export type KvBackend = 'redis' | 'database';
export interface Beat { t: number; online: boolean }

const hbKey = (examId: string) => `hb:${examId}`;
const hbzKey = (examId: string, inst?: string) => (inst ? `hbz:${examId}:${inst}` : `hbz:${examId}`);
const HB_TTL_SEC = 86_400;
const SET_MEMBER_TTL_SEC = 86_400;
/** kv_entries.k is VARCHAR(191); longer keys are stored under a digest (deterministic, so lookups still match). */
const dbKey = (k: string) => (k.length <= 191 ? k : `#${createHash('sha256').update(k).digest('hex')}`);
const memberKey = (setKey: string, member: string) => dbKey(`${setKey}\u001f${member}`);

/**
 * Short-lived coordination state: rate-limit windows, e-mail verification codes, password-reset tokens, the session and paper caches,
 * and candidate heartbeats. Nothing here is the system of record (answers, results and accounts live in the database), so a lost entry
 * costs a cache miss, a resent code or an "unknown" connection state, never data.
 *
 * Two interchangeable backends:
 *  • redis    (REDIS_URL set): the original layout (strings, sets, hashes, sorted sets).
 *  • database (REDIS_URL unset): `kv_entries` + `attempt_heartbeats` in the application database, expiry compared with the database
 *    clock and swept every minute. Correct across several API processes, because every process reads the same rows.
 */
@Injectable()
export class KvService implements OnModuleDestroy {
  private readonly log = new Logger('Kv');
  readonly backend: KvBackend;
  private readonly redis?: Redis;
  private sweeper?: NodeJS.Timeout;
  /** Circuit breaker: after a failure, skip the store for a short time so an outage costs microseconds, not seconds per call. */
  private downUntil = 0;

  constructor(@Inject(CONFIG) cfg: Config, private readonly prisma: PrismaService) {
    if (cfg.REDIS_URL) {
      this.backend = 'redis';
      // It must never slow the exam path when it is down: no offline queue (commands fail immediately while disconnected), a hard
      // per-command timeout, and fast reconnects.
      this.redis = new Redis(cfg.REDIS_URL, { maxRetriesPerRequest: 1, enableOfflineQueue: false, commandTimeout: 500, connectTimeout: 2000, retryStrategy: (n) => Math.min(n * 200, 2000), lazyConnect: false });
      this.redis.on('error', () => undefined);
    } else {
      this.backend = 'database';
      this.sweeper = setInterval(() => { void this.sweep(); }, 60_000); this.sweeper.unref();
    }
  }

  /** False while the breaker is open (the store recently failed). */
  get available() { return Date.now() >= this.downUntil; }
  private async safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
    if (!this.available) return fallback;
    // Only Redis trips the breaker: it protects requests from a separate, possibly dead service. On the database backend the store IS the
    // database the request needs anyway, and tripping would switch off rate limits (fail open) for every caller after one transient error.
    try { return await fn(); } catch { if (this.redis) this.downUntil = Date.now() + 3000; return fallback; }
  }
  async onModuleDestroy() {
    if (this.sweeper) clearInterval(this.sweeper);
    this.redis?.disconnect();
  }

  async ping(): Promise<boolean> {
    try { if (this.redis) await this.redis.ping(); else await this.prisma.$queryRaw`SELECT 1`; return true; } catch { return false; }
  }

  /** Redis pub/sub. Only meaningful on the redis backend (the database backend dispatches in process; see ExamEventsService). */
  async publish(channel: string, message: string): Promise<void> {
    if (!this.redis) throw new Error('publish requires the redis backend');
    await this.redis.publish(channel, message);
  }

  // ───────────── counters ─────────────
  /** Fixed-window counter. Returns the count after increment. Fails open (returns 0) if the store is unavailable. */
  hit(key: string, windowSec: number): Promise<number> {
    return this.safe(async () => {
      if (this.redis) { const n = await this.redis.incr(key); if (n === 1) await this.redis.expire(key, windowSec); return n; }
      const k = dbKey(key);
      // Assignments run left to right: `n` is decided while "expiresAt" still holds the old value, then the window is renewed if it had lapsed.
      // The upsert locks the row, so the read in the same transaction sees this request's count. Concurrent first hits on a new key can
      // deadlock on the duplicate-key check (InnoDB); the loser is rolled back whole and simply re-run.
      const [, rows] = await retryOnDeadlock(() => this.prisma.$transaction([
        this.prisma.$executeRaw`INSERT INTO kv_entries (k, n, "expiresAt") VALUES (${k}, 1, NOW(3) + INTERVAL ${windowSec} SECOND)
          ON DUPLICATE KEY UPDATE n = IF("expiresAt" <= NOW(3), 1, n + 1), v = IF("expiresAt" <= NOW(3), NULL, v),
                                  "expiresAt" = IF("expiresAt" <= NOW(3), NOW(3) + INTERVAL ${windowSec} SECOND, "expiresAt")`,
        this.prisma.$queryRaw<{ n: number | bigint }[]>`SELECT n FROM kv_entries WHERE k = ${k}`,
      ]), 5);
      return int(rows[0]?.n ?? 0);
    }, 0);
  }

  // ───────────── values ─────────────
  /** Stored value, or null when missing or expired. Throws if the store is unreachable (callers that hold state must know). */
  async getText(key: string): Promise<string | null> {
    if (this.redis) return this.redis.get(key);
    const r = await this.prisma.$queryRaw<{ v: string | null }[]>`SELECT v FROM kv_entries WHERE k = ${dbKey(key)} AND "expiresAt" > NOW(3)`;
    return r[0]?.v ?? null;
  }
  async setText(key: string, value: string, ttlSec: number): Promise<void> {
    if (this.redis) { await this.redis.set(key, value, 'EX', ttlSec); return; }
    await this.prisma.$executeRaw`INSERT INTO kv_entries (k, v, n, "expiresAt") VALUES (${dbKey(key)}, ${value}, 0, NOW(3) + INTERVAL ${ttlSec} SECOND)
      ON DUPLICATE KEY UPDATE v = ${value}, n = 0, grp = NULL, "expiresAt" = NOW(3) + INTERVAL ${ttlSec} SECOND`;
  }
  /** Remaining lifetime in whole seconds; -2 when the key is missing or expired (Redis TTL semantics). */
  async ttl(key: string): Promise<number> {
    if (this.redis) return this.redis.ttl(key);
    const r = await this.prisma.$queryRaw<{ s: number | bigint }[]>`SELECT TIMESTAMPDIFF(SECOND, NOW(3), "expiresAt") AS s FROM kv_entries WHERE k = ${dbKey(key)} AND "expiresAt" > NOW(3)`;
    return r[0] ? int(r[0].s) : -2;
  }
  /** Reads and deletes atomically (single use: a second caller gets null). */
  async take(key: string): Promise<string | null> {
    if (this.redis) return this.redis.getdel(key);
    const k = dbKey(key);
    return this.prisma.$transaction(async (tx) => {
      const r = await tx.$queryRaw<{ v: string | null; live: number | bigint }[]>`SELECT v, ("expiresAt" > NOW(3)) AS live FROM kv_entries WHERE k = ${k} FOR UPDATE`;
      if (!r[0]) return null;
      await tx.$executeRaw`DELETE FROM kv_entries WHERE k = ${k}`;
      return int(r[0].live) ? r[0].v : null;
    });
  }

  // ───────────── caches (fail soft) ─────────────
  getJson<T>(key: string): Promise<T | null> {
    return this.safe(async () => { const v = await this.getText(key); return v ? (JSON.parse(v) as T) : null; }, null);
  }
  async setJson(key: string, value: unknown, ttlSec: number): Promise<void> {
    await this.safe(() => this.setText(key, JSON.stringify(value), ttlSec), undefined);
  }
  async del(...keys: string[]): Promise<void> {
    if (!keys.length) return;
    await this.safe(async () => {
      if (this.redis) await this.redis.del(...keys);
      else await this.prisma.kvEntry.deleteMany({ where: { k: { in: keys.map(dbKey) } } });
    }, undefined);
  }

  // ───────────── sets ─────────────
  async addToSet(setKey: string, member: string): Promise<void> {
    await this.safe(async () => {
      if (this.redis) { await this.redis.sadd(setKey, member); return; }
      await this.prisma.$executeRaw`INSERT INTO kv_entries (k, grp, v, n, "expiresAt") VALUES (${memberKey(setKey, member)}, ${dbKey(setKey)}, ${member}, 0, NOW(3) + INTERVAL ${SET_MEMBER_TTL_SEC} SECOND)
        ON DUPLICATE KEY UPDATE "expiresAt" = NOW(3) + INTERVAL ${SET_MEMBER_TTL_SEC} SECOND`;
    }, undefined);
  }
  /** Members of a set. Throws if the store is unreachable. */
  async members(setKey: string): Promise<string[]> {
    if (this.redis) return this.redis.smembers(setKey);
    const r = await this.prisma.$queryRaw<{ v: string }[]>`SELECT v FROM kv_entries WHERE grp = ${dbKey(setKey)} AND "expiresAt" > NOW(3)`;
    return r.map((x) => x.v);
  }
  async dropSet(setKey: string): Promise<void> {
    await this.safe(async () => {
      if (this.redis) await this.redis.del(setKey);
      else await this.prisma.kvEntry.deleteMany({ where: { grp: dbKey(setKey) } });
    }, undefined);
  }

  // ───────────── candidate heartbeats ─────────────
  /** Throws on failure; the caller treats heartbeats as coordination only. */
  async recordHeartbeat(examId: string, institutionId: string, attemptId: string, t: number, online: boolean): Promise<void> {
    if (this.redis) {
      await this.redis.pipeline().hset(hbKey(examId), attemptId, JSON.stringify({ t, online })).expire(hbKey(examId), HB_TTL_SEC)
        .zadd(hbzKey(examId), t, attemptId).expire(hbzKey(examId), HB_TTL_SEC).zadd(hbzKey(examId, institutionId), t, attemptId).expire(hbzKey(examId, institutionId), HB_TTL_SEC).exec();
      return;
    }
    await this.prisma.$executeRaw`INSERT INTO attempt_heartbeats ("attemptId", "examId", "institutionId", t, online) VALUES (${attemptId}, ${examId}, ${institutionId}, ${t}, ${online})
      ON DUPLICATE KEY UPDATE t = ${t}, online = ${online}, "institutionId" = ${institutionId}`;
  }
  /** Candidates per campus with a heartbeat at or after `sinceMs`. Null when the store is unavailable (state unknown, never guessed). */
  async onlineByCampus(examId: string, institutionIds: string[], sinceMs: number): Promise<Map<string, number> | null> {
    if (!this.available) return null;
    try {
      if (this.redis) {
        const p = this.redis.pipeline(); for (const id of institutionIds) p.zcount(hbzKey(examId, id), sinceMs, '+inf');
        const res = await p.exec();
        return res && res.every(([e]) => !e) ? new Map(institutionIds.map((id, i) => [id, Number(res[i]![1])])) : null;
      }
      const rows = await this.prisma.attemptHeartbeat.groupBy({ by: ['institutionId'], where: { examId, t: { gte: BigInt(sinceMs) } }, _count: { _all: true } });
      const n = new Map(rows.map((r) => [r.institutionId, r._count._all]));
      return new Map(institutionIds.map((id) => [id, n.get(id) ?? 0]));
    } catch { return null; }
  }
  /** Last heartbeat time (ms) per attempt, null where none was recorded. Null when the store is unavailable. */
  async lastBeats(examId: string, attemptIds: string[]): Promise<(number | null)[] | null> {
    if (!this.available) return null;
    try {
      if (this.redis) {
        const p = this.redis.pipeline(); for (const id of attemptIds) p.zscore(hbzKey(examId), id);
        const res = await p.exec();
        return res && res.every(([e]) => !e) ? res.map(([, v]) => (v == null ? null : Number(v))) : null;
      }
      const rows = await this.prisma.attemptHeartbeat.findMany({ where: { examId, attemptId: { in: attemptIds } }, select: { attemptId: true, t: true } });
      const t = new Map(rows.map((r) => [r.attemptId, Number(r.t)]));
      return attemptIds.map((id) => t.get(id) ?? null);
    } catch { return null; }
  }
  /** Every heartbeat recorded for an exam. Throws if the store is unreachable. */
  async beatsOf(examId: string): Promise<Map<string, Beat>> {
    const out = new Map<string, Beat>();
    if (this.redis) {
      for (const [id, raw] of Object.entries(await this.redis.hgetall(hbKey(examId)))) {
        try { const j = JSON.parse(raw) as { t: number; online?: boolean }; out.set(id, { t: j.t, online: j.online !== false }); } catch { /* corrupt entry ⇒ treated as absent */ }
      }
      return out;
    }
    for (const r of await this.prisma.attemptHeartbeat.findMany({ where: { examId }, select: { attemptId: true, t: true, online: true } })) out.set(r.attemptId, { t: Number(r.t), online: r.online });
    return out;
  }

  // ───────────── maintenance ─────────────
  /** Database backend: removes expired entries and day-old heartbeats in small batches (expiry is also checked on every read). */
  private async sweep() {
    try {
      await this.prisma.$executeRaw`DELETE FROM kv_entries WHERE "expiresAt" < NOW(3) LIMIT 1000`;
      await this.prisma.$executeRaw`DELETE FROM attempt_heartbeats WHERE t < ${Date.now() - HB_TTL_SEC * 1000} LIMIT 1000`;
    } catch (e) { this.log.warn(`expiry sweep failed: ${(e as Error).message}`); }
  }
  /** Tests and operators only: forget all coordination state. */
  async flushAll() {
    if (this.redis) { await this.redis.flushdb(); return; }
    await this.prisma.kvEntry.deleteMany({}); await this.prisma.attemptHeartbeat.deleteMany({});
  }
  /** Tests and operators only: delete every entry whose key starts with `prefix` (e.g. 'rl:reg:' to reset registration rate limits). */
  async clearPrefix(prefix: string) {
    if (this.redis) { const k = await this.redis.keys(`${prefix}*`); if (k.length) await this.redis.del(...k); return; }
    await this.prisma.$executeRaw`DELETE FROM kv_entries WHERE k LIKE ${prefix.replace(/[%_\\]/g, '\\$&') + '%'}`;
  }
}
