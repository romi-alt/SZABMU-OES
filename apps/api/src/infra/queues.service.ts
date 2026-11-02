import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue, Worker, type Job } from 'bullmq';
import { CONFIG, type Config } from '../config';

export const QUEUES = { grade: 'grade-attempt', mail: 'mail', results: 'result-batch' } as const;

type Handler = (job: Job) => Promise<unknown>;

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

/** BullMQ wiring: producers are always available; consumers register handlers and start on demand. */
@Injectable()
export class QueuesService implements OnModuleDestroy {
  private readonly log = new Logger('Queues');
  private readonly queues = new Map<string, Queue>();
  private readonly workers: Worker[] = [];
  private readonly connection: { url: string };
  constructor(@Inject(CONFIG) private readonly cfg: Config) {
    this.connection = { url: cfg.REDIS_URL };
  }
  private conn() {
    return bullConnection(this.cfg.REDIS_URL);
  }
  queue(name: string): Queue {
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue(name, { connection: this.conn(), defaultJobOptions: { attempts: 5, backoff: { type: 'exponential', delay: 1000 }, removeOnComplete: 1000, removeOnFail: 5000 } });
      this.queues.set(name, q);
    }
    return q;
  }
  async add(name: string, jobName: string, data: Record<string, unknown>, opts: { jobId?: string; delay?: number } = {}) {
    return this.queue(name).add(jobName, data, opts);
  }
  process(name: string, handler: Handler, concurrency = 8) {
    const w = new Worker(name, handler, { connection: this.conn(), concurrency });
    w.on('failed', (job, err) => this.log.warn(`${name} job ${job?.id} failed: ${err.message}`));
    this.workers.push(w);
    return w;
  }
  async onModuleDestroy() {
    await Promise.allSettled(this.workers.map((w) => w.close()));
    await Promise.allSettled([...this.queues.values()].map((q) => q.close()));
  }
}
