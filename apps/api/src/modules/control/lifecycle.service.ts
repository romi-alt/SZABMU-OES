import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { hostname } from 'node:os';
import { randomBytes } from 'node:crypto';
import { SAVE_GRACE_SECONDS } from '@oes/shared';
import { LINKS } from '@oes/shared';
import { Prisma } from '../../generated/prisma/client';
import { CONFIG, type Config } from '../../config';
import { MetricsService } from '../../infra/metrics.service';
import { PrismaService } from '../../infra/prisma.service';
import { AuditService } from '../audit/audit.service';
import { DeliveryService } from '../delivery/delivery.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ResultsService } from '../results/results.service';
import { ExamEventsService } from './events.service';
import { finishTransition } from './transition';

export interface LifecycleStats { autoSubmitted: number; graded: number; opened: number; closed: number; pending: number; scoringStarted: number; forceSealed: number; published: number; poisoned: number; skipped?: boolean; lease?: string }
const MAX_ATTEMPT_RETRIES = 5; const leaseSeconds = () => Number(process.env.LIFECYCLE_LEASE_SECONDS ?? 30); const BATCH = 200; const CONCURRENCY = 8; const BUDGET_MS = 20_000;

/**
 * The lifecycle reconciler. PostgreSQL is the authority: every transition is derived from database state and the database clock,
 * is idempotent, and can be executed by any API process. Redis is not involved in correctness (it only accelerates event delivery).
 *
 *  - ownership: one process at a time holds a database lease (a crashed owner's lease simply expires); every step is ALSO safe if two
 *    processes run it together (row claims with SKIP LOCKED, guarded UPDATEs, idempotent finalize).
 *  - recovery: a restarted process reconciles the whole backlog immediately; bounded retries per attempt (poison attempts stop looping).
 *  - the API enforces deadlines independently (save predicate, lazy finalize on start/heartbeat): this reconciler seals and moves state,
 *    it is not what stops late writes.
 */
