import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import type { Prisma } from '../../generated/prisma/client';
import { CONFIG, type Config } from '../../config';
import { MetricsService } from '../../infra/metrics.service';
import { PrismaService } from '../../infra/prisma.service';
import { int, json } from '../../infra/sql';
import { KvService } from '../../infra/kv.service';

export interface ExamEvent { id: number; eventId: string; examId: string; institutionId: string | null; studentId: string | null; version: number; type: string; payload: Record<string, any>; at: string }
export interface EmitSpec { examId: string; version: number; type: string; institutionId?: string | null; studentId?: string | null; payload?: Record<string, unknown> }
/** Who is looking: staff (campus scope or university-wide) or a candidate (own campus + own identity). */
export interface Viewer { institutionIds: string[] | null; student?: { id: string; institutionId: string } }

const CHANNEL = (examId: string) => `oes:exam:${examId}`;
const MAX_RETRIES = 10;

/** Campus/identity scoping of a single event. Used for live fan-out AND for replay, so both paths enforce the same rule. */
export function visibleTo(ev: Pick<ExamEvent, 'institutionId' | 'studentId' | 'payload'>, v: Viewer): boolean {
  if (v.student) {
    if (ev.studentId && ev.studentId !== v.student.id) return false;
    if (ev.institutionId && ev.institutionId !== v.student.institutionId) return false;
    const ids = ev.payload?.studentIds as string[] | undefined;
    return !ids || ids.includes(v.student.id);
  }
  return ev.institutionId === null || v.institutionIds === null || v.institutionIds.includes(ev.institutionId);
}

export interface Subscriber { id: number; examId: string; viewer: Viewer; lastId: number; send: (ev: ExamEvent) => void; close: () => void; /** Staff streams only: aggregate snapshot pushes. */ sendStats?: (payload: unknown) => void; statsKey?: string; statsAt?: number }
interface Stream { subs: Map<number, Subscriber>; polledUpTo: number; nextPoll: number }

const row = (r: { id: bigint; eventId: string; examId: string; institutionId: string | null; studentId: string | null; aggregateVersion: number; type: string; payload: unknown; createdAt: Date }): ExamEvent =>
  ({ id: Number(r.id), eventId: r.eventId, examId: r.examId, institutionId: r.institutionId, studentId: r.studentId, version: r.aggregateVersion, type: r.type, payload: json<Record<string, any>>(r.payload ?? {}), at: r.createdAt.toISOString() });

/**
 * Durable event delivery.
 *  • WRITE: `emit(tx, …)` inserts into `exam_events` in the SAME transaction as the state change (transactional outbox).
 *  • PUBLISH: committed PENDING rows are pushed to Redis pub/sub by `publishPending` (retried, bounded). Duplicates are harmless.
 *    Without Redis (REDIS_URL unset) `publishPending` hands rows straight to this process's streams; other processes see them through the poll.
 *  • READ: SSE subscribers receive Redis messages for low latency AND a database catch-up poll for the exam (slow when Redis is healthy,
 *    fast when it is not), de-duplicated by event id — so losing Redis degrades latency only, never correctness. `replay` serves Last-Event-ID.
 */
@Injectable()
export class ExamEventsService implements OnModuleDestroy {
  private readonly log = new Logger('ExamEvents');
  private readonly streams = new Map<string, Stream>();
  private sub?: Redis; private subReady = false; private seq = 0; private timer?: NodeJS.Timeout;
  /** Hook for the monitor: called each second for exams with subscribers. */
  onTick?: (examId: string, subs: Subscriber[]) => Promise<void>;
  constructor(private readonly prisma: PrismaService, private readonly kv: KvService, private readonly metrics: MetricsService, @Inject(CONFIG) private readonly cfg: Config) {}

  // ───────────── write side ─────────────
  async emit(tx: Prisma.TransactionClient, e: EmitSpec): Promise<number> {
    const r = await tx.$queryRaw<{ id: bigint }[]>`
      INSERT INTO exam_events ("eventId", "examId", "institutionId", "studentId", "aggregateVersion", type, payload)
      VALUES (UUID(), ${e.examId}, ${e.institutionId ?? null}, ${e.studentId ?? null}, ${e.version}, ${e.type}, ${JSON.stringify(e.payload ?? {})}) RETURNING id`;
    return Number(r[0]!.id);
  }

