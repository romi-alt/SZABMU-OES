/**
 * Fixed-window counter held in process memory. For ABUSE GUARDS only (e.g. "a human cannot save 100 answers in 10 s"): it costs no network
 * round trip, so the hot path pays nothing. It is per API process (a client spread over N processes may reach N× the limit) and resets on
 * restart; security-relevant limits (login, password reset) stay in Redis where they are shared across processes.
 */
export class LocalRateWindow {
  private readonly m = new Map<string, { n: number; end: number }>(); private sweptAt = 0;
  constructor(private readonly windowMs: number, private readonly maxKeys = 50_000) {}
  /** Registers one hit and returns the count within the current window. */
  hit(key: string, now = Date.now()): number {
    const e = this.m.get(key);
    if (e && e.end > now) return ++e.n;
    if (this.m.size >= this.maxKeys || now - this.sweptAt > this.windowMs) this.sweep(now);
    this.m.set(key, { n: 1, end: now + this.windowMs });
    return 1;
  }
  private sweep(now: number) { this.sweptAt = now; for (const [k, v] of this.m) if (v.end <= now) this.m.delete(k); }
  get size() { return this.m.size; }
}
