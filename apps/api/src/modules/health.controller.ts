import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/auth';
import { PrismaService } from '../infra/prisma.service';
import { KvService } from '../infra/kv.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService, private readonly kv: KvService) {}
  @Public() @Get()
  async health() {
    const [db, kv] = await Promise.all([this.prisma.$queryRaw`SELECT 1`.then(() => true, () => false), this.kv.ping()]);
    // `redis` is null when the deployment runs without Redis (coordination state lives in the database).
    return { status: db && kv ? 'ok' : 'degraded', db, redis: this.kv.backend === 'redis' ? kv : null, coordination: this.kv.backend };
  }
}
