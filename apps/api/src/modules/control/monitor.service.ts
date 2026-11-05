import { Injectable, OnModuleInit } from '@nestjs/common';
import { HEARTBEAT_STALE_SECONDS } from '@oes/shared';
import { Prisma } from '../../generated/prisma/client';
import { scope, type AuthUser } from '../../common/auth';
import { notFound } from '../../common/errors';
import { MetricsService } from '../../infra/metrics.service';
import { PrismaService } from '../../infra/prisma.service';
import { idList, int } from '../../infra/sql';
import { KvService } from '../../infra/kv.service';
import { ExamEventsService, type Subscriber, type Viewer } from './events.service';

export interface CampusStat { institutionId: string; code: string; name: string; allocated: number; eligible: number; entered: number; inProgress: number; suspended: number; submitted: number; autoSubmitted: number; incidents: number; online: number | null; disconnected: number | null; attendancePct: number | null; warning: string | null }
interface Raw { at: number; status: string; stateVersion: number; campuses: Omit<CampusStat, 'online' | 'disconnected' | 'warning' | 'attendancePct'>[]; online: Map<string, number> | null; cursor: number }

interface Row { studentId: string; regNo: string; fullName: string; institution: string; institutionId: string; rosterStatus: string; attemptId: string | null; status: string | null; suspendedAt: Date | null; deadlineAt: Date | null; startedAt: Date | null; integrityFlags: number | null; extraTimeMin: number; answered: number | null; lastSavedAt: Date | null }
const TTL_MS = 1500;
export const CANDIDATE_STATUS = ['NOT_STARTED', 'IN_PROGRESS', 'SUSPENDED', 'SUBMITTED', 'AUTO_SUBMITTED'] as const;
export type CandidateFilter = (typeof CANDIDATE_STATUS)[number];

/**
 * Bounded, campus-scoped live monitoring.
 *  - ONE aggregate query per exam per process per ~1.5 s (single-flight cache), shared by every viewer; per-viewer data is a filter of
 *    that cache in memory — no per-viewer database scan.
 *  - Candidate detail is a paginated query (page ≤ 100) for the rows on screen only.
 *  - Connectivity comes from Redis sorted sets (O(log n) counts); without Redis the numbers are reported as null + degraded, never invented.
 */
@Injectable()
export class MonitorService implements OnModuleInit {
  private readonly cache = new Map<string, { at: number; p: Promise<Raw> }>();
  /** How long the last aggregate took per exam: the cache window stretches to 4× that, so a slow aggregate can never recompute back-to-back. */
  private readonly lastMs = new Map<string, number>();
  constructor(private readonly prisma: PrismaService, private readonly kv: KvService, private readonly events: ExamEventsService, private readonly metrics: MetricsService) {}
  onModuleInit() { this.events.onTick = (examId, subs) => this.pushStats(examId, subs); }

  // ───────────── who may look at what ─────────────
  /** Staff viewer for an exam: invigilators only where assigned (∩ their scope); everyone else their institution scope. 404 when nothing is in scope. */
  async staffViewer(u: AuthUser, examId: string): Promise<Viewer> {
    if (u.role === 'INVIGILATOR') {
      const rows = await this.prisma.examInvigilator.findMany({ where: { examId, userId: u.id }, select: { institutionId: true } });
      const ids = rows.map((r) => r.institutionId).filter((i) => scope.allows(u, i));
      if (!ids.length) throw notFound('Exam');
      return { institutionIds: ids };
    }
    const exam = await this.prisma.exam.findFirst({ where: { id: examId, ...(u.institutionIds === null ? {} : { institutions: { some: { institutionId: { in: u.institutionIds } } } }) }, select: { id: true } });
    if (!exam) throw notFound('Exam');
    return { institutionIds: u.institutionIds };
  }
  async studentViewer(u: AuthUser, examId: string): Promise<Viewer> {
    if (!u.studentId) throw notFound('Exam');
    const c = await this.prisma.examCandidate.findUnique({ where: { examId_studentId: { examId, studentId: u.studentId } }, select: { institutionId: true } });
    if (!c) throw notFound('Exam');
    return { institutionIds: [c.institutionId], student: { id: u.studentId, institutionId: c.institutionId } };
  }

