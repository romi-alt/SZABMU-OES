import { Injectable, OnModuleDestroy } from '@nestjs/common';

interface Entry { v: string; exp: number }

/**
 * In-process TTL cache and fixed-window counters. Replaces Redis for the web-hosting deployment (single Node process).
 *
 * Nothing correctness-critical lives here: answers, sessions, mail and password-reset tokens are in the database.
 * What does live here is best-effort and bounded:
 *   - rate-limit counters (login / forgot / save / verify). Account lockout is also enforced in the database, so a restart
 *     only resets the short-window throttles;
 *   - the authenticated-session cache (short TTL, explicitly invalidated on logout, deactivation, password reset, scope change);
 *   - the approved exam paper, which is immutable.
 * With more than one process each keeps its own copy, so a revoked session may stay valid for up to SESSION_TTL_SEC elsewhere.
 */
@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly m = new Map<string, Entry>();
  private readonly userSessions = new Map<string, Set<string>>();
  private readonly timer: NodeJS.Timeout;
  static readonly MAX_ENTRIES = 50_000;

  constructor() {
    this.timer = setInterval(() => this.prune(), 30_000);
    this.timer.unref();
  }
  onModuleDestroy() { clearInterval(this.timer); }

  private prune() {
    const now = Date.now();
    for (const [k, e] of this.m) if (e.exp <= now) this.m.delete(k);
    while (this.m.size > CacheService.MAX_ENTRIES) { const first = this.m.keys().next().value; if (first === undefined) break; this.m.delete(first); }
  }
  private read(key: string): Entry | undefined {
    const e = this.m.get(key);
    if (e && e.exp <= Date.now()) { this.m.delete(key); return undefined; }
    return e;
  }

  /** Fixed-window counter. Returns the count after increment. */
  async hit(key: string, windowSec: number): Promise<number> {
    const e = this.read(key);
    if (!e) { this.m.set(key, { v: '1', exp: Date.now() + windowSec * 1000 }); return 1; }
    const n = Number(e.v) + 1; e.v = String(n); return n;
  }
  async getJson<T>(key: string): Promise<T | null> {
    const e = this.read(key);
    return e ? (JSON.parse(e.v) as T) : null;
  }
  async setJson(key: string, value: unknown, ttlSec: number): Promise<void> {
    this.m.set(key, { v: JSON.stringify(value), exp: Date.now() + ttlSec * 1000 });
  }
  async del(...keys: string[]): Promise<void> { for (const k of keys) this.m.delete(k); }

  /** Remember which cached sessions belong to a user so they can all be dropped at once. */
  trackSession(userId: string, hash: string) {
    let s = this.userSessions.get(userId); if (!s) { s = new Set(); this.userSessions.set(userId, s); }
    s.add(hash);
  }
  async dropUserSessions(userId: string): Promise<void> {
    const s = this.userSessions.get(userId);
    if (s) { for (const h of s) this.m.delete(`sess:${h}`); this.userSessions.delete(userId); }
  }
  /** Test hook: forget everything. */
  clear() { this.m.clear(); this.userSessions.clear(); }
}
