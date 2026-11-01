import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { CONFIG, type Config } from '../config';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(CONFIG) cfg: Config) {
    super({ adapter: new PrismaPg({ connectionString: cfg.DATABASE_URL, max: cfg.DB_POOL_MAX }) });
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