  // ───────────── aggregate snapshot ─────────────
  private raw(examId: string): Promise<Raw> {
    const hit = this.cache.get(examId);
    if (hit && Date.now() - hit.at < Math.max(TTL_MS, 4 * (this.lastMs.get(examId) ?? 0))) return hit.p;
    const t0 = process.hrtime.bigint();
    const p = this.compute(examId).then((r) => { const sec = Number(process.hrtime.bigint() - t0) / 1e9; this.metrics.monitorCompute.observe({}, sec); this.lastMs.set(examId, sec * 1000); return r; });
    this.cache.set(examId, { at: Date.now(), p });
    p.catch(() => this.cache.delete(examId));
    if (this.cache.size > 200) for (const [k, v] of this.cache) if (Date.now() - v.at > 60_000) this.cache.delete(k);
    return p;
  }

  private async compute(examId: string): Promise<Raw> {
    const ex = (await this.prisma.$queryRaw<{ status: string; v: number }[]>`SELECT status, "stateVersion" AS v FROM exams WHERE id = ${examId}`)[0];
    if (!ex) throw notFound('Exam');
    type Counts = Record<'allocated' | 'eligible' | 'entered' | 'inProgress' | 'suspended' | 'submitted' | 'autoSubmitted' | 'incidents', bigint | number>;
    const counted = await this.prisma.$queryRaw<(Omit<Raw['campuses'][number], keyof Counts> & Counts)[]>`
      WITH c AS (SELECT "institutionId", COUNT(*) AS allocated, COUNT(CASE WHEN status = 'ADMITTED' THEN 1 END) AS eligible FROM exam_candidates WHERE "examId" = ${examId} GROUP BY "institutionId"),
           a AS (SELECT c."institutionId", COUNT(*) AS entered,
                        COUNT(CASE WHEN a.status = 'IN_PROGRESS' AND a."suspendedAt" IS NULL THEN 1 END) AS "inProgress",
                        COUNT(CASE WHEN a.status = 'IN_PROGRESS' AND a."suspendedAt" IS NOT NULL THEN 1 END) AS suspended,
                        COUNT(CASE WHEN a.status = 'SUBMITTED' THEN 1 END) AS submitted, COUNT(CASE WHEN a.status = 'AUTO_SUBMITTED' THEN 1 END) AS "autoSubmitted"
                 FROM attempts a JOIN exam_candidates c ON c."examId" = a."examId" AND c."studentId" = a."studentId" WHERE a."examId" = ${examId} GROUP BY c."institutionId"),
           i AS (SELECT "institutionId", COUNT(*) AS n FROM incidents WHERE "examId" = ${examId} AND status IN ('OPEN', 'INVESTIGATING') GROUP BY "institutionId")
      SELECT ei."institutionId", inst.code, inst.name, COALESCE(c.allocated, 0) AS allocated, COALESCE(c.eligible, 0) AS eligible, COALESCE(a.entered, 0) AS entered,
             COALESCE(a."inProgress", 0) AS "inProgress", COALESCE(a.suspended, 0) AS suspended, COALESCE(a.submitted, 0) AS submitted, COALESCE(a."autoSubmitted", 0) AS "autoSubmitted", COALESCE(i.n, 0) AS incidents
      FROM exam_institutions ei JOIN institutions inst ON inst.id = ei."institutionId"
      LEFT JOIN c ON c."institutionId" = ei."institutionId" LEFT JOIN a ON a."institutionId" = ei."institutionId" LEFT JOIN i ON i."institutionId" = ei."institutionId"
      WHERE ei."examId" = ${examId} ORDER BY inst.code`;
    // MySQL counts are BIGINT; the snapshot does arithmetic on them.
    const campuses: Raw['campuses'] = counted.map((c) => ({ ...c, allocated: int(c.allocated), eligible: int(c.eligible), entered: int(c.entered), inProgress: int(c.inProgress),
      suspended: int(c.suspended), submitted: int(c.submitted), autoSubmitted: int(c.autoSubmitted), incidents: int(c.incidents) }));
    const online = await this.kv.onlineByCampus(examId, campuses.map((c) => c.institutionId), Date.now() - HEARTBEAT_STALE_SECONDS * 1000);
    return { at: Date.now(), status: ex.status, stateVersion: ex.v, campuses, online, cursor: await this.events.latestId(examId) };
  }

