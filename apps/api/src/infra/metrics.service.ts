import { Injectable } from '@nestjs/common';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { HEARTBEAT_STALE_SECONDS } from '@oes/shared';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';

/**
 * Minimal Prometheus registry (text exposition format 0.0.4) — no third-party dependency.
 * Label sets are deliberately bounded: HTTP routes use the route PATTERN (never the raw URL, never ids).
 */
type Labels = Record<string, string>;
const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
const fmt = (n: number) => (Number.isFinite(n) ? String(n) : n > 0 ? '+Inf' : n < 0 ? '-Inf' : 'NaN');
const lbl = (names: string[], l: Labels, extra = '') => { const parts = names.map((n) => `${n}="${esc(l[n] ?? '')}"`); if (extra) parts.push(extra); return parts.length ? `{${parts.join(',')}}` : ''; };

class Counter {
  private v = new Map<string, { l: Labels; n: number }>();
  constructor(readonly name: string, readonly help: string, readonly labels: string[] = []) {}
  inc(l: Labels = {}, by = 1) { const k = this.labels.map((n) => l[n] ?? '').join('\u0000'); const c = this.v.get(k); if (c) c.n += by; else this.v.set(k, { l, n: by }); }
  value(l: Labels = {}) { return this.v.get(this.labels.map((n) => l[n] ?? '').join('\u0000'))?.n ?? 0; }
  render() { const o = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`]; if (!this.v.size && !this.labels.length) o.push(`${this.name} 0`); for (const { l, n } of this.v.values()) o.push(`${this.name}${lbl(this.labels, l)} ${fmt(n)}`); return o; }
}
class Histogram {
  private v = new Map<string, { l: Labels; b: number[]; sum: number; n: number }>();
  constructor(readonly name: string, readonly help: string, readonly buckets: number[], readonly labels: string[] = []) {}
  observe(l: Labels, seconds: number) {
    const k = this.labels.map((n) => l[n] ?? '').join('\u0000'); let h = this.v.get(k);
    if (!h) { h = { l, b: this.buckets.map(() => 0), sum: 0, n: 0 }; this.v.set(k, h); }
    h.n++; h.sum += seconds; this.buckets.forEach((u, i) => { if (seconds <= u) h!.b[i]!++; });
  }
  count(l: Labels = {}) { return this.v.get(this.labels.map((n) => l[n] ?? '').join('\u0000'))?.n ?? 0; }
  render() {
    const o = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    for (const h of this.v.values()) { this.buckets.forEach((u, i) => o.push(`${this.name}_bucket${lbl(this.labels, h.l, `le="${u}"`)} ${h.b[i]}`)); o.push(`${this.name}_bucket${lbl(this.labels, h.l, 'le="+Inf"')} ${h.n}`, `${this.name}_sum${lbl(this.labels, h.l)} ${h.sum}`, `${this.name}_count${lbl(this.labels, h.l)} ${h.n}`); }
    return o;
  }
}
class Gauge {
  private v = new Map<string, { l: Labels; n: number }>();
  constructor(readonly name: string, readonly help: string, readonly labels: string[] = []) {}
  reset() { this.v.clear(); }
  set(l: Labels, n: number) { this.v.set(this.labels.map((x) => l[x] ?? '').join('\u0000'), { l, n }); }
  render() { const o = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} gauge`]; for (const { l, n } of this.v.values()) o.push(`${this.name}${lbl(this.labels, l)} ${fmt(n)}`); return o; }
}

const LAT = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

@Injectable()
export class MetricsService {
  readonly http = new Counter('oes_http_requests_total', 'HTTP requests by method, route pattern and status', ['method', 'route', 'status']);
  readonly httpDuration = new Histogram('oes_http_request_duration_seconds', 'HTTP request duration', LAT, ['method', 'route']);
  readonly saves = new Counter('oes_answer_save_total', 'Answer save outcomes (ok = durably committed and acknowledged)', ['result']);
  readonly saveDuration = new Histogram('oes_answer_save_duration_seconds', 'Answer save latency (acknowledged or rejected)', LAT);
  readonly submits = new Counter('oes_submit_total', 'Final submission outcomes', ['result']);
  readonly submitDuration = new Histogram('oes_submit_duration_seconds', 'Final submission latency', LAT);
  readonly dbErrors = new Counter('oes_db_errors_total', 'Database-related errors that surfaced as 5xx', ['kind']);
  readonly authFailures = new Counter('oes_auth_failures_total', 'Authentication failures', ['kind']);
  readonly authSuccess = new Counter('oes_auth_success_total', 'Successful authentications', ['kind']);
  readonly unauthorized = new Counter('oes_unauthorized_requests_total', 'Requests rejected as unauthenticated (401) or forbidden (403)', ['status', 'code']);
  readonly unhandled = new Counter('oes_unhandled_errors_total', 'Unexpected server errors (HTTP 500)');
  private readonly dbUp = new Gauge('oes_db_up', '1 if PostgreSQL answered a probe on this scrape');
  private readonly redisUp = new Gauge('oes_redis_up', '1 if Redis answered a probe on this scrape');
  private readonly active = new Gauge('oes_active_attempts', 'Attempts currently IN_PROGRESS');
  private readonly campus = new Gauge('oes_campus_candidates', 'In-progress candidates per campus by connectivity (heartbeat within the stale window)', ['institution', 'state']);
  private readonly loopLag = new Gauge('oes_event_loop_lag_seconds', 'p99 event-loop delay since last scrape');
  private readonly rss = new Gauge('oes_process_resident_memory_bytes', 'Resident set size');
  private readonly started = new Gauge('oes_process_start_time_seconds', 'Process start time (unix)');
  private readonly all = [this.http, this.httpDuration, this.saves, this.saveDuration, this.submits, this.submitDuration, this.dbErrors, this.authFailures, this.authSuccess, this.unauthorized, this.unhandled, this.dbUp, this.redisUp, this.active, this.campus, this.loopLag, this.rss, this.started];
  private readonly lag: ReturnType<typeof monitorEventLoopDelay> = monitorEventLoopDelay({ resolution: 20 });
  private campusAt = 0;

