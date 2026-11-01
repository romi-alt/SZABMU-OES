import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { MailService } from '../infra/mail.service';
import { WorkSignal } from '../infra/work-signal.service';
import { DeliveryService } from './delivery/delivery.service';
import { ResultsService } from './results/results.service';
import { CONFIG, type Config } from '../config';

const TICK_MS = 10_000;

/**
 * Background work without a queue server: an in-process lifecycle tick every 10 s (auto-submit at the deadline, grading,
 * opening/closing exams, mail retries) plus an immediate grade hand-off from submit.
 *
 * Safe without Redis because every step is idempotent and keyed in the database: finalize() seals an attempt exactly once
 * under a row lock, grading upserts one result per attempt, and mail rows carry their own status. The tick is also not the
 * only line of defence: heartbeat and save requests auto-submit an expired attempt themselves, and the next tick after a
 * process restart (the platform may recycle an idle process) catches up on anything missed.
 * Assumes a single API process. With several, ticks would overlap harmlessly except for the one-off "results ready"
 * notification, which could be sent twice.
 */
@Injectable()
export class JobsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('Jobs');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly mail: MailService, private readonly delivery: DeliveryService, private readonly results: ResultsService,
    private readonly signal: WorkSignal, @Inject(CONFIG) private readonly cfg: Config,
  ) {}

  onApplicationBootstrap() {
    if (this.cfg.RUN_WORKERS !== 'true') return;
    this.signal.setGrader((id) => this.results.gradeAttempt(id), (id, e) => this.log.warn(`grade ${id} failed (the tick will retry): ${e.message}`));
    void this.runTick();                                        // catch up immediately after a (re)start
    this.timer = setInterval(() => void this.runTick(), TICK_MS);
    this.timer.unref();
    this.log.log('lifecycle tick started');
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  /** One pass; overlapping passes are skipped. Also used directly by tests. */
  async runTick() {
    if (this.running) return null;
    this.running = true;
    try {
      const stats = await this.results.tick((id) => this.delivery.finalize(id, { mode: 'AUTO' }));
      await this.mail.retryUndelivered().catch((e: Error) => this.log.warn(`mail retry: ${e.message}`));
      return stats;
    } catch (e) { this.log.warn(`tick failed: ${(e as Error).message}`); return null; }
    finally { this.running = false; }
  }
}
