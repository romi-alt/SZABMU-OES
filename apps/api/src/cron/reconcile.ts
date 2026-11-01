import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './../app.module';
import { loadConfig } from './../config';
import { LifecycleService } from '../modules/control/lifecycle.service';
import { MailService } from '../infra/mail.service';

/**
 * ONE finite reconciliation pass, then exit. For a scheduler (Hostinger cron: `npm run reconcile`), a deploy hook, or an operator.
 *
 * This is a BACKSTOP, not a worker: a cron job cannot give second-level guarantees. Deadlines are enforced by the API on every request
 * against the database clock; this command only seals/grades/moves state that nothing has touched yet. It takes the same database lease
 * as the always-on worker, so running it next to one is harmless (the pass is then reported as `skipped`).
 *
 * It also re-sends outbox e-mail that was never delivered (password-recovery codes).
 *
 * Exit codes: 0 = pass completed or skipped · 1 = the pass failed · 2 = timed out (RECONCILE_TIMEOUT_MS, default 120000).
 */
async function main() {
  process.env.RUN_WORKERS = 'false';                     // no loops, no queue consumers in this process
  loadConfig();
  const limit = Number(process.env.RECONCILE_TIMEOUT_MS ?? 120_000);
  const killer = setTimeout(() => { console.error(`reconcile timed out after ${limit} ms`); process.exit(2); }, limit); killer.unref();
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  try {
    const stats = await app.get(LifecycleService).runOnce();
    const mail = await app.get(MailService).retryUndelivered();   // outbox backstop: recovery codes must not depend on a queue consumer
    console.log(JSON.stringify({ at: new Date().toISOString(), ...stats, mail }));
  } finally {
    await app.close();
  }
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