@Injectable()
export class LifecycleService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('Lifecycle');
  readonly instance = `${hostname()}:${process.pid}:${randomBytes(3).toString('hex')}`;
  private timer?: NodeJS.Timeout; private running = false;
  constructor(
    private readonly prisma: PrismaService, private readonly delivery: DeliveryService, private readonly results: ResultsService, private readonly notifications: NotificationsService,
    readonly audit: AuditService, readonly events: ExamEventsService, private readonly metrics: MetricsService, @Inject(CONFIG) private readonly cfg: Config,
  ) {}

  // ───────────── scheduling (no Redis) ─────────────
  onApplicationBootstrap() {
    if (this.cfg.RUN_WORKERS !== 'true') return;
    const every = Number(process.env.LIFECYCLE_INTERVAL_MS ?? 5000);
    const loop = () => { this.runOnce().catch((e) => this.log.error(`lifecycle run failed: ${(e as Error).message}`)); };
    loop();                                                      // immediate backlog reconciliation after (re)start
    this.timer = setInterval(loop, every); this.timer.unref();
    this.log.log(`lifecycle reconciler started on ${this.instance} (every ${every} ms, database lease)`);
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  private async acquireLease(): Promise<boolean> {
    const r = await this.prisma.$queryRaw<{ owner: string }[]>`
      INSERT INTO lifecycle_leases (name, owner, "expiresAt") VALUES ('lifecycle', ${this.instance}, clock_timestamp() + make_interval(secs => ${leaseSeconds()}::int))
      ON CONFLICT (name) DO UPDATE SET owner = EXCLUDED.owner, "expiresAt" = EXCLUDED."expiresAt", "updatedAt" = clock_timestamp()
      WHERE lifecycle_leases."expiresAt" < clock_timestamp() OR lifecycle_leases.owner = EXCLUDED.owner
      RETURNING owner`;
    return r.length > 0;
  }

  // ───────────── one reconciliation pass ─────────────
  async runOnce(opts: { examId?: string } = {}): Promise<LifecycleStats> {
    const stats: LifecycleStats = { autoSubmitted: 0, graded: 0, opened: 0, closed: 0, pending: 0, scoringStarted: 0, forceSealed: 0, published: 0, poisoned: 0 };
    if (this.running) return { ...stats, skipped: true };       // never overlap with ourselves
    if (!opts.examId && !(await this.acquireLease())) { this.metrics.lifecycleRuns.inc({ outcome: 'skipped_not_leader' }); return { ...stats, skipped: true }; }
    this.running = true;
    const started = Date.now(); const deadline = started + BUDGET_MS;
    const run = (await this.prisma.$queryRaw<{ id: string }[]>`INSERT INTO lifecycle_runs (id, instance) VALUES (gen_random_uuid(), ${this.instance}) RETURNING id`)[0]!.id;
    let error: string | null = null;
    try {
      const step = async (name: string, fn: () => Promise<void>) => { try { await fn(); } catch (e) { error = `${name}: ${String(e).replace(/\s+/g, ' ').slice(0, 300)}`; this.log.error(`step ${name} failed: ${error}`); } };
      await step('expire', () => this.expireAttempts(stats, opts.examId, deadline));
      await step('start', () => this.autoStart(stats, opts.examId));
      await step('forceClose', () => this.forceClose(stats, opts.examId, deadline));
      await step('close', () => this.closeExams(stats, opts.examId));
      await step('scoringStart', () => this.autoScoring(stats, opts.examId));
      await step('scoring', () => this.progressScoring(stats, opts.examId, deadline));
      await step('backstopGrading', () => this.gradeBackstop(stats, opts.examId, deadline));
      await step('publish', async () => { await this.events.publishPending(200); });
      await step('prune', async () => { await this.prisma.$executeRaw`DELETE FROM lifecycle_runs WHERE "startedAt" < clock_timestamp() - interval '2 days'`; });
      stats.poisoned = (await this.prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM attempts WHERE status = 'IN_PROGRESS' AND "lifecycleRetries" >= ${MAX_ATTEMPT_RETRIES}`)[0]!.n;
    } finally {
      await this.prisma.$executeRaw`UPDATE lifecycle_runs SET "finishedAt" = clock_timestamp(), "durationMs" = ${Date.now() - started}::int, stats = ${JSON.stringify(stats)}::jsonb, error = ${error} WHERE id = ${run}::uuid`.catch(() => undefined);
      this.running = false;
      this.metrics.lifecycleRuns.inc({ outcome: error ? 'error' : 'ok' });
    }
    return stats;
  }

  /** Exam-scoped reconciliation for the RECONCILE command: no lease needed because every step is safe to run concurrently. */
  reconcileExam(examId: string) { return this.runOnce({ examId }); }

  // ───────────── step A: seal attempts whose database-derived deadline has passed ─────────────
  private async expireAttempts(stats: LifecycleStats, examId: string | undefined, deadline: number) {
    const scope = examId ? Prisma.sql`AND a."examId" = ${examId}::uuid` : Prisma.empty;
    while (Date.now() < deadline) {
      // Frozen (suspended under FREEZE_CLOCK) attempts accrue no time; everything else expires at deadline + grace on the DATABASE clock.
      const ids = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT a.id FROM attempts a LEFT JOIN exam_suspensions s ON s.id = a."suspensionId"
        WHERE a.status = 'IN_PROGRESS' AND a."lifecycleRetries" < ${MAX_ATTEMPT_RETRIES} AND a."deadlineAt" < clock_timestamp() ${scope}
          AND a."deadlineAt" + make_interval(secs => ${SAVE_GRACE_SECONDS}::int)
              + CASE WHEN a."suspendedAt" IS NOT NULL AND s."timePolicy" = 'FREEZE_CLOCK' THEN clock_timestamp() - a."suspendedAt" ELSE interval '0' END < clock_timestamp()
        ORDER BY a."deadlineAt" LIMIT ${BATCH}`;
      if (!ids.length) return;
      let sealed = 0;
      await this.pool(ids.map((x) => x.id), async (id) => {
        try {
          const r = await this.delivery.sealIfExpired(id, { bulk: true });
          if (!('skipped' in r)) { sealed++; stats.autoSubmitted++; this.metrics.lifecycleTransitions.inc({ kind: 'auto_submit' }); }
        } catch (e) {
          await this.prisma.$executeRaw`UPDATE attempts SET "lifecycleRetries" = "lifecycleRetries" + 1, "lifecycleError" = ${String((e as Error).message).slice(0, 200)} WHERE id = ${id}::uuid`;
        }
      });
      if (ids.length < BATCH || sealed === 0) return;            // nothing more to do (or only failures remain: bounded by the retry counter)
    }
  }

  // ───────────── step B: clock-driven transitions ─────────────
  /** AUTOMATIC exams open at their window start (the legacy behaviour); MANUAL exams only move on commands. */
  private async autoStart(stats: LifecycleStats, examId?: string) {
    await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM exams WHERE "controlMode" = 'AUTOMATIC' AND status IN ('SCHEDULED', 'ADMISSION_OPEN') AND "paperStatus" = 'APPROVED'
          AND "opensAt" <= clock_timestamp() AND "closesAt" > clock_timestamp() ${examId ? Prisma.sql`AND id = ${examId}::uuid` : Prisma.empty}
        ORDER BY "opensAt" LIMIT 50 FOR UPDATE SKIP LOCKED`;
      for (const r of rows) {
        await tx.$executeRaw`UPDATE exams SET status = 'LIVE', "officialStartAt" = COALESCE("officialStartAt", "opensAt"), "admissionOpenedAt" = COALESCE("admissionOpenedAt", "opensAt") WHERE id = ${r.id}::uuid`;
        await finishTransition(tx, this, { examId: r.id, actor: null, action: 'exam.lifecycle.start', meta: { by: 'window-start' }, events: [{ type: 'EXAM_STARTED', payload: { automatic: true } }] });
        stats.opened++; this.metrics.lifecycleTransitions.inc({ kind: 'start' });
      }
    });
    if (stats.opened) this.events.nudge();
  }

  /** CLOSE(force) crash-safety: any exam still carrying forceCloseAt gets its remaining attempts sealed. */
  private async forceClose(stats: LifecycleStats, examId: string | undefined, deadline: number) {
    const exams = await this.prisma.$queryRaw<{ id: string }[]>`SELECT id FROM exams WHERE status = 'CLOSING' AND "forceCloseAt" IS NOT NULL ${examId ? Prisma.sql`AND id = ${examId}::uuid` : Prisma.empty} LIMIT 20`;
    for (const e of exams) {
      while (Date.now() < deadline) {
        const ids = await this.prisma.$queryRaw<{ id: string }[]>`SELECT id FROM attempts WHERE "examId" = ${e.id}::uuid AND status = 'IN_PROGRESS' AND "lifecycleRetries" < ${MAX_ATTEMPT_RETRIES} LIMIT ${BATCH}`;
        if (!ids.length) break;
        await this.pool(ids.map((x) => x.id), async (id) => {
          try { await this.delivery.finalize(id, { mode: 'FORCED', reason: 'Examination closed by the controller', bulk: true }); stats.forceSealed++; }
          catch (err) { await this.prisma.$executeRaw`UPDATE attempts SET "lifecycleRetries" = "lifecycleRetries" + 1, "lifecycleError" = ${String((err as Error).message).slice(0, 200)} WHERE id = ${id}::uuid`; }
        });
      }
    }
  }

  /** CLOSING → CLOSED once nothing is in progress; and any not-yet-closed exam whose window is over with nothing in progress. */
  private async closeExams(stats: LifecycleStats, examId?: string) {
    await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT e.id FROM exams e
        WHERE (e.status = 'CLOSING' OR (e.status IN ('SCHEDULED', 'ADMISSION_OPEN', 'LIVE') AND e."closesAt" <= clock_timestamp()))
          AND NOT EXISTS (SELECT 1 FROM attempts a WHERE a."examId" = e.id AND a.status = 'IN_PROGRESS') ${examId ? Prisma.sql`AND e.id = ${examId}::uuid` : Prisma.empty}
        ORDER BY e."closesAt" LIMIT 50 FOR UPDATE OF e SKIP LOCKED`;
      for (const r of rows) {
        await tx.$executeRaw`UPDATE exams SET status = 'CLOSED', "closedAt" = clock_timestamp(), "admissionClosedAt" = COALESCE("admissionClosedAt", clock_timestamp()) WHERE id = ${r.id}::uuid`;
        await finishTransition(tx, this, { examId: r.id, actor: null, action: 'exam.lifecycle.close', meta: { by: 'reconciler' }, events: [{ type: 'EXAM_CLOSED', payload: {} }] });
        stats.closed++; this.metrics.lifecycleTransitions.inc({ kind: 'close' });
      }
    });
    if (stats.closed) this.events.nudge();
  }

  /** AUTOMATIC exams proceed from CLOSED to SCORING by themselves; MANUAL exams wait for INITIATE_SCORING. */
  private async autoScoring(stats: LifecycleStats, examId?: string) {
    await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM exams WHERE status = 'CLOSED' AND "controlMode" = 'AUTOMATIC' ${examId ? Prisma.sql`AND id = ${examId}::uuid` : Prisma.empty} LIMIT 50 FOR UPDATE SKIP LOCKED`;
      for (const r of rows) {
        await tx.$executeRaw`UPDATE exams SET status = 'SCORING' WHERE id = ${r.id}::uuid`;
        await finishTransition(tx, this, { examId: r.id, actor: null, action: 'exam.lifecycle.scoring_started', meta: { by: 'reconciler' }, events: [{ type: 'SCORING_STARTED', payload: {} }] });
        stats.scoringStarted++; this.metrics.lifecycleTransitions.inc({ kind: 'scoring_start' });
      }
    });
  }

  // ───────────── step C: scoring ─────────────
  private async progressScoring(stats: LifecycleStats, examId: string | undefined, deadline: number) {
    const exams = await this.prisma.exam.findMany({ where: { status: 'SCORING', ...(examId ? { id: examId } : {}) }, select: { id: true, code: true, title: true, totalMarks: true }, take: 20 });
    for (const ex of exams) {
      await this.gradeUngraded(stats, ex.id, deadline);
      const pendingGrade = (await this.prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM attempts a LEFT JOIN results r ON r."examId" = a."examId" AND r."studentId" = a."studentId" WHERE a."examId" = ${ex.id}::uuid AND (a.status = 'IN_PROGRESS' OR (a.status IN ('SUBMITTED','AUTO_SUBMITTED') AND r.id IS NULL))`)[0]!.n;
      if (pendingGrade > 0) continue;
      const moved = await this.prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM exams WHERE id = ${ex.id}::uuid AND status = 'SCORING' FOR UPDATE SKIP LOCKED`;
        if (!locked.length) return false;
        const absent = await tx.$queryRaw<{ studentId: string }[]>`SELECT c."studentId" FROM exam_candidates c WHERE c."examId" = ${ex.id}::uuid AND NOT EXISTS (SELECT 1 FROM attempts a WHERE a."examId" = ${ex.id}::uuid AND a."studentId" = c."studentId")`;
        await tx.result.createMany({ data: absent.map((s) => ({ examId: ex.id, studentId: s.studentId, rawScore: 0, totalMarks: ex.totalMarks, percent: 0, status: 'ABSENT' as const })), skipDuplicates: true });
        await tx.resultBatch.upsert({ where: { examId: ex.id }, create: { examId: ex.id }, update: {} });
        await tx.$executeRaw`UPDATE exams SET status = 'RESULT_PENDING' WHERE id = ${ex.id}::uuid`;
        await finishTransition(tx, this, { examId: ex.id, actor: null, action: 'exam.lifecycle.results_pending', meta: { absentees: absent.length }, events: [{ type: 'RESULTS_PENDING', payload: { absentees: absent.length } }] });
        return true;
      });
      if (moved) {
        stats.pending++; this.metrics.lifecycleTransitions.inc({ kind: 'results_pending' });
        await this.notifications.notifyRole('EXAMINER', 'Results ready for review', `${ex.code} — ${ex.title} has been graded.`, LINKS.results);
      }
    }
  }
  private async gradeUngraded(stats: LifecycleStats, examId: string | undefined, deadline: number) {
    while (Date.now() < deadline) {
      const ids = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT a.id FROM attempts a LEFT JOIN results r ON r."examId" = a."examId" AND r."studentId" = a."studentId"
        WHERE a.status IN ('SUBMITTED', 'AUTO_SUBMITTED') AND r.id IS NULL ${examId ? Prisma.sql`AND a."examId" = ${examId}::uuid` : Prisma.empty} LIMIT ${BATCH}`;
      if (!ids.length) return;
      let ok = 0;
      await this.pool(ids.map((x) => x.id), async (id) => { try { await this.results.gradeAttempt(id); ok++; stats.graded++; } catch (e) { this.log.warn(`grade ${id}: ${(e as Error).message}`); } });
      if (ids.length < BATCH || ok === 0) return;
    }
  }
  /** The grade queue is an accelerator; sealed attempts it missed (Redis down, lost job) are graded here, from the database. */
  private gradeBackstop(stats: LifecycleStats, examId: string | undefined, deadline: number) { return this.gradeUngraded(stats, examId, deadline); }

  /** Bounded parallelism without a dependency. */
  private async pool<T>(items: T[], fn: (x: T) => Promise<void>) {
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => { while (i < items.length) { const x = items[i++]!; await fn(x); } }));
  }

  // ───────────── health (for the control centre) ─────────────
  async health() {
    const last = (await this.prisma.$queryRaw<{ at: Date | null; age: number | null; instance: string | null; ms: number | null }[]>`
      SELECT "finishedAt" AS at, extract(epoch FROM clock_timestamp() - "finishedAt")::float AS age, instance, "durationMs" AS ms FROM lifecycle_runs WHERE error IS NULL AND "finishedAt" IS NOT NULL ORDER BY "startedAt" DESC LIMIT 1`)[0];
    const lastError = (await this.prisma.$queryRaw<{ at: Date; error: string }[]>`SELECT "startedAt" AS at, error FROM lifecycle_runs WHERE error IS NOT NULL ORDER BY "startedAt" DESC LIMIT 1`)[0];
    const lease = (await this.prisma.$queryRaw<{ owner: string; live: boolean }[]>`SELECT owner, "expiresAt" > clock_timestamp() AS live FROM lifecycle_leases WHERE name = 'lifecycle'`)[0];
    const backlog = (await this.prisma.$queryRaw<{ expired: number; poisoned: number }[]>`
      SELECT count(*) FILTER (WHERE "deadlineAt" + make_interval(secs => ${SAVE_GRACE_SECONDS + 15}::int) < clock_timestamp() AND "suspendedAt" IS NULL)::int AS expired,
             count(*) FILTER (WHERE "lifecycleRetries" >= ${MAX_ATTEMPT_RETRIES})::int AS poisoned FROM attempts WHERE status = 'IN_PROGRESS'`)[0]!;
    const stale = last?.age == null || last.age > 30;
    return { lastRunAt: last?.at ?? null, lastRunAgeSeconds: last?.age ?? null, lastRunDurationMs: last?.ms ?? null, lastRunInstance: last?.instance ?? null, lastError: lastError ?? null, leaseOwner: lease?.live ? lease.owner : null,
      expiredBacklog: backlog.expired, poisonedAttempts: backlog.poisoned, status: stale ? 'STALE' : backlog.expired > 0 || backlog.poisoned > 0 ? 'DEGRADED' : 'OK' };
  }
}
