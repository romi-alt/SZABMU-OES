import { Injectable, OnModuleInit } from '@nestjs/common';
import { HEARTBEAT_STALE_SECONDS } from '@oes/shared';
import { Prisma } from '../../generated/prisma/client';
import { scope, type AuthUser } from '../../common/auth';
import { notFound } from '../../common/errors';
import { PrismaService } from '../../infra/prisma.service';
import { RedisService } from '../../infra/redis.service';
import { ExamEventsService, type Subscriber, type Viewer } from './events.service';

export interface CampusStat { institutionId: string; code: string; name: string; allocated: number; eligible: number; entered: number; inProgress: number; suspended: number; submitted: number; autoSubmitted: number; incidents: number; online: number | null; disconnected: number | null; attendancePct: number | null; warning: string | null }
interface Raw { at: number; status: string; stateVersion: number; campuses: Omit<CampusStat, 'online' | 'disconnected' | 'warning' | 'attendancePct'>[]; online: Map<string, number> | null; cursor: number }

interface Row { studentId: string; regNo: string; fullName: string; institution: string; institutionId: string; rosterStatus: string; attemptId: string | null; status: string | null; suspendedAt: Date | null; deadlineAt: Date | null; startedAt: Date | null; integrityFlags: number | null; extraTimeMin: number; answered: number | null; lastSavedAt: Date | null }
const hbzKey = (examId: string, inst?: string) => (inst ? `hbz:${examId}:${inst}` : `hbz:${examId}`);
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
  constructor(private readonly prisma: PrismaService, private readonly redis: RedisService, private readonly events: ExamEventsService) {}
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
    if (hit && Date.now() - hit.at < TTL_MS) return hit.p;
    const p = this.compute(examId);
    this.cache.set(examId, { at: Date.now(), p });
    p.catch(() => this.cache.delete(examId));
    if (this.cache.size > 200) for (const [k, v] of this.cache) if (Date.now() - v.at > 60_000) this.cache.delete(k);
    return p;
  }

  private async compute(examId: string): Promise<Raw> {
    const ex = (await this.prisma.$queryRaw<{ status: string; v: number }[]>`SELECT status::text AS status, "stateVersion" AS v FROM exams WHERE id = ${examId}::uuid`)[0];
    if (!ex) throw notFound('Exam');
    const campuses = await this.prisma.$queryRaw<Raw['campuses']>`
      WITH c AS (SELECT "institutionId", count(*)::int AS allocated, count(*) FILTER (WHERE status = 'ADMITTED')::int AS eligible FROM exam_candidates WHERE "examId" = ${examId}::uuid GROUP BY 1),
           a AS (SELECT c."institutionId", count(*)::int AS entered,
                        count(*) FILTER (WHERE a.status = 'IN_PROGRESS' AND a."suspendedAt" IS NULL)::int AS "inProgress",
                        count(*) FILTER (WHERE a.status = 'IN_PROGRESS' AND a."suspendedAt" IS NOT NULL)::int AS suspended,
                        count(*) FILTER (WHERE a.status = 'SUBMITTED')::int AS submitted, count(*) FILTER (WHERE a.status = 'AUTO_SUBMITTED')::int AS "autoSubmitted"
                 FROM attempts a JOIN exam_candidates c ON c."examId" = a."examId" AND c."studentId" = a."studentId" WHERE a."examId" = ${examId}::uuid GROUP BY 1),
           i AS (SELECT "institutionId", count(*)::int AS n FROM incidents WHERE "examId" = ${examId}::uuid AND status IN ('OPEN', 'INVESTIGATING') GROUP BY 1)
      SELECT ei."institutionId", inst.code, inst.name, COALESCE(c.allocated, 0) AS allocated, COALESCE(c.eligible, 0) AS eligible, COALESCE(a.entered, 0) AS entered,
             COALESCE(a."inProgress", 0) AS "inProgress", COALESCE(a.suspended, 0) AS suspended, COALESCE(a.submitted, 0) AS submitted, COALESCE(a."autoSubmitted", 0) AS "autoSubmitted", COALESCE(i.n, 0) AS incidents
      FROM exam_institutions ei JOIN institutions inst ON inst.id = ei."institutionId"
      LEFT JOIN c ON c."institutionId" = ei."institutionId" LEFT JOIN a ON a."institutionId" = ei."institutionId" LEFT JOIN i ON i."institutionId" = ei."institutionId"
      WHERE ei."examId" = ${examId}::uuid ORDER BY inst.code`;
    let online: Map<string, number> | null = null;
    if (this.redis.available) {
      try {
        const min = Date.now() - HEARTBEAT_STALE_SECONDS * 1000; const p = this.redis.client.pipeline();
        for (const c of campuses) p.zcount(hbzKey(examId, c.institutionId), min, '+inf');
        const res = await p.exec();
        if (res && res.every(([e]) => !e)) online = new Map(campuses.map((c, i) => [c.institutionId, Number(res[i]![1])]));
      } catch { online = null; }
    }
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
    const reasons: string[] = []; if (raw.online === null) reasons.push('Connection state unavailable (Redis heartbeat store not reachable)');
    if (!this.events.redisSubscriberUp) reasons.push('Live event channel degraded: updates are delivered from the database with a short delay');
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
    const instFilter = only === null ? Prisma.empty : Prisma.sql`AND c."institutionId" = ANY(${only}::uuid[])`;
    const statusFilter = !q.status ? Prisma.empty
      : q.status === 'NOT_STARTED' ? Prisma.sql`AND a.id IS NULL` : q.status === 'SUSPENDED' ? Prisma.sql`AND a.status = 'IN_PROGRESS' AND a."suspendedAt" IS NOT NULL`
      : q.status === 'IN_PROGRESS' ? Prisma.sql`AND a.status = 'IN_PROGRESS' AND a."suspendedAt" IS NULL` : Prisma.sql`AND a.status = ${q.status}::"AttemptStatus"`;
    const search = q.search?.trim() ? Prisma.sql`AND (s."regNo" ILIKE ${'%' + q.search.trim().replace(/[%_\\]/g, '\\$&') + '%'} OR u."fullName" ILIKE ${'%' + q.search.trim().replace(/[%_\\]/g, '\\$&') + '%'})` : Prisma.empty;
    const from = Prisma.sql`FROM exam_candidates c JOIN students s ON s.id = c."studentId" JOIN users u ON u.id = s."userId" JOIN institutions i ON i.id = c."institutionId"
      LEFT JOIN attempts a ON a."examId" = c."examId" AND a."studentId" = c."studentId"`;
    const where = Prisma.sql`WHERE c."examId" = ${examId}::uuid ${instFilter} ${statusFilter} ${search}`;
    const total = (await this.prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n ${from} ${where}`)[0]!.n;
    const rows = await this.prisma.$queryRaw<Row[]>`
      SELECT c."studentId", s."regNo", u."fullName", i.code AS institution, c."institutionId", c.status::text AS "rosterStatus", a.id AS "attemptId", a.status::text AS status,
             a."suspendedAt", a."deadlineAt", a."startedAt", a."integrityFlags", c."extraTimeMin", ans.n AS answered, ans.last AS "lastSavedAt"
      ${from}
      LEFT JOIN LATERAL (SELECT count(*) FILTER (WHERE state = 'ANSWERED')::int AS n, max("savedAt") AS last FROM attempt_answers WHERE "attemptId" = a.id) ans ON a.id IS NOT NULL
      ${where} ORDER BY s."regNo" LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`;
    return { total, page, pageSize, serverNow: new Date().toISOString(), rows: await this.withConnection(examId, rows) };
  }

  /** Connection state for the rows on screen only (one pipelined ZSCORE per attempt on the page). Unknown without Redis — never guessed. */
  private async withConnection(examId: string, rows: Row[]) {
    let beats: (number | null)[] | null = null;
    const live = rows.filter((r) => r.attemptId && r.status === 'IN_PROGRESS');
    if (live.length && this.redis.available) {
      try { const p = this.redis.client.pipeline(); for (const r of live) p.zscore(hbzKey(examId), r.attemptId!); const res = await p.exec(); if (res?.every(([e]) => !e)) beats = res.map(([, v]) => (v == null ? null : Number(v))); } catch { beats = null; }
    }
    const idx = new Map(live.map((r, i) => [r.attemptId!, i])); const now = Date.now();
    return rows.map((r) => {
      let connection: 'NOT_STARTED' | 'FINISHED' | 'SUSPENDED' | 'ONLINE' | 'DISCONNECTED' | 'UNKNOWN';
      let lastSeenAt: string | null = null;
      if (!r.attemptId) connection = 'NOT_STARTED';
      else if (r.status !== 'IN_PROGRESS') connection = 'FINISHED';
      else if (r.suspendedAt) connection = 'SUSPENDED';
      else if (!beats) connection = 'UNKNOWN';
      else { const t = beats[idx.get(r.attemptId)!]; if (t) lastSeenAt = new Date(t).toISOString(); connection = (t && now - t <= HEARTBEAT_STALE_SECONDS * 1000) || (!t && now - r.startedAt!.getTime() < 60_000) ? 'ONLINE' : 'DISCONNECTED'; }
      return { studentId: r.studentId, regNo: r.regNo, fullName: r.fullName, institution: r.institution, rosterStatus: r.rosterStatus, attemptId: r.attemptId, status: r.status ?? 'NOT_STARTED', suspended: !!r.suspendedAt, deadlineAt: r.deadlineAt, startedAt: r.startedAt, integrityFlags: r.integrityFlags ?? 0, extraTimeMin: r.extraTimeMin, answered: r.answered ?? 0, lastConfirmedSaveAt: r.lastSavedAt, connection, lastSeenAt };
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