  /** Call after the surrounding transaction committed: pushes new events promptly without blocking the command. */
  nudge() { setImmediate(() => { this.publishPending(200).catch(() => undefined); }); }

  /** Pushes PENDING rows to Redis. Claims rows with SKIP LOCKED so several workers never publish the same row concurrently. */
  async publishPending(limit = 200): Promise<{ published: number; failed: number; pending: number }> {
    if (!this.kv.available) return { published: 0, failed: 0, pending: await this.pendingCount() };
    let published = 0; let failed = 0;
    await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: bigint; eventId: string; examId: string; institutionId: string | null; studentId: string | null; aggregateVersion: number; type: string; payload: unknown; createdAt: Date; retryCount: number }[]>`
        SELECT id, "eventId", "examId", "institutionId", "studentId", "aggregateVersion", type, payload, "createdAt", "retryCount"
        FROM exam_events WHERE "deliveryStatus" = 'PENDING' ORDER BY id LIMIT ${limit} FOR UPDATE SKIP LOCKED`;
      for (const r of rows) {
        try {
          if (this.cfg.REDIS_URL) await this.kv.publish(CHANNEL(r.examId), JSON.stringify(row(r)));
          else this.dispatch(row(r));                         // no Redis: hand to this process's streams; other processes pick it up in their catch-up poll
          await tx.$executeRaw`UPDATE exam_events SET "deliveryStatus" = 'DELIVERED', "deliveredAt" = NOW(3) WHERE id = ${r.id}`;
          published++;
        } catch {
          failed++;
          const exhausted = r.retryCount + 1 >= MAX_RETRIES;
          await tx.$executeRaw`UPDATE exam_events SET "retryCount" = "retryCount" + 1, "deliveryStatus" = ${exhausted ? 'FAILED' : 'PENDING'} WHERE id = ${r.id}`;
        }
      }
    }, { maxWait: 5000, timeout: 20000 });
    if (published) this.metrics.eventsPublished.inc({}, published);
    if (failed) this.metrics.eventsPublishFailed.inc({}, failed);
    return { published, failed, pending: await this.pendingCount() };
  }

  async pendingCount(): Promise<number> {
    return int((await this.prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM exam_events WHERE "deliveryStatus" = 'PENDING'`)[0]!.n);
  }
  async outboxStats(): Promise<{ pending: number; failed: number; oldestPendingSeconds: number | null }> {
    const r = (await this.prisma.$queryRaw<{ pending: bigint; failed: bigint; oldest: number | null }[]>`
      SELECT COUNT(CASE WHEN "deliveryStatus" = 'PENDING' THEN 1 END) AS pending, COUNT(CASE WHEN "deliveryStatus" = 'FAILED' THEN 1 END) AS failed,
             TIMESTAMPDIFF(MICROSECOND, MIN(CASE WHEN "deliveryStatus" = 'PENDING' THEN "createdAt" END), NOW(3)) / 1e6 AS oldest
      FROM exam_events WHERE "deliveryStatus" <> 'DELIVERED'`)[0]!;
    return { pending: int(r.pending), failed: int(r.failed), oldestPendingSeconds: r.oldest === null ? null : Number(r.oldest) };
  }

  // ───────────── read side ─────────────
  /** Events after a cursor that this viewer may see (bounded). `gap` = more existed than we return: the client must refetch a snapshot. */
  async replay(examId: string, afterId: number, viewer: Viewer, limit = 500): Promise<{ events: ExamEvent[]; gap: boolean }> {
    const rows = await this.prisma.examEvent.findMany({ where: { examId, id: { gt: BigInt(afterId) } }, orderBy: { id: 'asc' }, take: limit + 1 });
    const gap = rows.length > limit;
    return { events: rows.slice(0, limit).map(row).filter((e) => visibleTo(e, viewer)), gap };
  }
  async latestId(examId: string): Promise<number> {
    const r = await this.prisma.$queryRaw<{ id: bigint | null }[]>`SELECT max(id) AS id FROM exam_events WHERE "examId" = ${examId}`;
    return Number(r[0]?.id ?? 0);
  }

  /** Redis: the pattern subscription is connected. Without Redis there is no channel to lose (in-process dispatch + database poll). */
  get liveChannelUp() { return this.cfg.REDIS_URL ? this.subReady : true; }
  get subscriberCount() { let n = 0; for (const s of this.streams.values()) n += s.subs.size; return n; }
  subscribersOf(examId: string): Subscriber[] { return [...(this.streams.get(examId)?.subs.values() ?? [])]; }

  async subscribe(examId: string, viewer: Viewer, lastId: number, send: Subscriber['send'], close: Subscriber['close']): Promise<Subscriber> {
    this.ensureRedisSubscriber(); this.ensureTimer();
    let st = this.streams.get(examId);
    if (!st) { st = { subs: new Map(), polledUpTo: await this.latestId(examId), nextPoll: 0 }; this.streams.set(examId, st); }
    const sub: Subscriber = { id: ++this.seq, examId, viewer, lastId, send, close };
    st.subs.set(sub.id, sub); this.metrics.sseConnections.set({}, this.subscriberCount);
    return sub;
  }
  unsubscribe(sub: Subscriber) {
    const st = this.streams.get(sub.examId); if (!st) return;
    st.subs.delete(sub.id); if (!st.subs.size) this.streams.delete(sub.examId);
    this.metrics.sseConnections.set({}, this.subscriberCount);
  }

  private dispatch(ev: ExamEvent) {
    const st = this.streams.get(ev.examId); if (!st) return;
    for (const s of st.subs.values()) {
      if (ev.id <= s.lastId || !visibleTo(ev, s.viewer)) continue;
      s.lastId = ev.id;
      try { s.send(ev); } catch { s.close(); }
    }
    if (ev.id > st.polledUpTo) st.polledUpTo = ev.id;
  }

  private ensureRedisSubscriber() {
    if (this.sub || !this.cfg.REDIS_URL) return;
    const sub = this.sub = new Redis(this.cfg.REDIS_URL, { maxRetriesPerRequest: null, retryStrategy: (n) => Math.min(n * 500, 5000), lazyConnect: false });
    sub.on('error', () => undefined);
    sub.on('ready', () => { this.subReady = true; sub.psubscribe('oes:exam:*').catch(() => undefined); });
    sub.on('close', () => { this.subReady = false; });
    sub.on('pmessage', (_p, _c, msg) => { try { this.dispatch(JSON.parse(msg) as ExamEvent); } catch { /* ignore malformed */ } });
  }

  private ensureTimer() {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.tick(); }, 1000); this.timer.unref();
  }
  private ticking = false;
  private async tick() {
    if (this.ticking) return; this.ticking = true;
    try {
      const healthy = this.subReady && this.kv.available;
      // Redis healthy: the poll is only a safety net (10 s). No Redis: it is how events emitted by OTHER processes arrive (2 s). Degraded: 1 s.
      const every = this.cfg.REDIS_URL ? (healthy ? 10_000 : 1_000) : this.kv.available ? 2_000 : 1_000;
      for (const [examId, st] of [...this.streams]) {
        if (Date.now() >= st.nextPoll) {                       // safety-net catch-up from the database (the authority)
          st.nextPoll = Date.now() + every;
          try {
            const rows = await this.prisma.examEvent.findMany({ where: { examId, id: { gt: BigInt(st.polledUpTo) } }, orderBy: { id: 'asc' }, take: 500 });
            for (const r of rows) this.dispatch(row(r));
          } catch (e) { this.log.warn(`catch-up poll failed: ${(e as Error).message}`); }
        }
        if (this.onTick) { try { await this.onTick(examId, [...st.subs.values()]); } catch (e) { this.log.warn(`stats tick failed: ${(e as Error).message}`); } }
      }
    } finally { this.ticking = false; }
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    for (const st of this.streams.values()) for (const s of st.subs.values()) { try { s.close(); } catch { /* ignore */ } }
    this.streams.clear();
    this.sub?.disconnect();
  }
}