  /** The authoritative snapshot for ONE viewer: the cached aggregate restricted to the campuses they may see. */
  async snapshot(viewer: Viewer, examId: string) {
    const raw = await this.raw(examId);
    const mine = raw.campuses.filter((c) => viewer.institutionIds === null || viewer.institutionIds.includes(c.institutionId));
    const campuses: CampusStat[] = mine.map((c) => {
      const online = raw.online ? Math.min(raw.online.get(c.institutionId) ?? 0, c.inProgress) : null;
      const disconnected = online === null ? null : Math.max(0, c.inProgress - online);
      const warning = disconnected !== null && disconnected >= 2 && disconnected / Math.max(1, c.inProgress) >= 0.1 ? `${disconnected} of ${c.inProgress} candidates disconnected` : null;
      return { ...c, online, disconnected, attendancePct: c.eligible ? Math.round((c.entered / c.eligible) * 1000) / 10 : null, warning };
    });
    const sum = (f: (c: CampusStat) => number | null) => campuses.some((c) => f(c) === null) ? null : campuses.reduce((n, c) => n + (f(c) ?? 0), 0);
    const t = {
      allocated: sum((c) => c.allocated)!, eligible: sum((c) => c.eligible)!, admitted: sum((c) => c.entered)!, inProgress: sum((c) => c.inProgress)!, suspended: sum((c) => c.suspended)!,
      online: sum((c) => c.online), disconnected: sum((c) => c.disconnected), submitted: sum((c) => c.submitted)!, autoSubmitted: sum((c) => c.autoSubmitted)!, activeIncidents: sum((c) => c.incidents)!,
    };
    const reasons: string[] = []; if (raw.online === null) reasons.push('Connection state unavailable (heartbeat store not reachable)');
    if (!this.events.liveChannelUp) reasons.push('Live event channel degraded: updates are delivered from the database with a short delay');
    return {
      examId, serverNow: new Date().toISOString(), status: raw.status, stateVersion: raw.stateVersion, cursor: raw.cursor,
      freshness: { computedAt: new Date(raw.at).toISOString(), ageMs: Date.now() - raw.at, degraded: reasons.length > 0, reasons },
      scope: { universityWide: viewer.institutionIds === null, campuses: campuses.length },
      totals: { ...t, remaining: Math.max(0, t.eligible - t.submitted - t.autoSubmitted), campusesParticipating: campuses.length, campusesActive: campuses.filter((c) => c.inProgress > 0).length },
      campuses,
    };
  }

