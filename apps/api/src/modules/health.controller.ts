import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/auth';
import { PrismaService } from '../infra/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}
  @Public() @Get()
  async health() {
    const db = await this.prisma.$queryRaw`SELECT 1`.then(() => true, () => false);
    return { status: db ? 'ok' : 'degraded', db };
  }
}
