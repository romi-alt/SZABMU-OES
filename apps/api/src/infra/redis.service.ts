import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { CONFIG, type Config } from '../config';

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;
  /** Circuit breaker: after a failure, skip Redis for a short time so an outage costs microseconds, not seconds per call. */
  private downUntil = 0;
  constructor(@Inject(CONFIG) cfg: Config) {
    // Redis is a cache/coordination layer only (answers live in PostgreSQL). It must never slow the exam path when it is down:
    // no offline queue (commands fail immediately while disconnected), a hard per-command timeout, and fast reconnects.
    this.client = new Redis(cfg.REDIS_URL, { maxRetriesPerRequest: 1, enableOfflineQueue: false, commandTimeout: 500, connectTimeout: 2000, retryStrategy: (n) => Math.min(n * 200, 2000), lazyConnect: false });
    this.client.on('error', () => undefined);
  }
  /** False while the breaker is open (Redis recently failed). */
  get available() { return Date.now() >= this.downUntil; }
  private async safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
    if (!this.available) return fallback;
    try { return await fn(); } catch { this.downUntil = Date.now() + 3000; return fallback; }
  }
  async onModuleDestroy() {
    this.client.disconnect();
  }
  /** Fixed-window counter. Returns the count after increment. Fails open (returns 0) if Redis is unavailable. */
  hit(key: string, windowSec: number): Promise<number> {
    return this.safe(async () => { const n = await this.client.incr(key); if (n === 1) await this.client.expire(key, windowSec); return n; }, 0);
  }
  getJson<T>(key: string): Promise<T | null> {
    return this.safe(async () => { const v = await this.client.get(key); return v ? (JSON.parse(v) as T) : null; }, null);
  }
  async setJson(key: string, value: unknown, ttlSec: number): Promise<void> {
    await this.safe(async () => { await this.client.set(key, JSON.stringify(value), 'EX', ttlSec); }, undefined);
  }
  async del(...keys: string[]): Promise<void> {
    await this.safe(async () => { if (keys.length) await this.client.del(...keys); }, undefined);
  }
}
