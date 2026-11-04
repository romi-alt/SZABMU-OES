import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { QUEUES, QueuesService } from '../infra/queues.service';
import { MailService } from '../infra/mail.service';
import { ResultsService } from './results/results.service';
import { LifecycleService } from './control/lifecycle.service';
import { CONFIG, type Config } from '../config';

/**
 * BullMQ consumers (grading, mail delivery) — Redis ACCELERATORS only. The exam lifecycle (auto-submit, open/close, scoring, absentees)
 * is NOT here any more: it runs in LifecycleService on database state and survives Redis loss.
 */
@Injectable()
export class JobsService implements OnApplicationBootstrap {
  private readonly log = new Logger('Jobs');
  constructor(
    private readonly queues: QueuesService, private readonly mail: MailService, private readonly results: ResultsService,
    private readonly lifecycle: LifecycleService, @Inject(CONFIG) private readonly cfg: Config,
  ) {}

  onApplicationBootstrap() {
    if (this.cfg.RUN_WORKERS !== 'true') return;
    this.queues.process(QUEUES.grade, async (job) => this.results.gradeAttempt(job.data.attemptId as string), 16);
    this.queues.process(QUEUES.mail, async (job) => this.mail.deliver(job.data.id as string), 4);
    this.log.log('queue consumers started (grade, mail)');
  }

  /** One reconciliation pass (tests and operators; the background loop calls the same method). */
  runTick() { return this.lifecycle.runOnce(); }
}
