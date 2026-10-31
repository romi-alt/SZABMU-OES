import { Inject, Injectable, Logger } from '@nestjs/common';
import { SAVE_GRACE_SECONDS, answerDigest, computeDeadline, receiptCode, seededOrder } from '@oes/shared';
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
      where: { studentId, exam: { status: { in: ['SCHEDULED', 'LIVE', 'CLOSED', 'RESULT_PENDING', 'PUBLISHED'] } } },
      include: { exam: { include: { course: { select: { code: true, title: true, semester: true } }, _count: { select: { questions: true } } } } },
      orderBy: { exam: { opensAt: 'asc' } },
    });
    const attempts = await this.prisma.attempt.findMany({ where: { studentId, examId: { in: cands.map((c) => c.examId) } }, select: { id: true, examId: true, status: true, receiptCode: true, submittedAt: true, deadlineAt: true } });
    const am = new Map(attempts.map((a) => [a.examId, a]));
    return {
      serverNow: now,
      items: cands.map((c) => {
        const a = am.get(c.examId) ?? null;
        const open = ['SCHEDULED', 'LIVE'].includes(c.exam.status) && now >= c.exam.opensAt && now < c.exam.closesAt;
        const canStart = (open && (!a || a.status === 'IN_PROGRESS')) || (a?.status === 'IN_PROGRESS' && now < new Date(a.deadlineAt.getTime() + SAVE_GRACE_SECONDS * 1000));
        return {
          examId: c.examId, code: c.exam.code, title: c.exam.title, course: c.exam.course, status: c.exam.status, opensAt: c.exam.opensAt, closesAt: c.exam.closesAt,
          durationMin: c.exam.durationMin + c.extraTimeMin, totalMarks: c.exam.totalMarks, questionCount: c.exam._count.questions, instructions: c.exam.instructions, negativeMarking: c.exam.negativeMarking,
          attempt: a && { id: a.id, status: a.status, receiptCode: a.receiptCode, submittedAt: a.submittedAt }, canStart,
        };
      }),
    };
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
    if (attempt && now.getTime() > attempt.deadlineAt.getTime() + SAVE_GRACE_SECONDS * 1000) {
      await this.finalize(attempt.id, { mode: 'AUTO' });
      throw conflict('TIME_EXPIRED', 'Your time has ended; the attempt was submitted automatically');
    }
    if (!attempt) {
      if (!['SCHEDULED', 'LIVE'].includes(exam.status) || exam.paperStatus !== 'APPROVED') throw conflict('NOT_AVAILABLE', 'This examination is not available');
      if (now < exam.opensAt) throw conflict('NOT_OPEN', 'The examination has not opened yet', { opensAt: exam.opensAt, serverNow: now });
      if (now >= exam.closesAt) throw conflict('CLOSED', 'The examination window has closed');
      const paper = await this.paperFor(examId);
      if (!paper.length) throw conflict('NOT_AVAILABLE', 'This examination has no questions');
      const deadline = computeDeadline({ startedAt: now, durationMin: exam.durationMin, extraTimeMin: cand.extraTimeMin, windowEndsAt: exam.closesAt });
      try {
        const created = await this.prisma.attempt.create({ data: { examId, studentId, startedAt: now, deadlineAt: deadline, extraTimeMin: cand.extraTimeMin, questionOrder: [], ip, userAgent: ua?.slice(0, 300) } });
        const ids = paper.map((q) => q.id);
        const order = exam.shuffleQuestions ? seededOrder(ids, created.id) : ids;
        attempt = await this.prisma.attempt.update({ where: { id: created.id }, data: { questionOrder: order } });
        await this.audit.log({ actor: u, action: 'attempt.start', entity: 'attempt', entityId: created.id, institutionId: cand.institutionId, meta: { examId, deadline }, ip });
      } catch (e) {
        if (e.code !== 'P2002') throw e; // concurrent double-start: fall through and resume the winner
        attempt = await this.prisma.attempt.findUniqueOrThrow({ where: { examId_studentId: { examId, studentId } } });
      }
    }
    // Claim the single active client slot; any older tab is now stale and will be rejected on save.
    const claimed = await this.prisma.$executeRaw`UPDATE attempts SET "activeClientId" = ${clientId}, "clientEpoch" = "clientEpoch" + 1 WHERE id = ${attempt.id}::uuid AND "activeClientId" IS DISTINCT FROM ${clientId}`;
    if (claimed) await this.prisma.attemptEvent.create({ data: { attemptId: attempt.id, kind: 'SESSION_CLAIMED', detail: { clientId, previous: attempt.activeClientId } } });
    const fresh = await this.prisma.attempt.findUniqueOrThrow({ where: { id: attempt.id } });
    if (fresh.questionOrder.length === 0) throw new AppError(500, 'INTERNAL', 'Attempt has no question order');

    const paper = await this.paperFor(examId);
    const byId = new Map(paper.map((q) => [q.id, q]));
    const answers = await this.prisma.attemptAnswer.findMany({ where: { attemptId: fresh.id } });
    return {
      attempt: { id: fresh.id, status: fresh.status, startedAt: fresh.startedAt, deadlineAt: fresh.deadlineAt, clientEpoch: fresh.clientEpoch },
      serverNow: await this.prisma.dbNow(),
      exam: { id: exam.id, code: exam.code, title: exam.title, durationMin: exam.durationMin, totalMarks: exam.totalMarks, instructions: exam.instructions, negativeMarking: exam.negativeMarking },
      questions: fresh.questionOrder.map((id, i) => ({ ...byId.get(id)!, number: i + 1 })),
      answers: answers.map((a) => ({ examQuestionId: a.examQuestionId, selectedLabel: a.selectedLabel, state: a.state, markedForReview: a.markedForReview, visited: a.visited, revision: a.revision })),
    };
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
          AND "activeClientId" = ${d.clientId}
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
    return conflict('TIME_EXPIRED', 'The examination time has ended');
  }

  async heartbeat(u: AuthUser, attemptId: string, clientId: string, online = true) {
    const studentId = this.studentIdOf(u);
    const a = await this.prisma.attempt.findUnique({ where: { id: attemptId }, select: { id: true, examId: true, studentId: true, status: true, deadlineAt: true, activeClientId: true } });
    if (!a || a.studentId !== studentId) throw notFound('Attempt');
    const now = await this.prisma.dbNow();
    if (a.status === 'IN_PROGRESS' && now.getTime() > a.deadlineAt.getTime() + SAVE_GRACE_SECONDS * 1000) {
      await this.finalize(a.id, { mode: 'AUTO' });
      return { status: 'AUTO_SUBMITTED', serverNow: now, deadlineAt: a.deadlineAt, superseded: false };
    }
    if (a.activeClientId === clientId && a.status === 'IN_PROGRESS') {
      try { await this.redis.client.hset(`hb:${a.examId}`, a.id, JSON.stringify({ t: now.getTime(), online })); await this.redis.client.expire(`hb:${a.examId}`, 86400); } catch { /* coordination only */ }
    }
    const fresh = a.status === 'IN_PROGRESS' ? await this.prisma.attempt.findUniqueOrThrow({ where: { id: a.id }, select: { deadlineAt: true } }) : a;
    return { status: a.status, serverNow: now, deadlineAt: fresh.deadlineAt, superseded: a.activeClientId !== clientId };
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
  async finalize(
    attemptId: string,
    o: { mode: 'MANUAL' | 'AUTO' | 'FORCED'; clientId?: string; submitKey?: string; expected?: { examQuestionId: string; revision: number; selectedLabel: string | null }[]; actor?: AuthUser; reason?: string; ip?: string },
  ) {
    const out = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string; examId: string; studentId: string; status: string; deadlineAt: Date; activeClientId: string | null; receiptCode: string | null; submittedAt: Date | null; answerDigest: string | null; now: Date }[]>`
        SELECT id, "examId", "studentId", status, "deadlineAt", "activeClientId", "receiptCode", "submittedAt", "answerDigest", clock_timestamp() AS now FROM attempts WHERE id = ${attemptId}::uuid FOR UPDATE`;
      const a = rows[0];
      if (!a) throw notFound('Attempt');
      const total = await tx.examQuestion.count({ where: { examId: a.examId } });
      if (a.status !== 'IN_PROGRESS') {
        const answered = await tx.attemptAnswer.count({ where: { attemptId, state: 'ANSWERED' } });
        return { receiptCode: a.receiptCode!, submittedAt: a.submittedAt!, answered, total, digest: a.answerDigest!, status: a.status, replayed: true, examId: a.examId, studentId: a.studentId, fresh: false };
      }
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
      const eqIds = (await tx.examQuestion.findMany({ where: { examId: a.examId }, select: { id: true } })).map((x) => x.id);
      const am = new Map(answers.map((x) => [x.examQuestionId, x]));
      const digest = answerDigest(eqIds.map((id) => ({ examQuestionId: id, selectedLabel: am.get(id)?.selectedLabel ?? null, revision: am.get(id)?.revision ?? 0 })));
      const submittedAt = a.now;
      const code = receiptCode(this.cfg.RECEIPT_SECRET, attemptId, digest, submittedAt);
      const status = o.mode === 'MANUAL' && !late ? 'SUBMITTED' : 'AUTO_SUBMITTED';
      await tx.attempt.update({ where: { id: attemptId }, data: { status, submittedAt, submitKey: o.submitKey ?? null, receiptCode: code, answerDigest: digest } });
      if (o.mode !== 'MANUAL') await tx.attemptEvent.create({ data: { attemptId, kind: o.mode === 'FORCED' ? 'FORCE_SUBMITTED' : 'AUTO_SUBMITTED', actorId: o.actor?.id, detail: { reason: o.reason ?? 'deadline' } } });
      return { receiptCode: code, submittedAt, answered: answers.filter((x) => x.state === 'ANSWERED').length, total, digest, status, replayed: false, late, examId: a.examId, studentId: a.studentId, fresh: true };
    });
    if (out.fresh) {
      await this.audit.log({ actor: o.actor ?? null, action: `attempt.${o.mode === 'MANUAL' ? 'submit' : o.mode === 'FORCED' ? 'force_submit' : 'auto_submit'}`, entity: 'attempt', entityId: attemptId, meta: { examId: out.examId, receipt: out.receiptCode, answered: out.answered, total: out.total, reason: o.reason }, ip: o.ip });
      await this.queues.add(QUEUES.grade, 'grade', { attemptId }, { jobId: `grade-${attemptId}` }).catch((e) => this.log.warn(`grade enqueue failed (sweeper will recover): ${e.message}`));
    }
    const { fresh: _f, examId: _e, studentId: _s, ...pub } = out;
    return pub;
  }

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
