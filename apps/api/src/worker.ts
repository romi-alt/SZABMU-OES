import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { loadConfig } from './config';

/**
 * The always-on background worker: BullMQ consumers (grading, mail) and the database-lease lifecycle reconciler
 * (auto-submit, open/close, scoring, backstop grading, event publishing). NO HTTP server, no public port.
 *
 * Why it exists: managed Node.js web hosting (Hostinger) does not run permanent background processes, so the web API is deployed with
 * RUN_WORKERS=false and THIS entry runs on an always-on worker host. It is safe next to the API and next to a second copy:
 * every step is idempotent and the lifecycle pass takes a database lease (docs/deployment/hostinger-managed/worker-architecture.md).
 * Correctness of deadlines never depends on this process; it only moves state forward.
 */
async function main() {
  process.env.RUN_WORKERS = 'true';                      // this process IS the worker (read by CONFIG when AppModule is compiled)
  loadConfig();                                          // same production safety gate as the API: refuses to start on unsafe configuration
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['log', 'warn', 'error'] });
  app.enableShutdownHooks();                             // SIGTERM/SIGINT → onModuleDestroy: stop timers, close BullMQ workers and connections
  // The reconciler's timer is unref'd (it must not keep the API alive); in a worker nothing else holds the event loop open.
  setInterval(() => undefined, 60_000);
  console.log(`oes worker started (pid ${process.pid})`);
}
main().catch((e) => { console.error(e); process.exit(1); });
