import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { CONFIG, type Config } from '../config';

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;
  constructor(@Inject(CONFIG) cfg: Config) {
    this.client = new Redis(cfg.REDIS_URL, { maxRetriesPerRequest: 2, lazyConnect: false });
    this.client.on('error', () => undefined);
  }
  async onModuleDestroy() {
    this.client.disconnect();
  }
  /** Fixed-window counter. Returns the count after increment. Fails open if Redis is unavailable. */
  async hit(key: string, windowSec: number): Promise<number> {
    try {
      const n = await this.client.incr(key);
      if (n === 1) await this.client.expire(key, windowSec);
      return n;
    } catch {
      return 0;
    }
  }
  async getJson<T>(key: string): Promise<T | null> {
    try {
      const v = await this.client.get(key);
      return v ? (JSON.parse(v) as T) : null;
    } catch {
      return null;
    }
  }
  async setJson(key: string, value: unknown, ttlSec: number): Promise<void> {
    try {
      await this.client.set(key, JSON.stringify(value), 'EX', ttlSec);
    } catch {
      /* cache only */
    }
  }
  async del(...keys: string[]): Promise<void> {
    try {
      if (keys.length) await this.client.del(...keys);
    } catch {
      /* cache only */
    }
  }
}
