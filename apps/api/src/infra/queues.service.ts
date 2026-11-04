import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Queue, Worker } from 'bullmq';
import { CONFIG, type Config } from '../config';

export const QUEUES = { grade: 'grade-attempt', mail: 'mail', results: 'result-batch' } as const;

/** What a handler receives on either backend (a BullMQ Job satisfies it). */
export interface JobLike { id?: string; name: string; data: Record<string, any> }
type Handler = (job: JobLike) => Promise<unknown>;
const ATTEMPTS = 5; const BACKOFF_MS = 1000;

/**
 * In-process stand-in for BullMQ when there is no Redis (REDIS_URL unset). Jobs run in THIS process with BullMQ's policy here (5 attempts,
 * exponential back-off from 1 s), de-duplicated by job id while queued or running. They are lost on restart and dropped when no consumer is
 * registered here (RUN_WORKERS=false): acceptable because every job has a database backstop (mail: the outbox retry loop; grading: the
 * lifecycle sweeper grades sealed attempts that were not graded).
 */
export class LocalQueues {
  private readonly log = new Logger('LocalQueues');
  private readonly handlers = new Map<string, { fn: Handler; concurrency: number; running: number; waiting: (() => void)[] }>();
  private readonly active = new Set<string>();
  private readonly timers = new Set<NodeJS.Timeout>();
  private closed = false;
  register(name: string, fn: Handler, concurrency: number) { this.handlers.set(name, { fn, concurrency, running: 0, waiting: [] }); }
  /** Returns false when the job was not taken (no consumer in this process, or shutting down). */
  add(name: string, job: JobLike, delay = 0): boolean {
    const h = this.handlers.get(name); if (!h || this.closed) return false;
    const key = `${name}:${job.id ?? randomUUID()}`; if (this.active.has(key)) return true;
    this.active.add(key); this.later(() => this.run(name, job, key, 1), delay);
    return true;
  }
  /** Settles once nothing is queued or running (tests). */
  async idle(timeoutMs = 10_000) { const end = Date.now() + timeoutMs; while (this.active.size && Date.now() < end) await new Promise((r) => setTimeout(r, 20)); }
  close() { this.closed = true; for (const t of this.timers) clearTimeout(t); this.timers.clear(); this.active.clear(); }
  private later(fn: () => Promise<void>, ms: number) { const t = setTimeout(() => { this.timers.delete(t); void fn(); }, ms); t.unref(); this.timers.add(t); }
  private async run(name: string, job: JobLike, key: string, attempt: number) {
    const h = this.handlers.get(name)!;
    if (h.running >= h.concurrency) await new Promise<void>((r) => h.waiting.push(r)); else h.running++;   // a waiter inherits the slot of the job that wakes it
    try { await h.fn(job); this.active.delete(key); }
    catch (e) {
      this.log.warn(`${name} job ${job.id ?? '?'} failed (attempt ${attempt}/${ATTEMPTS}): ${(e as Error).message}`);
      if (attempt < ATTEMPTS && !this.closed) this.later(() => this.run(name, job, key, attempt + 1), BACKOFF_MS * 2 ** (attempt - 1)); else this.active.delete(key);
    } finally { const next = h.waiting.shift(); if (next) next(); else h.running--; }
  }
}

/**
 * ioredis options for BullMQ, derived from REDIS_URL. Must keep everything the URL says: `rediss://` ⇒ TLS (managed Redis such as
 * Upstash accepts TLS only — dropping it makes every queue connection die with ECONNRESET and `queue.add()` wait forever), the ACL
 * username, the password (URL-decoded) and the database index. BullMQ requires maxRetriesPerRequest=null on its own connections.
 */
export function bullConnection(redisUrl: string) {
  const u = new URL(redisUrl);
  const db = Number(u.pathname.replace(/^\//, '') || 0);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username ? decodeURIComponent(u.username) : undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    ...(Number.isInteger(db) && db > 0 ? { db } : {}),
    ...(u.protocol === 'rediss:' ? { tls: { servername: u.hostname } } : {}),
    maxRetriesPerRequest: null as null,
  };
}

/** Job queues: BullMQ when REDIS_URL is set, otherwise {@link LocalQueues}. Producers are always available; consumers register handlers on demand. */
@Injectable()
export class QueuesService implements OnModuleDestroy {
  private readonly log = new Logger('Queues');
  private readonly queues = new Map<string, Queue>();
  private readonly workers: Worker[] = [];
  /** Set when the deployment runs without Redis. */
  readonly local?: LocalQueues;
  constructor(@Inject(CONFIG) private readonly cfg: Config) {
    if (!cfg.REDIS_URL) this.local = new LocalQueues();
  }
  private conn() {
    return bullConnection(this.cfg.REDIS_URL!);
  }
  queue(name: string): Queue {
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue(name, { connection: this.conn(), defaultJobOptions: { attempts: 5, backoff: { type: 'exponential', delay: 1000 }, removeOnComplete: 1000, removeOnFail: 5000 } });
      this.queues.set(name, q);
    }
    return q;
  }
  async add(name: string, jobName: string, data: Record<string, unknown>, opts: { jobId?: string; delay?: number } = {}): Promise<{ id?: string }> {
    if (this.local) { this.local.add(name, { id: opts.jobId, name: jobName, data }, opts.delay); return { id: opts.jobId }; }
    return this.queue(name).add(jobName, data, opts);
  }
  process(name: string, handler: Handler, concurrency = 8): void {
    if (this.local) { this.local.register(name, handler, concurrency); return; }
    const w = new Worker(name, handler, { connection: this.conn(), concurrency });
    w.on('failed', (job, err) => this.log.warn(`${name} job ${job?.id} failed: ${err.message}`));
    this.workers.push(w);
  }
  async onModuleDestroy() {
    this.local?.close();
    await Promise.allSettled(this.workers.map((w) => w.close()));
    await Promise.allSettled([...this.queues.values()].map((q) => q.close()));
  }
}
