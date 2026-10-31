import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { QUEUES, QueuesService } from '../infra/queues.service';
import { MailService } from '../infra/mail.service';
import { DeliveryService } from './delivery/delivery.service';
import { ResultsService } from './results/results.service';
import { CONFIG, type Config } from '../config';

/** Registers BullMQ consumers: grading, mail delivery and the 10-second exam lifecycle sweeper. */
@Injectable()
export class JobsService implements OnApplicationBootstrap {
  private readonly log = new Logger('Jobs');
  constructor(
    private readonly queues: QueuesService, private readonly mail: MailService, private readonly delivery: DeliveryService,
    private readonly results: ResultsService, @Inject(CONFIG) private readonly cfg: Config,
  ) {}

  async onApplicationBootstrap() {
    if (this.cfg.RUN_WORKERS !== 'true') return;
    this.queues.process(QUEUES.grade, async (job) => this.results.gradeAttempt(job.data.attemptId as string), 16);
    this.queues.process(QUEUES.mail, async (job) => this.mail.deliver(job.data.id as string), 4);
    this.queues.process(QUEUES.sweep, async () => this.runTick(), 1);
    await this.queues.queue(QUEUES.sweep).upsertJobScheduler('lifecycle-tick', { every: 10_000 }, { name: 'tick', opts: { removeOnComplete: 10, removeOnFail: 50, attempts: 1 } });
    this.log.log('workers started');
  }

  runTick() {
    return this.results.tick((id) => this.delivery.finalize(id, { mode: 'AUTO' }));
  }
}
