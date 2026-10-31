import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import fastifyCookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import { AppModule } from './app.module';
import { loadConfig } from './config';

export async function createApp(): Promise<NestFastifyApplication> {
  const cfg = loadConfig();
  const adapter = new FastifyAdapter({ trustProxy: cfg.TRUST_PROXY === 'true', bodyLimit: 2 * 1024 * 1024 });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, { logger: cfg.NODE_ENV === 'test' ? ['error'] : ['log', 'warn', 'error'] });
  app.setGlobalPrefix('api');
  await app.register(fastifyCookie as never, { secret: cfg.COOKIE_SECRET });
  await app.register(helmet as never, { contentSecurityPolicy: false });
  const allowed = cfg.WEB_ORIGIN.split(',').map((s) => s.trim());
  // CSRF defence for cookie auth: browsers always attach Origin to cross-site state-changing requests.
  app.getHttpAdapter().getInstance().addHook('onRequest', async (req, reply) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
    const origin = req.headers.origin;
    if (origin && !allowed.includes(origin)) return reply.status(403).send({ code: 'FORBIDDEN', message: 'Cross-origin request rejected' });
  });
  app.enableShutdownHooks();
  return app;
}
