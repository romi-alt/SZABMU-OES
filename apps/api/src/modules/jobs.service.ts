import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { QUEUES, QueuesService } from '../infra/queues.service';
import { MailService } from '../infra/mail.service';
import { ResultsService } from './results/results.service';
import { LifecycleService } from './control/lifecycle.service';
import { CONFIG, type Config } from '../config';

/** Without Redis, how often the worker sweeps the mail outbox, and how old a message must be before the sweep may take it. */
const OUTBOX_EVERY_MS = 15_000;
const OUTBOX_MIN_AGE_SEC = 60;

/**
 * Queue consumers (grading, mail delivery) — ACCELERATORS only. The exam lifecycle (auto-submit, open/close, scoring, absentees)
 * is NOT here any more: it runs in LifecycleService on database state and survives Redis loss.
 */
@Injectable()
export class JobsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('Jobs');
  private outboxTimer?: NodeJS.Timeout;
  private sweeping = false;
  constructor(
    private readonly queues: QueuesService, private readonly mail: MailService, private readonly results: ResultsService,
    private readonly lifecycle: LifecycleService, @Inject(CONFIG) private readonly cfg: Config,
  ) {}

  onApplicationBootstrap() {
    if (this.cfg.RUN_WORKERS !== 'true') return;
    this.queues.process(QUEUES.grade, async (job) => this.results.gradeAttempt(job.data.attemptId as string), 16);
    this.queues.process(QUEUES.mail, async (job) => this.mail.deliver(job.data.id as string), 4);
    if (!this.cfg.REDIS_URL) {
      // No Redis: in-process jobs vanish on restart, so the outbox is swept here instead of relying on the external reconcile cron.
      // Messages younger than a minute are left alone: their in-process delivery (and its retries) may still be running.
      this.outboxTimer = setInterval(() => { void this.sweepOutbox(); }, OUTBOX_EVERY_MS); this.outboxTimer.unref();
    }
    this.log.log(`queue consumers started (grade, mail) on ${this.cfg.REDIS_URL ? 'BullMQ' : 'the in-process runner + database outbox sweep'}`);
  }
  onModuleDestroy() { if (this.outboxTimer) clearInterval(this.outboxTimer); }

  private async sweepOutbox() {
    if (this.sweeping) return; this.sweeping = true;
    try { await this.mail.retryUndelivered(25, OUTBOX_MIN_AGE_SEC); } catch (e) { this.log.warn(`outbox sweep failed: ${(e as Error).message}`); } finally { this.sweeping = false; }
  }

  /** One reconciliation pass (tests and operators; the background loop calls the same method). */
  runTick() { return this.lifecycle.runOnce(); }
}
