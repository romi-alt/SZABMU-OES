import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../generated/prisma/client';
import { CONFIG, type Config } from '../config';
import { poolConfigFromUrl } from './db-url';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(CONFIG) cfg: Config) {
    // A managed database may be reached over the internet (tens of ms per round trip), so Prisma's 5 s default
    // interactive-transaction timeout is too tight for multi-statement transactions. Explicit per-call options still win.
    super({
      // Text protocol: one round trip per statement instead of prepare + execute + close (the adapter disables the prepare cache).
      adapter: new PrismaMariaDb(poolConfigFromUrl(cfg.DATABASE_URL, { connectionLimit: cfg.DB_POOL_MAX }), { useTextProtocol: true }),
      // Photos are binary and personal: never selected unless a query asks for them with `omit: { photo: false }`.
      omit: { student: { photo: true }, teacherProfile: { photo: true } },
      transactionOptions: { maxWait: cfg.DB_TX_MAX_WAIT_MS, timeout: cfg.DB_TX_TIMEOUT_MS },
    });
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
  /** Database clock — the only clock used for exam timing decisions. SYSDATE() is the wall clock at call time (like clock_timestamp()). */
  async dbNow(): Promise<Date> {
    const r = await this.$queryRaw<{ now: Date }[]>`SELECT SYSDATE(3) AS now`;
    return r[0]!.now;
  }
}
