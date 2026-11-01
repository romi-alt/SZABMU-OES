import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/auth';
import { PrismaService } from '../infra/prisma.service';
import { RedisService } from '../infra/redis.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService, private readonly redis: RedisService) {}
  @Public() @Get()
  async health() {
    const [db, cache] = await Promise.allSettled([this.prisma.$queryRaw`SELECT 1`, this.redis.client.ping()]);
    return { status: db.status === 'fulfilled' && cache.status === 'fulfilled' ? 'ok' : 'degraded', db: db.status === 'fulfilled', redis: cache.status === 'fulfilled' };
  }
}
