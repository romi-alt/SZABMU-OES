import { Controller, Get, Header, Headers, Inject } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { Public } from '../common/auth';
import { AppError } from '../common/errors';
import { MetricsService } from '../infra/metrics.service';
import { CONFIG, type Config } from '../config';

/** Prometheus scrape endpoint. Disabled (404) unless METRICS_TOKEN is configured; otherwise requires `Authorization: Bearer <token>`. */
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService, @Inject(CONFIG) private readonly cfg: Config) {}
  @Public() @Get() @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8') @Header('Cache-Control', 'no-store')
  async scrape(@Headers('authorization') auth?: string) {
    if (!this.cfg.METRICS_TOKEN) throw new AppError(404, 'NOT_FOUND', 'Not found');
    const given = createHash('sha256').update((auth ?? '').replace(/^Bearer\s+/i, '')).digest();
    if (!timingSafeEqual(given, createHash('sha256').update(this.cfg.METRICS_TOKEN).digest())) throw new AppError(401, 'UNAUTHENTICATED', 'Invalid metrics token');
    return this.metrics.render();
  }
}
