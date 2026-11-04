import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { hostname } from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
import { SAVE_GRACE_SECONDS } from '@oes/shared';
import { LINKS } from '@oes/shared';
import { Prisma } from '../../generated/prisma/client';
import { CONFIG, type Config } from '../../config';
import { MetricsService } from '../../infra/metrics.service';
import { PrismaService } from '../../infra/prisma.service';
import { int } from '../../infra/sql';
import { AuditService } from '../audit/audit.service';
import { DeliveryService } from '../delivery/delivery.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ResultsService } from '../results/results.service';
import { ExamEventsService } from './events.service';
import { finishTransition } from './transition';

export interface LifecycleStats { autoSubmitted: number; graded: number; opened: number; closed: number; pending: number; scoringStarted: number; forceSealed: number; published: number; poisoned: number; skipped?: boolean; lease?: string }
const CONCURRENCY_ENV = () => Math.max(1, Math.min(32, Number(process.env.LIFECYCLE_CONCURRENCY ?? 8)));
const MAX_ATTEMPT_RETRIES = 5; const leaseSeconds = () => Number(process.env.LIFECYCLE_LEASE_SECONDS ?? 15); const BATCH = 200; const BUDGET_MS = 20_000;

/**
 * The lifecycle reconciler. The database is the authority: every transition is derived from database state and the database clock,
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
    // The row exists after the first call; the guarded UPDATE is the atomic claim (an expired lease, or one we already hold).
    await this.prisma.$executeRaw`INSERT IGNORE INTO lifecycle_leases (name, owner, "expiresAt", "updatedAt") VALUES ('lifecycle', '', NOW(3), NOW(3))`;
    const n = await this.prisma.$executeRaw`UPDATE lifecycle_leases SET owner = ${this.instance}, "expiresAt" = TIMESTAMPADD(SECOND, ${leaseSeconds()}, NOW(3)), "updatedAt" = NOW(3)
      WHERE name = 'lifecycle' AND ("expiresAt" < NOW(3) OR owner = ${this.instance})`;
    return n > 0;
  }

  /** Extends our own lease (no-op if someone else took it). Called between steps so a long pass does not lose ownership mid-way. */
  private async renewLease() {
    await this.prisma.$executeRaw`UPDATE lifecycle_leases SET "expiresAt" = TIMESTAMPADD(SECOND, ${leaseSeconds()}, NOW(3)), "updatedAt" = NOW(3) WHERE name = 'lifecycle' AND owner = ${this.instance}`.catch(() => undefined);
  }

  // ───────────── one reconciliation pass ─────────────
  private current?: Promise<LifecycleStats>;
  /** Resolves when no pass is running (used by tests and graceful shutdown). */
  async idle() { while (this.running) await this.current?.catch(() => undefined); }

  /**
   * One reconciliation pass. The periodic loop never overlaps itself (an overlapping tick is skipped). An explicit exam-scoped request
   * (the RECONCILE command, a force-close kick) WAITS for any pass in flight and then runs its own, so it never reports "done" for work it skipped.
   */
  async runOnce(opts: { examId?: string } = {}): Promise<LifecycleStats> {
    const empty: LifecycleStats = { autoSubmitted: 0, graded: 0, opened: 0, closed: 0, pending: 0, scoringStarted: 0, forceSealed: 0, published: 0, poisoned: 0 };
    if (this.running && !opts.examId) return { ...empty, skipped: true };
    while (this.running) await this.current?.catch(() => undefined);
    if (this.running) return { ...empty, skipped: true };
    const p = this.pass(opts); this.current = p;
    return p;
  }

  private async pass(opts: { examId?: string }): Promise<LifecycleStats> {
    const stats: LifecycleStats = { autoSubmitted: 0, graded: 0, opened: 0, closed: 0, pending: 0, scoringStarted: 0, forceSealed: 0, published: 0, poisoned: 0 };
    this.running = true;                                   // claim the slot BEFORE any await so two callers can never run a pass together
    if (!opts.examId && !(await this.acquireLease())) { this.running = false; this.metrics.lifecycleRuns.inc({ outcome: 'skipped_not_leader' }); return { ...stats, skipped: true }; }
    const started = Date.now(); const deadline = started + BUDGET_MS;
    const run = randomUUID();
    await this.prisma.$executeRaw`INSERT INTO lifecycle_runs (id, instance) VALUES (${run}, ${this.instance})`;
    let error: string | null = null;
    try {
      const step = async (name: string, fn: () => Promise<void>) => { if (!opts.examId) await this.renewLease(); try { await fn(); } catch (e) { error = `${name}: ${String(e).replace(/\s+/g, ' ').slice(0, 300)}`; this.log.error(`step ${name} failed: ${error}`); } };
      await step('expire', () => this.expireAttempts(stats, opts.examId, deadline));
      await step('start', () => this.autoStart(stats, opts.examId));
      await step('forceClose', () => this.forceClose(stats, opts.examId, deadline));
      await step('close', () => this.closeExams(stats, opts.examId));
      await step('scoringStart', () => this.autoScoring(stats, opts.examId));
      await step('scoring', () => this.progressScoring(stats, opts.examId, deadline));
      await step('backstopGrading', () => this.gradeBackstop(stats, opts.examId, deadline));
      await step('publish', async () => { await this.events.publishPending(200); });
      await step('prune', async () => { await this.prisma.$executeRaw`DELETE FROM lifecycle_runs WHERE "startedAt" < NOW(3) - INTERVAL 2 DAY`; });
      stats.poisoned = int((await this.prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM attempts WHERE status = 'IN_PROGRESS' AND "lifecycleRetries" >= ${MAX_ATTEMPT_RETRIES}`)[0]!.n);
    } finally {
      await this.prisma.$executeRaw`UPDATE lifecycle_runs SET "finishedAt" = NOW(3), "durationMs" = ${Date.now() - started}, stats = ${JSON.stringify(stats)}, error = ${error} WHERE id = ${run}`.catch(() => undefined);
      this.running = false;
      this.metrics.lifecycleRuns.inc({ outcome: error ? 'error' : 'ok' });
    }
    return stats;
  }

  /** Exam-scoped reconciliation for the RECONCILE command: no lease needed because every step is safe to run concurrently. */
  reconcileExam(examId: string) { return this.runOnce({ examId }); }

  // ───────────── step A: seal attempts whose database-derived deadline has passed ─────────────
  private async expireAttempts(stats: LifecycleStats, examId: string | undefined, deadline: number) {
    const scope = examId ? Prisma.sql`AND a."examId" = ${examId}` : Prisma.empty;
    while (Date.now() < deadline) {
      // Frozen (suspended under FREEZE_CLOCK) attempts accrue no time; everything else expires at deadline + grace on the DATABASE clock.
      const ids = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT a.id FROM attempts a LEFT JOIN exam_suspensions s ON s.id = a."suspensionId"
        WHERE a.status = 'IN_PROGRESS' AND a."lifecycleRetries" < ${MAX_ATTEMPT_RETRIES} AND a."deadlineAt" < NOW(3) ${scope}
          AND TIMESTAMPADD(MICROSECOND, CASE WHEN a."suspendedAt" IS NOT NULL AND s."timePolicy" = 'FREEZE_CLOCK' THEN TIMESTAMPDIFF(MICROSECOND, a."suspendedAt", NOW(3)) ELSE 0 END,
              TIMESTAMPADD(SECOND, ${SAVE_GRACE_SECONDS}, a."deadlineAt")) < NOW(3)
        ORDER BY a."deadlineAt" LIMIT ${BATCH}`;
      if (!ids.length) return;
      let sealed = 0;
      await this.pool(ids.map((x) => x.id), async (id) => {
        try {
          const r = await this.delivery.sealIfExpired(id, { bulk: true });
          if (!('skipped' in r)) { sealed++; stats.autoSubmitted++; this.metrics.lifecycleTransitions.inc({ kind: 'auto_submit' }); }
        } catch (e) {
          await this.prisma.$executeRaw`UPDATE attempts SET "lifecycleRetries" = "lifecycleRetries" + 1, "lifecycleError" = ${String((e as Error).message).slice(0, 200)} WHERE id = ${id}`;
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
          AND "opensAt" <= NOW(3) AND "closesAt" > NOW(3) ${examId ? Prisma.sql`AND id = ${examId}` : Prisma.empty}
        ORDER BY "opensAt" LIMIT 50 FOR UPDATE SKIP LOCKED`;
      for (const r of rows) {
        await tx.$executeRaw`UPDATE exams SET status = 'LIVE', "officialStartAt" = COALESCE("officialStartAt", "opensAt"), "admissionOpenedAt" = COALESCE("admissionOpenedAt", "opensAt") WHERE id = ${r.id}`;
        await finishTransition(tx, this, { examId: r.id, actor: null, action: 'exam.lifecycle.start', meta: { by: 'window-start' }, events: [{ type: 'EXAM_STARTED', payload: { automatic: true } }] });
        stats.opened++; this.metrics.lifecycleTransitions.inc({ kind: 'start' });
      }
    });
    if (stats.opened) this.events.nudge();
  }

  /** CLOSE(force) crash-safety: any exam still carrying forceCloseAt gets its remaining attempts sealed. */
  private async forceClose(stats: LifecycleStats, examId: string | undefined, deadline: number) {
    const exams = await this.prisma.$queryRaw<{ id: string }[]>`SELECT id FROM exams WHERE status = 'CLOSING' AND "forceCloseAt" IS NOT NULL ${examId ? Prisma.sql`AND id = ${examId}` : Prisma.empty} LIMIT 20`;
    for (const e of exams) {
      while (Date.now() < deadline) {
        const ids = await this.prisma.$queryRaw<{ id: string }[]>`SELECT id FROM attempts WHERE "examId" = ${e.id} AND status = 'IN_PROGRESS' AND "lifecycleRetries" < ${MAX_ATTEMPT_RETRIES} LIMIT ${BATCH}`;
        if (!ids.length) break;
        await this.pool(ids.map((x) => x.id), async (id) => {
          try { await this.delivery.finalize(id, { mode: 'FORCED', reason: 'Examination closed by the controller', bulk: true }); stats.forceSealed++; }
          catch (err) { await this.prisma.$executeRaw`UPDATE attempts SET "lifecycleRetries" = "lifecycleRetries" + 1, "lifecycleError" = ${String((err as Error).message).slice(0, 200)} WHERE id = ${id}`; }
        });
      }
    }
  }

  /** CLOSING → CLOSED once nothing is in progress; and any not-yet-closed exam whose window is over with nothing in progress. */
  private async closeExams(stats: LifecycleStats, examId?: string) {
    await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT e.id FROM exams e
        WHERE (e.status = 'CLOSING' OR (e.status IN ('SCHEDULED', 'ADMISSION_OPEN', 'LIVE') AND e."closesAt" <= NOW(3)))
          AND NOT EXISTS (SELECT 1 FROM attempts a WHERE a."examId" = e.id AND a.status = 'IN_PROGRESS') ${examId ? Prisma.sql`AND e.id = ${examId}` : Prisma.empty}
        ORDER BY e."closesAt" LIMIT 50 FOR UPDATE SKIP LOCKED`;
      for (const r of rows) {
        await tx.$executeRaw`UPDATE exams SET status = 'CLOSED', "closedAt" = NOW(3), "admissionClosedAt" = COALESCE("admissionClosedAt", NOW(3)) WHERE id = ${r.id}`;
        await finishTransition(tx, this, { examId: r.id, actor: null, action: 'exam.lifecycle.close', meta: { by: 'reconciler' }, events: [{ type: 'EXAM_CLOSED', payload: {} }] });
        stats.closed++; this.metrics.lifecycleTransitions.inc({ kind: 'close' });
      }
    });
    if (stats.closed) this.events.nudge();
  }

  /** AUTOMATIC exams proceed from CLOSED to SCORING by themselves; MANUAL exams wait for INITIATE_SCORING. */
  private async autoScoring(stats: LifecycleStats, examId?: string) {
    await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM exams WHERE status = 'CLOSED' AND "controlMode" = 'AUTOMATIC' ${examId ? Prisma.sql`AND id = ${examId}` : Prisma.empty} LIMIT 50 FOR UPDATE SKIP LOCKED`;
      for (const r of rows) {
        await tx.$executeRaw`UPDATE exams SET status = 'SCORING' WHERE id = ${r.id}`;
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
      const pendingGrade = int((await this.prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM attempts a LEFT JOIN results r ON r."examId" = a."examId" AND r."studentId" = a."studentId" WHERE a."examId" = ${ex.id} AND (a.status = 'IN_PROGRESS' OR (a.status IN ('SUBMITTED','AUTO_SUBMITTED') AND r.id IS NULL))`)[0]!.n);
      if (pendingGrade > 0) continue;
      const moved = await this.prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM exams WHERE id = ${ex.id} AND status = 'SCORING' FOR UPDATE SKIP LOCKED`;
        if (!locked.length) return false;
        const absent = await tx.$queryRaw<{ studentId: string }[]>`SELECT c."studentId" FROM exam_candidates c WHERE c."examId" = ${ex.id} AND NOT EXISTS (SELECT 1 FROM attempts a WHERE a."examId" = ${ex.id} AND a."studentId" = c."studentId")`;
        await tx.result.createMany({ data: absent.map((s) => ({ examId: ex.id, studentId: s.studentId, rawScore: 0, totalMarks: ex.totalMarks, percent: 0, status: 'ABSENT' as const })), skipDuplicates: true });
        await tx.resultBatch.upsert({ where: { examId: ex.id }, create: { examId: ex.id }, update: {} });
        await tx.$executeRaw`UPDATE exams SET status = 'RESULT_PENDING' WHERE id = ${ex.id}`;
        await finishTransition(tx, this, { examId: ex.id, actor: null, action: 'exam.lifecycle.results_pending', meta: { absentees: absent.length }, events: [{ type: 'RESULTS_PENDING', payload: { absentees: absent.length } }] });
        return true;
      });
      if (moved) {
        stats.pending++; this.metrics.lifecycleTransitions.inc({ kind: 'results_pending' });
        await this.notifications.notifyRole('EXAMINER', 'Results ready for review', `${ex.code} — ${ex.title} has been graded.`, LINKS.exam(ex.id));
      }
    }
  }
  private async gradeUngraded(stats: LifecycleStats, examId: string | undefined, deadline: number) {
    while (Date.now() < deadline) {
      const ids = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT a.id FROM attempts a LEFT JOIN results r ON r."examId" = a."examId" AND r."studentId" = a."studentId"
        WHERE a.status IN ('SUBMITTED', 'AUTO_SUBMITTED') AND r.id IS NULL ${examId ? Prisma.sql`AND a."examId" = ${examId}` : Prisma.empty} LIMIT ${BATCH}`;
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
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY_ENV(), items.length) }, async () => { while (i < items.length) { const x = items[i++]!; await fn(x); } }));
  }

  // ───────────── health (for the control centre) ─────────────
  async health() {
    const last = (await this.prisma.$queryRaw<{ at: Date | null; age: number | null; instance: string | null; ms: number | null }[]>`
      SELECT "finishedAt" AS at, TIMESTAMPDIFF(MICROSECOND, "finishedAt", NOW(3)) / 1e6 AS age, instance, "durationMs" AS ms FROM lifecycle_runs WHERE error IS NULL AND "finishedAt" IS NOT NULL ORDER BY "startedAt" DESC LIMIT 1`)[0];
    const lastError = (await this.prisma.$queryRaw<{ at: Date; error: string }[]>`SELECT "startedAt" AS at, error FROM lifecycle_runs WHERE error IS NOT NULL ORDER BY "startedAt" DESC LIMIT 1`)[0];
    const lease = (await this.prisma.$queryRaw<{ owner: string; live: boolean }[]>`SELECT owner, "expiresAt" > NOW(3) AS live FROM lifecycle_leases WHERE name = 'lifecycle'`)[0];
    const b = (await this.prisma.$queryRaw<{ expired: bigint; poisoned: bigint }[]>`
      SELECT COUNT(CASE WHEN TIMESTAMPADD(SECOND, ${SAVE_GRACE_SECONDS + 15}, "deadlineAt") < NOW(3) AND "suspendedAt" IS NULL THEN 1 END) AS expired,
             COUNT(CASE WHEN "lifecycleRetries" >= ${MAX_ATTEMPT_RETRIES} THEN 1 END) AS poisoned FROM attempts WHERE status = 'IN_PROGRESS'`)[0]!;
    const backlog = { expired: int(b.expired), poisoned: int(b.poisoned) };
    const stale = last?.age == null || last.age > 30;
    return { lastRunAt: last?.at ?? null, lastRunAgeSeconds: last?.age ?? null, lastRunDurationMs: last?.ms ?? null, lastRunInstance: last?.instance ?? null, lastError: lastError ?? null, leaseOwner: lease?.live ? lease.owner : null,
      expiredBacklog: backlog.expired, poisonedAttempts: backlog.poisoned, status: stale ? 'STALE' : backlog.expired > 0 || backlog.poisoned > 0 ? 'DEGRADED' : 'OK' };
  }
}