  constructor(private readonly prisma: PrismaService, private readonly redis: RedisService) { this.lag.enable(); this.started.set({}, Math.floor(Date.now() / 1000 - process.uptime())); }

  // ── recording helpers ──
  /** Maps a save/submit exception to a bounded outcome label. */
  static outcome(e: unknown): string {
    const code = (e as { code?: string })?.code; const status = typeof (e as { getStatus?: () => number })?.getStatus === 'function' ? (e as { getStatus: () => number }).getStatus() : 0;
    if (status >= 400 && status < 500) return ({ STALE_REVISION: 'stale', SESSION_SUPERSEDED: 'superseded', TIME_EXPIRED: 'expired', ATTEMPT_CLOSED: 'closed', RATE_LIMITED: 'rate_limited', ANSWERS_OUT_OF_SYNC: 'out_of_sync' } as Record<string, string>)[code ?? ''] ?? 'rejected';
    return 'error';
  }
  /** Classifies non-HTTP exceptions; database problems get their own counter so they can page. */
  recordUnhandled(e: unknown) {
    const x = e as { name?: string; code?: string; message?: string }; const text = `${x?.name ?? ''} ${x?.code ?? ''} ${x?.message ?? ''}`;
    if (/Prisma|DriverAdapter|ECONNREFUSED|ECONNRESET|ETIMEDOUT|terminating connection|connection (terminated|refused|closed)|pool|57P0|08006|08001/i.test(text)) this.dbErrors.inc({ kind: /ECONN|terminat|refused|closed|57P0|0800|P100|timeout|ETIMEDOUT|pool/i.test(text) ? 'connection' : 'query' });
    this.unhandled.inc();
  }

  // ── scrape-time gauges ──
  private async probeAndCollect(force = false) {
    this.dbUp.reset(); this.redisUp.reset(); this.active.reset(); this.loopLag.reset(); this.rss.reset();
    this.loopLag.set({}, this.lag.percentile(99) / 1e9); this.lag.reset(); this.rss.set({}, process.memoryUsage().rss);
    let db = true; try { await this.prisma.$queryRaw`SELECT 1`; } catch { db = false; }
    this.dbUp.set({}, db ? 1 : 0);
    let rd = true; try { await this.redis.client.ping(); } catch { rd = false; }
    this.redisUp.set({}, rd ? 1 : 0);
    if (!db || (!force && Date.now() - this.campusAt < 15_000)) return; // campus view is cached 15 s (it reads every in-progress attempt)
    this.campusAt = Date.now();
    const rows = await this.prisma.$queryRaw<{ id: string; examId: string; inst: string; startedAt: Date }[]>`
      SELECT a.id, a."examId", i.code AS inst, a."startedAt" FROM attempts a JOIN students s ON s.id = a."studentId" JOIN institutions i ON i.id = s."institutionId" WHERE a.status = 'IN_PROGRESS'`.catch(() => null);
    if (!rows) return;
    this.active.set({}, rows.length); this.campus.reset();
    if (!rd) return; // without Redis heartbeats connectivity is unknown — emit nothing rather than a false alarm
    const now = Date.now(); const hb = new Map<string, Record<string, string>>();
    for (const examId of new Set(rows.map((r) => r.examId))) { try { hb.set(examId, await this.redis.client.hgetall(`hb:${examId}`)); } catch { return; } }
    const tally = new Map<string, { c: number; d: number }>();
    for (const r of rows) {
      const raw = hb.get(r.examId)?.[r.id]; let connected = false;
      if (raw) { try { const j = JSON.parse(raw) as { t: number; online?: boolean }; connected = now - j.t <= HEARTBEAT_STALE_SECONDS * 1000 && j.online !== false; } catch { /* corrupt entry ⇒ disconnected */ } }
      else if (now - r.startedAt.getTime() < 60_000) connected = true; // just started: first heartbeat not due yet
      const t = tally.get(r.inst) ?? { c: 0, d: 0 }; if (connected) t.c++; else t.d++; tally.set(r.inst, t);
    }
    for (const [inst, t] of tally) { this.campus.set({ institution: inst, state: 'connected' }, t.c); this.campus.set({ institution: inst, state: 'disconnected' }, t.d); }
  }

  async render(opts: { forceCampus?: boolean } = {}): Promise<string> {
    await this.probeAndCollect(opts.forceCampus);
    return this.all.flatMap((m) => m.render()).join('\n') + '\n';
  }
}
