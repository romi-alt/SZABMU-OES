import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { SAVE_GRACE_SECONDS, computeDeadline, computeSyncDeadline, seededOrder } from '@oes/shared';
import { startableStates, type ExamState } from '../control/exam-state';
import { answerDigest, receiptCode } from '@oes/shared/server';
import { PrismaService } from '../../infra/prisma.service';
import { RedisService } from '../../infra/redis.service';
import { QUEUES, QueuesService } from '../../infra/queues.service';
import { AuditService } from '../audit/audit.service';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../common/errors';
import type { AuthUser } from '../../common/auth';
import { CONFIG, type Config } from '../../config';

export interface SaveInput {
  clientId: string;
  revision: number;
  selectedLabel: 'A' | 'B' | 'C' | 'D' | 'E' | null;
  state: 'ANSWERED' | 'SKIPPED' | 'CLEARED';
  markedForReview: boolean;
  visited: boolean;
}
export interface PaperQuestion { id: string; position: number; marks: number; type: string; vignette: string | null; stem: string; options: { label: string; text: string }[] }

@Injectable()
export class DeliveryService {
  private readonly log = new Logger('Delivery');
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly queues: QueuesService,
    private readonly audit: AuditService,
    @Inject(CONFIG) private readonly cfg: Config,
  ) {}

  private studentIdOf(u: AuthUser) {
    if (!u.studentId) throw forbidden('No student profile is linked to this account');
    return u.studentId;
  }

  /** The approved paper is immutable, so the candidate-facing view is safe to cache. Never contains the key. */
  async paperFor(examId: string): Promise<PaperQuestion[]> {
    const key = `paper:${examId}`;
    const hit = await this.redis.getJson<PaperQuestion[]>(key);
    if (hit) return hit;
    const rows = await this.prisma.examQuestion.findMany({ where: { examId }, orderBy: { position: 'asc' } });
    const paper = rows.map((r) => {
      const s = r.snapshot as { type: string; vignette: string | null; stem: string; options: { label: string; text: string }[] };
      return { id: r.id, position: r.position, marks: r.marks, type: s.type, vignette: s.vignette, stem: s.stem, options: s.options };
    });
    await this.redis.setJson(key, paper, 3600);
    return paper;
  }

  // ───────────── student: exam list ─────────────
  async myExams(u: AuthUser) {
    const studentId = this.studentIdOf(u);
    const now = await this.prisma.dbNow();
    const cands = await this.prisma.examCandidate.findMany({
      where: { studentId, exam: { status: { in: ['SCHEDULED', 'ADMISSION_OPEN', 'LIVE', 'SUSPENDED', 'CLOSING', 'CLOSED', 'SCORING', 'RESULT_PENDING', 'PUBLISHED'] } } },
      include: { exam: { include: { course: { select: { code: true, title: true, semester: true } }, _count: { select: { questions: true } } } } },
      orderBy: { exam: { opensAt: 'asc' } },
    });
    const attempts = await this.prisma.attempt.findMany({ where: { studentId, examId: { in: cands.map((c) => c.examId) } }, select: { id: true, examId: true, status: true, receiptCode: true, submittedAt: true, deadlineAt: true, suspendedAt: true } });
    const am = new Map(attempts.map((a) => [a.examId, a]));
    return {
      serverNow: now,
      items: cands.map((c) => {
        const a = am.get(c.examId) ?? null;
        // A NEW attempt needs the control state to allow entry (admission open, not suspended, not closed) and the window; AUTOMATIC exams also follow the clock.
        const open = startableStates(c.exam.controlMode).includes(c.exam.status as ExamState) && !c.exam.admissionClosedAt && now < c.exam.closesAt
          && (c.exam.controlMode === 'MANUAL' || !!c.exam.officialStartAt || now >= c.exam.opensAt);
        const inProgress = a?.status === 'IN_PROGRESS';
        // A new attempt needs an ADMITTED roster decision; resuming an in-progress attempt never re-evaluates eligibility.
        const canStart = (c.status === 'ADMITTED' && open && !a) || (open && inProgress) || (inProgress && (!!a!.suspendedAt || now < new Date(a!.deadlineAt.getTime() + SAVE_GRACE_SECONDS * 1000)));
        return {
          examId: c.examId, code: c.exam.code, title: c.exam.title, course: c.exam.course, status: c.exam.status, opensAt: c.exam.opensAt, closesAt: c.exam.closesAt,
          durationMin: c.exam.durationMin + c.extraTimeMin, totalMarks: c.exam.totalMarks, questionCount: c.exam._count.questions, instructions: c.exam.instructions, negativeMarking: c.exam.negativeMarking,
          attempt: a && { id: a.id, status: a.status, receiptCode: a.receiptCode, submittedAt: a.submittedAt }, canStart, timingPolicy: c.exam.timingPolicy, suspended: !!a?.suspendedAt,
          admission: c.exam.status === 'ADMISSION_OPEN' ? 'OPEN' : c.exam.admissionClosedAt ? 'CLOSED' : undefined,
        };
      }),
    };
  }

  /**
   * Admission gate for a NEW attempt, from authoritative local records only (no external calls).
   * The result is stored on the attempt and is never re-evaluated afterwards (not on resume, not per save).
   */
  private async admit(u: AuthUser, cand: { studentId: string; institutionId: string; status: string; decisionSource: string; rosterVersion: number }, exam: { id: string; courseId: string; term: string }, now: Date) {
    if (cand.status !== 'ADMITTED') throw new AppError(403, 'ADMISSION_REVOKED', 'Your admission to this examination has been withdrawn. Please contact your campus examinations office.');
    const [student, enr, parts] = await Promise.all([
      this.prisma.student.findUnique({ where: { id: cand.studentId }, select: { userId: true, status: true, institutionId: true, user: { select: { active: true } } } }),
      this.prisma.enrollment.findUnique({ where: { studentId_courseId_term: { studentId: cand.studentId, courseId: exam.courseId, term: exam.term } }, select: { id: true, status: true, eligibility: true } }),
      this.prisma.examInstitution.findMany({ where: { examId: exam.id }, select: { institutionId: true } }),
    ]);
    if (!student || student.userId !== u.id) throw forbidden('This candidate record does not belong to your account');
    if (!student.user.active || student.status !== 'ACTIVE') throw new AppError(403, 'ACCOUNT_RESTRICTED', 'Your account is currently restricted. Please contact your campus examinations office.');
    if (student.institutionId !== cand.institutionId || !parts.some((p) => p.institutionId === student.institutionId)) throw forbidden('You are not assigned to sit this examination at your institution');
    if (cand.decisionSource !== 'OVERRIDE' && (!enr || enr.status !== 'ENROLLED' || enr.eligibility === 'INELIGIBLE')) throw new AppError(403, 'NOT_ELIGIBLE', 'You are not currently eligible for this examination. Please contact your campus examinations office.');
    return { decision: 'ADMITTED', source: cand.decisionSource, rosterVersion: cand.rosterVersion, enrollmentId: enr?.id ?? null, enrolmentEligibility: enr?.eligibility ?? null, at: now.toISOString() };
  }

  // ───────────── start / resume ─────────────
  async start(u: AuthUser, examId: string, clientId: string, ip?: string, ua?: string) {
    const studentId = this.studentIdOf(u);
    const cand = await this.prisma.examCandidate.findUnique({ where: { examId_studentId: { examId, studentId } }, include: { exam: true } });
    if (!cand) throw forbidden('You are not on the roster for this examination');
    const exam = cand.exam;
    const now = await this.prisma.dbNow();

    let attempt = await this.prisma.attempt.findUnique({ where: { examId_studentId: { examId, studentId } } });
    if (attempt && attempt.status !== 'IN_PROGRESS') throw conflict('ALREADY_SUBMITTED', 'You have already submitted this examination', { receiptCode: attempt.receiptCode, submittedAt: attempt.submittedAt });
    if (attempt && (await this.isExpired(attempt, now))) {
      await this.finalize(attempt.id, { mode: 'AUTO' });
      throw conflict('TIME_EXPIRED', 'Your time has ended; the attempt was submitted automatically');
    }
    if (!attempt) {
      if (exam.admissionClosedAt && ['SCHEDULED', 'ADMISSION_OPEN', 'LIVE', 'SUSPENDED', 'CLOSING'].includes(exam.status)) throw conflict('ADMISSION_CLOSED', 'Admission to this examination has closed. Contact the examination office.', { status: exam.status, serverNow: now });
      if (exam.status === 'SUSPENDED') throw conflict('EXAM_SUSPENDED', 'The examination is suspended. Wait for instructions from the examination office.', { status: exam.status, serverNow: now });
      if (!startableStates(exam.controlMode).includes(exam.status as ExamState) || exam.paperStatus !== 'APPROVED') throw conflict('NOT_AVAILABLE', 'This examination is not available', { status: exam.status, serverNow: now });
      if (exam.admissionClosedAt) throw conflict('ADMISSION_CLOSED', 'Admission to this examination has closed. Contact the examination office.', { status: exam.status, serverNow: now });
      const hold = await this.prisma.examSuspension.findFirst({ where: { examId, resumedAt: null, OR: [{ scope: 'CAMPUS', institutionId: cand.institutionId }, { scope: 'CANDIDATES', studentIds: { has: studentId } }] }, select: { id: true } });
      if (hold) throw conflict('EXAM_SUSPENDED', 'Your examination is suspended. Wait for instructions from the examination office.', { status: exam.status, serverNow: now });
      if (exam.controlMode === 'AUTOMATIC' && !exam.officialStartAt && now < exam.opensAt) throw conflict('NOT_OPEN', 'The examination has not opened yet', { opensAt: exam.opensAt, serverNow: now });
      if (now >= exam.closesAt) throw conflict('CLOSED', 'The examination window has closed');
      // SYNCHRONIZED: candidates may enter the lobby once admission is open, but the paper is only delivered when the controller starts the exam.
      if (exam.timingPolicy === 'SYNCHRONIZED' && exam.status !== 'LIVE') throw conflict('WAITING_FOR_START', 'You are admitted. The examination has not been started yet — please wait.', { status: exam.status, serverNow: now, timingPolicy: exam.timingPolicy });
      const admission = await this.admit(u, cand, exam, now);
      const paper = await this.paperFor(examId);
      if (!paper.length) throw conflict('NOT_AVAILABLE', 'This examination has no questions');
      const deadline = exam.timingPolicy === 'SYNCHRONIZED' ? await this.syncDeadline(exam, cand.extraTimeMin) : computeDeadline({ startedAt: now, durationMin: exam.durationMin, extraTimeMin: cand.extraTimeMin, windowEndsAt: exam.closesAt });
      const id = randomUUID();
      const ids = paper.map((q) => q.id);
      const order = exam.shuffleQuestions ? seededOrder(ids, id) : ids;
      try {
        // One insert: order, deadline and the active-client claim are fixed atomically.
        // Per-candidate lifecycle lives in `attempts`/`attempt_events` (authoritative); the globally
        // serialised hash-chained audit log is reserved for staff/administrative actions.
        attempt = await this.prisma.attempt.create({ data: { id, examId, studentId, startedAt: now, deadlineAt: deadline, extraTimeMin: cand.extraTimeMin, questionOrder: order, activeClientId: clientId, clientEpoch: 1, admission, ip, userAgent: ua?.slice(0, 300), events: { create: [{ kind: 'STARTED', detail: { clientId } }] } } });
      } catch (e) {
        if (e.code !== 'P2002') throw e; // concurrent double-start: fall through and resume the winner
        attempt = await this.prisma.attempt.findUniqueOrThrow({ where: { examId_studentId: { examId, studentId } } });
      }
    }
    // Claim the single active client slot; any older tab is now stale and will be rejected on save.
    let fresh = attempt;
    if (attempt.activeClientId !== clientId) {
      const claimed = await this.prisma.$queryRaw<{ clientEpoch: number }[]>`UPDATE attempts SET "activeClientId" = ${clientId}, "clientEpoch" = "clientEpoch" + 1 WHERE id = ${attempt.id}::uuid AND "activeClientId" IS DISTINCT FROM ${clientId} RETURNING "clientEpoch"`;
      if (claimed.length) {
        fresh = { ...attempt, activeClientId: clientId, clientEpoch: claimed[0]!.clientEpoch };
        await this.prisma.attemptEvent.create({ data: { attemptId: attempt.id, kind: 'SESSION_CLAIMED', detail: { clientId, previous: attempt.activeClientId } } });
      }
    }
    if (fresh.questionOrder.length === 0) throw new AppError(500, 'INTERNAL', 'Attempt has no question order');

    const paper = await this.paperFor(examId);
    const byId = new Map(paper.map((q) => [q.id, q]));
    const answers = await this.prisma.attemptAnswer.findMany({ where: { attemptId: fresh.id } });
    return {
      attempt: { id: fresh.id, status: fresh.status, startedAt: fresh.startedAt, deadlineAt: fresh.deadlineAt, clientEpoch: fresh.clientEpoch },
      control: { examStatus: exam.status, suspended: !!fresh.suspendedAt, timingPolicy: exam.timingPolicy },
      serverNow: now,
      exam: { id: exam.id, code: exam.code, title: exam.title, durationMin: exam.durationMin, totalMarks: exam.totalMarks, instructions: exam.instructions, negativeMarking: exam.negativeMarking },
      questions: fresh.questionOrder.map((id, i) => ({ ...byId.get(id)!, number: i + 1 })),
      answers: answers.map((a) => ({ examQuestionId: a.examQuestionId, selectedLabel: a.selectedLabel, state: a.state, markedForReview: a.markedForReview, visited: a.visited, revision: a.revision })),
    };
  }

  /** Expired on the DATABASE-derived clock: deadline + grace, plus the paused time for an attempt frozen by a FREEZE_CLOCK suspension. */
  private async isExpired(a: { deadlineAt: Date; suspendedAt: Date | null; suspensionId: string | null }, now: Date): Promise<boolean> {
    let offset = 0;
    if (a.suspendedAt && a.suspensionId) {
      const sp = await this.prisma.examSuspension.findUnique({ where: { id: a.suspensionId }, select: { timePolicy: true } });
      if (sp?.timePolicy === 'FREEZE_CLOCK') offset = now.getTime() - a.suspendedAt.getTime();
    }
    return now.getTime() > a.deadlineAt.getTime() + offset + SAVE_GRACE_SECONDS * 1000;
  }

  /** One shared clock for SYNCHRONIZED exams: official start + duration + accommodation + exam-wide extensions + completed exam-wide pauses, capped by the window. */
  private async syncDeadline(exam: { id: string; durationMin: number; closesAt: Date; opensAt: Date; officialStartAt: Date | null }, extraTimeMin: number): Promise<Date> {
    const r = (await this.prisma.$queryRaw<{ ext: number; paused: number }[]>`
      SELECT COALESCE((SELECT sum(minutes) FROM exam_extensions WHERE "examId" = ${exam.id}::uuid AND scope = 'EXAM'), 0)::int AS ext,
             COALESCE((SELECT sum("pausedSeconds") FROM exam_suspensions WHERE "examId" = ${exam.id}::uuid AND scope = 'EXAM' AND "timePolicy" = 'FREEZE_CLOCK'), 0)::int AS paused`)[0]!;
    return computeSyncDeadline({ officialStartAt: exam.officialStartAt ?? exam.opensAt, durationMin: exam.durationMin, extraTimeMin, examExtensionMin: r.ext, pausedSeconds: r.paused, windowEndsAt: exam.closesAt });
  }

  // ───────────── answer saving ─────────────
  /**
   * One atomic SQL statement = one durable transaction. The response is only `saved: true` if the row
   * (and its journal entry) were committed. Locking: FOR KEY SHARE on the attempt row conflicts with the
   * FOR UPDATE taken by submit, so a save can never slip in after the answer sheet has been sealed.
   */
  async saveAnswer(u: AuthUser, attemptId: string, examQuestionId: string, d: SaveInput) {
    const studentId = this.studentIdOf(u);
    if ((d.state === 'ANSWERED') !== (d.selectedLabel !== null)) throw badRequest('state ANSWERED requires a selected option, and only then');
    const label = d.selectedLabel;
    const rows = await this.prisma.$queryRaw<{ attempt_ok: number; q_ok: number; revision: number | null; saved_at: Date | null; now: Date }[]>`
      WITH a AS (
        SELECT id, "examId" FROM attempts
        WHERE id = ${attemptId}::uuid AND "studentId" = ${studentId}::uuid AND status = 'IN_PROGRESS'
          AND "activeClientId" = ${d.clientId} AND "suspendedAt" IS NULL
          AND "deadlineAt" + make_interval(secs => ${SAVE_GRACE_SECONDS}::int) > clock_timestamp()
        FOR KEY SHARE
      ), q AS (
        SELECT eq.id FROM exam_questions eq JOIN a ON a."examId" = eq."examId"
        WHERE eq.id = ${examQuestionId}::uuid
          AND (${label}::text IS NULL OR eq.snapshot->'options' @> jsonb_build_array(jsonb_build_object('label', ${label}::text)))
      ), up AS (
        INSERT INTO attempt_answers ("attemptId","examQuestionId","selectedLabel",state,"markedForReview",visited,revision,"savedAt")
        SELECT ${attemptId}::uuid, q.id, ${label}::text, ${d.state}::"AnswerState", ${d.markedForReview}::boolean, ${d.visited}::boolean, ${d.revision}::int, clock_timestamp() FROM q
        ON CONFLICT ("attemptId","examQuestionId") DO UPDATE SET
          "selectedLabel" = EXCLUDED."selectedLabel", state = EXCLUDED.state, "markedForReview" = EXCLUDED."markedForReview",
          visited = EXCLUDED.visited, revision = EXCLUDED.revision, "savedAt" = EXCLUDED."savedAt"
        WHERE attempt_answers.revision < EXCLUDED.revision
        RETURNING revision, "savedAt"
      ), ev AS (
        INSERT INTO answer_events ("attemptId","examQuestionId",revision,"selectedLabel",state,"markedForReview",at)
        SELECT ${attemptId}::uuid, ${examQuestionId}::uuid, up.revision, ${label}::text, ${d.state}::"AnswerState", ${d.markedForReview}::boolean, up."savedAt" FROM up
      )
      SELECT (SELECT count(*) FROM a)::int AS attempt_ok, (SELECT count(*) FROM q)::int AS q_ok,
             (SELECT revision FROM up) AS revision, (SELECT "savedAt" FROM up) AS saved_at, clock_timestamp() AS now`;
    const r = rows[0]!;
    if (r.revision !== null && r.saved_at) {
      return { saved: true as const, revision: r.revision, savedAt: r.saved_at, serverNow: r.now };
    }
    if (!r.attempt_ok) throw await this.diagnoseRejectedSave(attemptId, studentId, d.clientId);
    if (!r.q_ok) throw badRequest('Unknown question or option for this examination');
    // attempt valid, question valid, but revision not newer: idempotent replay or stale writer
    const cur = await this.prisma.attemptAnswer.findUnique({ where: { attemptId_examQuestionId: { attemptId, examQuestionId } } });
    if (cur && cur.revision === d.revision && cur.selectedLabel === label && cur.state === d.state && cur.markedForReview === d.markedForReview) {
      return { saved: true as const, duplicate: true, revision: cur.revision, savedAt: cur.savedAt, serverNow: r.now };
    }
    throw conflict('STALE_REVISION', 'A newer version of this answer is already stored', {
      server: cur && { examQuestionId, selectedLabel: cur.selectedLabel, state: cur.state, markedForReview: cur.markedForReview, visited: cur.visited, revision: cur.revision },
    });
  }

  private async diagnoseRejectedSave(attemptId: string, studentId: string, clientId: string): Promise<AppError> {
    const a = await this.prisma.attempt.findUnique({ where: { id: attemptId } });
    if (!a || a.studentId !== studentId) return new AppError(404, 'NOT_FOUND', 'Attempt not found');
    if (a.status !== 'IN_PROGRESS') return conflict('ATTEMPT_CLOSED', 'This attempt has already been submitted', { receiptCode: a.receiptCode });
    if (a.activeClientId !== clientId) return conflict('SESSION_SUPERSEDED', 'This examination is open in another window or device. Reload to continue there.');
    if (a.suspendedAt) return conflict('EXAM_SUSPENDED', 'The examination is suspended. Your saved answers are safe; wait for instructions from the examination office.');
    return conflict('TIME_EXPIRED', 'The examination time has ended');
  }

  /**
   * The candidate's authoritative clock/state check (the client also calls it whenever an SSE event arrives). One read, database clock:
   * deadline, suspension, exam state and expiry are all computed by PostgreSQL.
   */
  async heartbeat(u: AuthUser, attemptId: string, clientId: string, online = true) {
    const studentId = this.studentIdOf(u);
    const rows = await this.prisma.$queryRaw<{ id: string; examId: string; studentId: string; status: string; deadlineAt: Date; activeClientId: string | null; suspendedAt: Date | null; examStatus: string; stateVersion: number; inst: string; expired: boolean; now: Date }[]>`
      SELECT a.id, a."examId", a."studentId", a.status, a."deadlineAt", a."activeClientId", a."suspendedAt", e.status::text AS "examStatus", e."stateVersion", s."institutionId" AS inst,
             (a."deadlineAt" + make_interval(secs => ${SAVE_GRACE_SECONDS}::int)
               + CASE WHEN a."suspendedAt" IS NOT NULL AND sp."timePolicy" = 'FREEZE_CLOCK' THEN clock_timestamp() - a."suspendedAt" ELSE interval '0' END < clock_timestamp()) AS expired,
             clock_timestamp() AS now
      FROM attempts a JOIN exams e ON e.id = a."examId" JOIN students s ON s.id = a."studentId" LEFT JOIN exam_suspensions sp ON sp.id = a."suspensionId" WHERE a.id = ${attemptId}::uuid`;
    const a = rows[0];
    if (!a || a.studentId !== studentId) throw notFound('Attempt');
    const now = a.now;
    if (a.status === 'IN_PROGRESS' && a.expired) {
      await this.finalize(a.id, { mode: 'AUTO' });
      return { status: 'AUTO_SUBMITTED', serverNow: now, deadlineAt: a.deadlineAt, superseded: false, suspended: false, examStatus: a.examStatus, stateVersion: a.stateVersion };
    }
    if (a.activeClientId === clientId && a.status === 'IN_PROGRESS') {
      const t = now.getTime();
      try { await this.redis.client.pipeline().hset(`hb:${a.examId}`, a.id, JSON.stringify({ t, online })).expire(`hb:${a.examId}`, 86400)
        .zadd(`hbz:${a.examId}`, t, a.id).expire(`hbz:${a.examId}`, 86400).zadd(`hbz:${a.examId}:${a.inst}`, t, a.id).expire(`hbz:${a.examId}:${a.inst}`, 86400).exec(); } catch { /* coordination only */ }
    }
    return { status: a.status, serverNow: now, deadlineAt: a.deadlineAt, superseded: a.activeClientId !== clientId, suspended: !!a.suspendedAt, examStatus: a.examStatus, stateVersion: a.stateVersion };
  }

  async recordEvent(u: AuthUser, attemptId: string, clientId: string, kind: string, detail?: Record<string, unknown>) {
    const studentId = this.studentIdOf(u);
    const a = await this.prisma.attempt.findUnique({ where: { id: attemptId }, select: { studentId: true, activeClientId: true, status: true } });
    if (!a || a.studentId !== studentId) throw notFound('Attempt');
    if (a.status !== 'IN_PROGRESS' || a.activeClientId !== clientId) return { ok: false };
    await this.prisma.$transaction([
      this.prisma.attemptEvent.create({ data: { attemptId, kind, detail: (detail ?? undefined) as never } }),
      this.prisma.attempt.update({ where: { id: attemptId }, data: { integrityFlags: { increment: ['TAB_HIDDEN', 'FULLSCREEN_EXIT', 'PASTE_BLOCKED'].includes(kind) ? 1 : 0 } } }),
    ]);
    return { ok: true };
  }

  /** Server-authoritative view of the sheet for the final review screen. */
  async sheet(u: AuthUser, attemptId: string) {
    const studentId = this.studentIdOf(u);
    const a = await this.prisma.attempt.findUnique({ where: { id: attemptId }, include: { answers: true } });
    if (!a || a.studentId !== studentId) throw notFound('Attempt');
    return { status: a.status, deadlineAt: a.deadlineAt, serverNow: await this.prisma.dbNow(), answers: a.answers.map((x) => ({ examQuestionId: x.examQuestionId, selectedLabel: x.selectedLabel, state: x.state, markedForReview: x.markedForReview, visited: x.visited, revision: x.revision })) };
  }

  // ───────────── submission ─────────────
  async submit(u: AuthUser, attemptId: string, d: { clientId: string; submitKey: string; expected?: { examQuestionId: string; revision: number; selectedLabel: string | null }[] }, ip?: string) {
    const studentId = this.studentIdOf(u);
    const owner = await this.prisma.attempt.findUnique({ where: { id: attemptId }, select: { studentId: true } });
    if (!owner || owner.studentId !== studentId) throw notFound('Attempt');
    return this.finalize(attemptId, { mode: 'MANUAL', clientId: d.clientId, submitKey: d.submitKey, expected: d.expected, actor: u, ip });
  }

  /**
   * Seals the answer sheet exactly once. Row lock (FOR UPDATE) serialises against in-flight saves
   * and concurrent submits; a replay returns the original receipt untouched.
   */
  private async seal(
    attemptId: string,
    o: { mode: 'MANUAL' | 'AUTO' | 'FORCED'; onlyIfExpired?: boolean; bulk?: boolean; clientId?: string; submitKey?: string; expected?: { examQuestionId: string; revision: number; selectedLabel: string | null }[]; actor?: AuthUser; reason?: string; ip?: string },
  ) {
    // 1. Cheap reads OUTSIDE any transaction: no pooled connection is held while these (or anything else) queue.
    const pre = (await this.prisma.$queryRaw<{ id: string; examId: string; studentId: string; status: string; receiptCode: string | null; submittedAt: Date | null; answerDigest: string | null }[]>`
      SELECT id, "examId", "studentId", status, "receiptCode", "submittedAt", "answerDigest" FROM attempts WHERE id = ${attemptId}::uuid`)[0];
    if (!pre) throw notFound('Attempt');
    // The approved paper is immutable, so its question ids come from the cache (no DB round trip inside the seal).
    const eqIds = (await this.paperFor(pre.examId)).map((q) => q.id);
    const total = eqIds.length;
    const replay = async (r: { examId: string; studentId: string; status: string; receiptCode: string | null; submittedAt: Date | null; answerDigest: string | null }, count: (q: string) => Promise<number>) =>
      ({ receiptCode: r.receiptCode!, submittedAt: r.submittedAt!, answered: await count(attemptId), total, digest: r.answerDigest!, status: r.status, replayed: true as const, examId: r.examId, studentId: r.studentId, fresh: false as const });
    const answeredCount = async (id: string) => (await this.prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM attempt_answers WHERE "attemptId" = ${id}::uuid AND state = 'ANSWERED'`)[0]!.n;
    if (pre.status !== 'IN_PROGRESS') { const r = await replay(pre, answeredCount); const { fresh: _f, examId: _e, studentId: _s, ...pub } = r; return pub; } // sealed = immutable: replays need no transaction at all

    // 2. The seal itself: as few round trips as possible while the connection is held.
    //    (lock) → (read answers, fresh snapshot so a save we waited for is included) → (one statement: update + journal).
    //    Waiting for a free connection is bounded generously instead of failing after Prisma's 2 s default.
    const out = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string; examId: string; studentId: string; status: string; deadlineAt: Date; activeClientId: string | null; suspendedAt: Date | null; expired: boolean; receiptCode: string | null; submittedAt: Date | null; answerDigest: string | null; now: Date }[]>`
        SELECT a.id, a."examId", a."studentId", a.status, a."deadlineAt", a."activeClientId", a."suspendedAt", a."receiptCode", a."submittedAt", a."answerDigest", clock_timestamp() AS now,
               (a."deadlineAt" + make_interval(secs => ${SAVE_GRACE_SECONDS}::int)
                 + CASE WHEN a."suspendedAt" IS NOT NULL AND sp."timePolicy" = 'FREEZE_CLOCK' THEN clock_timestamp() - a."suspendedAt" ELSE interval '0' END < clock_timestamp()) AS expired
        FROM attempts a LEFT JOIN exam_suspensions sp ON sp.id = a."suspensionId" WHERE a.id = ${attemptId}::uuid FOR UPDATE OF a`;
      const a = rows[0];
      if (!a) throw notFound('Attempt');
      if (a.status !== 'IN_PROGRESS') { // sealed by a concurrent request between our pre-read and the lock
        const n = (await tx.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM attempt_answers WHERE "attemptId" = ${attemptId}::uuid AND state = 'ANSWERED'`)[0]!.n;
        return replay(a, async () => n);
      }
      // The expiry decision is re-made HERE, under the row lock, on the database clock: an extension/resume that landed after the caller chose this attempt wins.
      if (o.onlyIfExpired && !a.expired) return { skipped: true as const };
      if (o.mode === 'MANUAL' && a.suspendedAt) throw conflict('EXAM_SUSPENDED', 'The examination is suspended. Submission is not possible until it resumes; your saved answers are safe.');
      if (o.mode === 'MANUAL' && a.activeClientId !== o.clientId) throw conflict('SESSION_SUPERSEDED', 'This examination is open in another window or device.');
      const late = a.now.getTime() > a.deadlineAt.getTime() + SAVE_GRACE_SECONDS * 1000;
      const answers = await tx.attemptAnswer.findMany({ where: { attemptId } });
      if (o.mode === 'MANUAL' && !late && o.expected) {
        const server = new Map(answers.map((x) => [x.examQuestionId, x]));
        const bad = o.expected.filter((e) => { const s = server.get(e.examQuestionId); return (s?.revision ?? 0) !== e.revision || (s?.selectedLabel ?? null) !== e.selectedLabel; });
        const extra = answers.filter((x) => !o.expected!.some((e) => e.examQuestionId === x.examQuestionId));
        if (bad.length || extra.length) {
          throw conflict('ANSWERS_OUT_OF_SYNC', 'Some answers on this screen are not what has been saved. Review them before submitting.', {
            mismatched: [...bad.map((b) => b.examQuestionId), ...extra.map((x) => x.examQuestionId)],
            server: answers.map((x) => ({ examQuestionId: x.examQuestionId, selectedLabel: x.selectedLabel, state: x.state, markedForReview: x.markedForReview, visited: x.visited, revision: x.revision })),
          });
        }
      }
      const am = new Map(answers.map((x) => [x.examQuestionId, x]));
      const digest = answerDigest(eqIds.map((id) => ({ examQuestionId: id, selectedLabel: am.get(id)?.selectedLabel ?? null, revision: am.get(id)?.revision ?? 0 })));
      const submittedAt = a.now;
      const code = receiptCode(this.cfg.RECEIPT_SECRET, attemptId, digest, submittedAt);
      const status = o.mode === 'MANUAL' && !late ? 'SUBMITTED' : 'AUTO_SUBMITTED';
      const kind = o.mode === 'FORCED' ? 'FORCE_SUBMITTED' : o.mode === 'AUTO' ? 'AUTO_SUBMITTED' : 'SUBMITTED';
      const detail = JSON.stringify({ reason: o.reason ?? (o.mode === 'AUTO' ? 'deadline' : undefined) });
      // one statement: seal the attempt AND journal the event atomically
      await tx.$executeRaw`
        WITH u AS (UPDATE attempts SET status = ${status}::"AttemptStatus", "submittedAt" = ${submittedAt}, "submitKey" = ${o.submitKey ?? null}, "receiptCode" = ${code}, "answerDigest" = ${digest} WHERE id = ${attemptId}::uuid RETURNING id)
        INSERT INTO attempt_events ("attemptId", kind, "actorId", detail) SELECT id, ${kind}, ${o.actor?.id ?? null}::uuid, ${detail}::jsonb FROM u`;
      return { receiptCode: code, submittedAt, answered: answers.filter((x) => x.state === 'ANSWERED').length, total, digest, status, replayed: false as const, late, examId: a.examId, studentId: a.studentId, fresh: true as const };
    }, { maxWait: 15_000, timeout: 20_000 });
    if ('skipped' in out) return out;
    if (out.fresh) {
      // Candidate submits / deadline auto-submits are recorded on the attempt itself (status, receipt, digest, attempt_events).
      // Only staff-initiated seals go to the (globally serialised) audit chain.
      if (o.mode === 'FORCED' && !o.bulk) await this.audit.log({ actor: o.actor ?? null, action: 'attempt.force_submit', entity: 'attempt', entityId: attemptId, meta: { examId: out.examId, receipt: out.receiptCode, answered: out.answered, total: out.total, reason: o.reason }, ip: o.ip });
      // Best effort and time-boxed: BullMQ waits indefinitely while Redis is down, which must never delay the receipt.
      // The lifecycle sweeper grades any sealed attempt that was not enqueued.
      if (this.redis.available) await Promise.race([
        this.queues.add(QUEUES.grade, 'grade', { attemptId }, { jobId: `grade-${attemptId}` }).catch((e) => this.log.warn(`grade enqueue failed (sweeper will recover): ${e.message}`)),
        new Promise<void>((resolve) => setTimeout(() => { this.log.warn('grade enqueue timed out (sweeper will recover)'); resolve(); }, 1500).unref()),
      ]);
    }
    const { fresh: _f, examId: _e, studentId: _s, ...pub } = out;
    return pub;
  }

  /** Seals the attempt (see `seal`). */
  async finalize(attemptId: string, o: Omit<Parameters<DeliveryService['seal']>[1], 'onlyIfExpired'>) {
    const r = await this.seal(attemptId, o);
    if ('skipped' in r) throw new AppError(500, 'INTERNAL', 'Unexpected skip');
    return r;
  }
  /** Seals only if, under the row lock, the attempt is STILL expired (reconciler path). Returns {skipped:true} otherwise. */
  sealIfExpired(attemptId: string, o: { bulk?: boolean } = {}) { return this.seal(attemptId, { mode: 'AUTO', onlyIfExpired: true, bulk: o.bulk }); }

  async receipt(u: AuthUser, attemptId: string) {
    const studentId = this.studentIdOf(u);
    const a = await this.prisma.attempt.findUnique({ where: { id: attemptId }, include: { exam: { select: { code: true, title: true } }, student: { select: { regNo: true, user: { select: { fullName: true } } } } } });
    if (!a || a.studentId !== studentId) throw notFound('Attempt');
    if (a.status === 'IN_PROGRESS') throw conflict('NOT_SUBMITTED', 'This attempt has not been submitted');
    const answered = await this.prisma.attemptAnswer.count({ where: { attemptId, state: 'ANSWERED' } });
    const total = await this.prisma.examQuestion.count({ where: { examId: a.examId } });
    return { receiptCode: a.receiptCode, submittedAt: a.submittedAt, status: a.status, answered, total, digest: a.answerDigest, exam: a.exam, candidate: { regNo: a.student.regNo, fullName: a.student.user.fullName } };
  }
}
