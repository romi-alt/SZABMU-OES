import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { CONFIG, type Config } from '../config';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(CONFIG) cfg: Config) {
    // Managed PostgreSQL is reached over the internet (tens of ms per round trip), so Prisma's 5 s default
    // interactive-transaction timeout is too tight for multi-statement transactions. Explicit per-call options still win.
    super({
      adapter: new PrismaPg({ connectionString: cfg.DATABASE_URL, max: cfg.DB_POOL_MAX }),
      transactionOptions: { maxWait: cfg.DB_TX_MAX_WAIT_MS, timeout: cfg.DB_TX_TIMEOUT_MS },
    });
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
  /** Database clock — the only clock used for exam timing decisions. */
  async dbNow(): Promise<Date> {
    const r = await this.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
    return r[0]!.now;
  }
}