  // ───────────── paginated candidate detail ─────────────
  async candidates(viewer: Viewer, examId: string, q: { page: number; pageSize: number; institutionId?: string; status?: CandidateFilter; search?: string }) {
    const pageSize = Math.min(100, Math.max(1, q.pageSize)); const page = Math.max(1, q.page);
    // an institution named by the caller must be inside their scope; an out-of-scope id yields nothing rather than widening the query
    const ids = viewer.institutionIds === null ? null : viewer.institutionIds;
    const only = q.institutionId ? (ids === null || ids.includes(q.institutionId) ? [q.institutionId] : []) : ids;
    const instFilter = only === null ? Prisma.empty : Prisma.sql`AND c."institutionId" IN ${idList(only)}`;
    const statusFilter = !q.status ? Prisma.empty
      : q.status === 'NOT_STARTED' ? Prisma.sql`AND a.id IS NULL` : q.status === 'SUSPENDED' ? Prisma.sql`AND a.status = 'IN_PROGRESS' AND a."suspendedAt" IS NOT NULL`
      : q.status === 'IN_PROGRESS' ? Prisma.sql`AND a.status = 'IN_PROGRESS' AND a."suspendedAt" IS NULL` : Prisma.sql`AND a.status = ${q.status}`;
    const search = q.search?.trim() ? Prisma.sql`AND (s."regNo" LIKE ${'%' + q.search.trim().replace(/[%_\\]/g, '\\$&') + '%'} OR u."fullName" LIKE ${'%' + q.search.trim().replace(/[%_\\]/g, '\\$&') + '%'})` : Prisma.empty;
    const from = Prisma.sql`FROM exam_candidates c JOIN students s ON s.id = c."studentId" JOIN users u ON u.id = s."userId" JOIN institutions i ON i.id = c."institutionId"
      LEFT JOIN attempts a ON a."examId" = c."examId" AND a."studentId" = c."studentId"`;
    const where = Prisma.sql`WHERE c."examId" = ${examId} ${instFilter} ${statusFilter} ${search}`;
    const total = int((await this.prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n ${from} ${where}`)[0]!.n);
    const rows = await this.prisma.$queryRaw<Row[]>`
      SELECT c."studentId", s."regNo", u."fullName", i.code AS institution, c."institutionId", c.status AS "rosterStatus", a.id AS "attemptId", a.status AS status,
             a."suspendedAt", a."deadlineAt", a."startedAt", a."integrityFlags", c."extraTimeMin",
             (SELECT COUNT(CASE WHEN aa.state = 'ANSWERED' THEN 1 END) FROM attempt_answers aa WHERE aa."attemptId" = a.id) AS answered,
             (SELECT MAX(aa."savedAt") FROM attempt_answers aa WHERE aa."attemptId" = a.id) AS "lastSavedAt"
      ${from}
      ${where} ORDER BY s."regNo" LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`;
    return { total, page, pageSize, serverNow: new Date().toISOString(), rows: await this.withConnection(examId, rows) };
  }

  /** Connection state for the rows on screen only (one pipelined ZSCORE per attempt on the page). Unknown when the heartbeat store is down — never guessed. */
  private async withConnection(examId: string, rows: Row[]) {
    const live = rows.filter((r) => r.attemptId && r.status === 'IN_PROGRESS');
    const beats = live.length ? await this.kv.lastBeats(examId, live.map((r) => r.attemptId!)) : null;
    const idx = new Map(live.map((r, i) => [r.attemptId!, i])); const now = Date.now();
    return rows.map((r) => {
      let connection: 'NOT_STARTED' | 'FINISHED' | 'SUSPENDED' | 'ONLINE' | 'DISCONNECTED' | 'UNKNOWN';
      let lastSeenAt: string | null = null;
      if (!r.attemptId) connection = 'NOT_STARTED';
      else if (r.status !== 'IN_PROGRESS') connection = 'FINISHED';
      else if (r.suspendedAt) connection = 'SUSPENDED';
      else if (!beats) connection = 'UNKNOWN';
      else { const t = beats[idx.get(r.attemptId)!]; if (t) lastSeenAt = new Date(t).toISOString(); connection = (t && now - t <= HEARTBEAT_STALE_SECONDS * 1000) || (!t && now - r.startedAt!.getTime() < 60_000) ? 'ONLINE' : 'DISCONNECTED'; }
      return { studentId: r.studentId, regNo: r.regNo, fullName: r.fullName, institution: r.institution, rosterStatus: r.rosterStatus, attemptId: r.attemptId, status: r.status ?? 'NOT_STARTED', suspended: !!r.suspendedAt, deadlineAt: r.deadlineAt, startedAt: r.startedAt, integrityFlags: r.integrityFlags ?? 0, extraTimeMin: r.extraTimeMin, answered: r.answered === null ? 0 : Number(r.answered), lastConfirmedSaveAt: r.lastSavedAt, connection, lastSeenAt };
    });
  }

  // ───────────── live pushes ─────────────
  private async pushStats(examId: string, subs: Subscriber[]) {
    for (const s of subs) {
      if (!s.sendStats || s.viewer.student) continue;
      const snap = await this.snapshot(s.viewer, examId);
      const key = `${snap.stateVersion}|${snap.cursor}|${JSON.stringify(snap.totals)}|${JSON.stringify(snap.campuses.map((c) => [c.inProgress, c.submitted, c.autoSubmitted, c.disconnected, c.incidents]))}|${snap.freshness.degraded}`;
      if (key !== s.statsKey || Date.now() - (s.statsAt ?? 0) > 15_000) { s.statsKey = key; s.statsAt = Date.now(); s.sendStats(snap); }
    }
  }
}
