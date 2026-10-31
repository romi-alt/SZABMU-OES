import { Injectable, Logger } from '@nestjs/common';
import { percent, scoreQuestion, sumScores } from '@oes/shared';
import { PrismaService } from '../../infra/prisma.service';
import { QueuesService } from '../../infra/queues.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { scope, type AuthUser } from '../../common/auth';
import { badRequest, conflict, forbidden, notFound } from '../../common/errors';
import { randomBytes } from 'node:crypto';

@Injectable()
export class ResultsService {
  private readonly log = new Logger('Results');
  constructor(private readonly prisma: PrismaService, private readonly queues: QueuesService, private readonly audit: AuditService, private readonly notifications: NotificationsService) {}

  // ───────────── automatic MCQ grading (idempotent) ─────────────
  async gradeAttempt(attemptId: string) {
    const a = await this.prisma.attempt.findUnique({ where: { id: attemptId }, include: { exam: true, answers: true } });
    if (!a || a.status === 'IN_PROGRESS' || a.status === 'VOID') return null;
    const eqs = await this.prisma.examQuestion.findMany({ where: { examId: a.examId } });
    const actions = await this.prisma.keyAction.findMany({ where: { examId: a.examId }, orderBy: { createdAt: 'asc' } });
    const eff = new Map(eqs.map((q) => [q.id, { correct: q.correctLabel!, voided: false }]));
    for (const k of actions) {
      const e = eff.get(k.examQuestionId);
      if (!e) continue;
      if (k.kind === 'VOID') e.voided = true;
      else if (k.newLabel) e.correct = k.newLabel;
    }
    const ans = new Map(a.answers.map((x) => [x.examQuestionId, x.selectedLabel]));
    const parts = eqs.map((q) => scoreQuestion({ marks: q.marks, correctLabel: eff.get(q.id)!.correct, voided: eff.get(q.id)!.voided, selectedLabel: ans.get(q.id) ?? null }, { negativeMarkingFraction: a.exam.negativeMarking }));
    const raw = sumScores(parts, a.exam.totalMarks);
    const pct = percent(raw, a.exam.totalMarks);
    const status = pct >= a.exam.passPercent ? 'PASS' : 'FAIL';
    await this.prisma.$transaction([
      this.prisma.result.upsert({
        where: { examId_studentId: { examId: a.examId, studentId: a.studentId } },
        create: { examId: a.examId, studentId: a.studentId, attemptId, rawScore: raw, totalMarks: a.exam.totalMarks, percent: pct, status },
        update: { attemptId, rawScore: raw, totalMarks: a.exam.totalMarks, percent: pct, status, gradedAt: new Date() },
      }),
      this.prisma.resultBatch.upsert({ where: { examId: a.examId }, create: { examId: a.examId }, update: {} }),
    ]);
    return { raw, pct, status };
  }

  /** Re-score every finalised attempt of an exam, e.g. after a key correction. */
  async regradeExam(examId: string) {
    const attempts = await this.prisma.attempt.findMany({ where: { examId, status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] } }, select: { id: true } });
    for (const a of attempts) await this.gradeAttempt(a.id);
    return attempts.length;
  }

  // ───────────── lifecycle tick (called by the BullMQ sweeper) ─────────────
  async tick(finalizeFn: (attemptId: string) => Promise<unknown>) {
    const stats = { autoSubmitted: 0, graded: 0, opened: 0, closed: 0, pending: 0 };
    const expired = await this.prisma.$queryRaw<{ id: string }[]>`SELECT id FROM attempts WHERE status = 'IN_PROGRESS' AND "deadlineAt" + interval '5 seconds' < clock_timestamp() LIMIT 500`;
    for (const e of expired) { await finalizeFn(e.id).then(() => stats.autoSubmitted++).catch((err) => this.log.warn(`auto-submit ${e.id}: ${err.message}`)); }
    const ungraded = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT a.id FROM attempts a LEFT JOIN results r ON r."examId" = a."examId" AND r."studentId" = a."studentId"
      WHERE a.status IN ('SUBMITTED','AUTO_SUBMITTED') AND r.id IS NULL LIMIT 500`;
    for (const g of ungraded) { await this.gradeAttempt(g.id).then(() => stats.graded++).catch((err) => this.log.warn(`grade ${g.id}: ${err.message}`)); }
    stats.opened = await this.prisma.$executeRaw`UPDATE exams SET status = 'LIVE' WHERE status = 'SCHEDULED' AND "opensAt" <= clock_timestamp() AND "closesAt" > clock_timestamp()`;
    // window over and nobody still writing → CLOSED
    stats.closed = await this.prisma.$executeRaw`
      UPDATE exams e SET status = 'CLOSED' WHERE e.status IN ('SCHEDULED','LIVE') AND e."closesAt" <= clock_timestamp()
        AND NOT EXISTS (SELECT 1 FROM attempts a WHERE a."examId" = e.id AND a.status = 'IN_PROGRESS')`;
    // CLOSED and fully graded → mark absentees, move to RESULT_PENDING
    const closed = await this.prisma.exam.findMany({ where: { status: 'CLOSED' }, select: { id: true, totalMarks: true } });
    for (const ex of closed) {
      const pendingGrade = await this.prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM attempts a LEFT JOIN results r ON r."examId" = a."examId" AND r."studentId" = a."studentId" WHERE a."examId" = ${ex.id}::uuid AND a.status IN ('SUBMITTED','AUTO_SUBMITTED') AND r.id IS NULL`;
      if (pendingGrade[0]!.n > 0) continue;
      const absent = await this.prisma.$queryRaw<{ studentId: string }[]>`SELECT c."studentId" FROM exam_candidates c WHERE c."examId" = ${ex.id}::uuid AND NOT EXISTS (SELECT 1 FROM attempts a WHERE a."examId" = c."examId" AND a."studentId" = c."studentId")`;
      await this.prisma.$transaction([
        this.prisma.result.createMany({ data: absent.map((s) => ({ examId: ex.id, studentId: s.studentId, rawScore: 0, totalMarks: ex.totalMarks, percent: 0, status: 'ABSENT' as const })), skipDuplicates: true }),
        this.prisma.resultBatch.upsert({ where: { examId: ex.id }, create: { examId: ex.id }, update: {} }),
        this.prisma.exam.update({ where: { id: ex.id }, data: { status: 'RESULT_PENDING' } }),
      ]);
      stats.pending++;
      await this.notifications.notifyRole('EXAMINER', 'Results ready for review', `Exam ${ex.id} has been graded.`, `/examiner/results`);
    }
    return stats;
  }

  // ───────────── analysis & review ─────────────
  private async loadExam(u: AuthUser, examId: string) {
    const exam = await this.prisma.exam.findFirst({ where: { id: examId, ...(u.institutionIds === null ? {} : { institutions: { some: { institutionId: { in: u.institutionIds } } } }) }, include: { resultBatch: true, course: { select: { code: true, title: true } } } });
    if (!exam) throw notFound('Exam');
    return exam;
  }

  async itemAnalysis(u: AuthUser, examId: string) {
    const exam = await this.loadExam(u, examId);
    const sf = scope.filter(u);
    const eqs = await this.prisma.examQuestion.findMany({ where: { examId }, orderBy: { position: 'asc' } });
    const rows = await this.prisma.$queryRaw<{ eqid: string; label: string | null; n: number }[]>`
      SELECT aa."examQuestionId" AS eqid, aa."selectedLabel" AS label, count(*)::int AS n
      FROM attempt_answers aa JOIN attempts a ON a.id = aa."attemptId" JOIN students s ON s.id = a."studentId"
      WHERE a."examId" = ${examId}::uuid AND a.status IN ('SUBMITTED','AUTO_SUBMITTED')
        AND (${sf ? 1 : 0}::int = 0 OR s."institutionId" = ANY(${sf?.in ?? []}::uuid[]))
      GROUP BY 1, 2`;
    const sat = await this.prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM attempts a JOIN students s ON s.id = a."studentId"
      WHERE a."examId" = ${examId}::uuid AND a.status IN ('SUBMITTED','AUTO_SUBMITTED') AND (${sf ? 1 : 0}::int = 0 OR s."institutionId" = ANY(${sf?.in ?? []}::uuid[]))`;
    const actions = await this.prisma.keyAction.findMany({ where: { examId } });
    const n = sat[0]!.n;
    return {
      exam: { id: exam.id, code: exam.code, title: exam.title, status: exam.status, batch: exam.resultBatch?.status ?? null }, candidates: n,
      questions: eqs.map((q) => {
        const dist: Record<string, number> = {};
        for (const r of rows.filter((x) => x.eqid === q.id)) dist[r.label ?? '—'] = r.n;
        const act = actions.filter((k) => k.examQuestionId === q.id);
        const attempted = Object.entries(dist).filter(([k]) => k !== '—').reduce((s, [, v]) => s + v, 0);
        const correctN = dist[q.correctLabel ?? ''] ?? 0;
        const pCorrect = n ? Math.round((correctN / n) * 1000) / 10 : 0;
        return { examQuestionId: q.id, position: q.position, stem: (q.snapshot as { stem: string }).stem, key: q.correctLabel, distribution: dist, attempted, pCorrect, flag: n >= 10 && (pCorrect < 20 || pCorrect > 95) ? (pCorrect < 20 ? 'VERY_HARD_OR_MISKEYED' : 'TOO_EASY') : null, actions: act.map((k) => ({ kind: k.kind, newLabel: k.newLabel, reason: k.reason })) };
      }),
    };
  }

  async keyAction(u: AuthUser, examId: string, d: { examQuestionId: string; kind: 'VOID' | 'CHANGE_KEY'; newLabel?: string; reason: string }, ip?: string) {
    const exam = await this.loadExam(u, examId);
    if (!['RESULT_PENDING', 'CLOSED'].includes(exam.status) || (exam.resultBatch && ['EXAMINER_APPROVED', 'PUBLISHED'].includes(exam.resultBatch.status))) throw conflict('BAD_STATE', 'Key corrections are only possible after the sitting and before examiner approval');
    const eq = await this.prisma.examQuestion.findFirst({ where: { id: d.examQuestionId, examId } });
    if (!eq) throw notFound('Exam question');
    if (d.kind === 'CHANGE_KEY') {
      const labels = ((eq.snapshot as { options: { label: string }[] }).options).map((o) => o.label);
      if (!d.newLabel || !labels.includes(d.newLabel) || d.newLabel === eq.correctLabel) throw badRequest('newLabel must be a different valid option');
    }
    await this.prisma.keyAction.create({ data: { examId, examQuestionId: d.examQuestionId, kind: d.kind, newLabel: d.newLabel, reason: d.reason, actorId: u.id } });
    await this.prisma.resultBatch.update({ where: { examId }, data: { status: 'GRADED', reviewedBy: null, reviewedAt: null } }).catch(() => undefined);
    const n = await this.regradeExam(examId);
    await this.audit.log({ actor: u, action: `grading.${d.kind.toLowerCase()}`, entity: 'exam', entityId: examId, meta: { ...d, regraded: n }, ip });
    return { regraded: n };
  }

  async lecturerReview(u: AuthUser, examId: string, note: string | undefined, ip?: string) {
    const exam = await this.loadExam(u, examId);
    if (exam.status !== 'RESULT_PENDING' || exam.resultBatch?.status !== 'GRADED') throw conflict('BAD_STATE', 'Results are not awaiting lecturer review');
    await this.prisma.resultBatch.update({ where: { examId }, data: { status: 'LECTURER_REVIEWED', reviewedBy: u.id, reviewedAt: new Date(), reviewNote: note } });
    await this.audit.log({ actor: u, action: 'results.lecturer_review', entity: 'exam', entityId: examId, meta: { note }, ip });
    return { status: 'LECTURER_REVIEWED' };
  }

  async examinerApprove(u: AuthUser, examId: string, ip?: string) {
    const exam = await this.loadExam(u, examId);
    if (exam.resultBatch?.status !== 'LECTURER_REVIEWED') throw conflict('BAD_STATE', 'Lecturer review must be completed first');
    const open = await this.prisma.incident.count({ where: { examId, status: { in: ['OPEN', 'INVESTIGATING'] } } });
    if (open) throw conflict('OPEN_INCIDENTS', `${open} incident(s) remain unresolved; resolve them before approval`, { open });
    await this.prisma.resultBatch.update({ where: { examId }, data: { status: 'EXAMINER_APPROVED', examinerApprovedBy: u.id, examinerApprovedAt: new Date() } });
    await this.audit.log({ actor: u, action: 'results.examiner_approve', entity: 'exam', entityId: examId, ip });
    await this.notifications.notifyRole('CCE', 'Results awaiting publication', `${exam.code} — ${exam.title}`, '/cce/results');
    return { status: 'EXAMINER_APPROVED' };
  }

  async publish(u: AuthUser, examId: string, ip?: string) {
    const exam = await this.loadExam(u, examId);
    const b = exam.resultBatch;
    if (b?.status !== 'EXAMINER_APPROVED') throw conflict('BAD_STATE', 'Results must be approved by the examiner before publication');
    if (b.examinerApprovedBy === u.id) throw forbidden('The publisher must differ from the examiner who approved (four-eyes principle)');
    const passes = await this.prisma.result.findMany({ where: { examId, status: 'PASS' }, select: { id: true } });
    await this.prisma.$transaction(async (tx) => {
      await tx.resultBatch.update({ where: { examId }, data: { status: 'PUBLISHED', publishedBy: u.id, publishedAt: new Date() } });
      await tx.exam.update({ where: { id: examId }, data: { status: 'PUBLISHED' } });
      for (const r of passes) {
        const seq = (await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('certificate_serial_seq') AS n`)[0]!.n;
        await tx.certificate.upsert({ where: { resultId: r.id }, create: { resultId: r.id, serial: `SZABMU/${new Date().getUTCFullYear()}/${seq}`, verifyCode: randomBytes(5).toString('hex').toUpperCase(), issuedBy: u.id }, update: {} });
      }
    });
    await this.audit.log({ actor: u, action: 'results.publish', entity: 'exam', entityId: examId, meta: { certificates: passes.length }, ip });
    const studs = await this.prisma.result.findMany({ where: { examId }, select: { student: { select: { userId: true } } } });
    await this.notifications.notify(studs.map((s) => s.student.userId), `Results published: ${exam.title}`, 'Your result is now available in the Results section.', '/student/results');
    return { status: 'PUBLISHED', certificates: passes.length };
  }

  // ───────────── reads ─────────────
  async examResults(u: AuthUser, examId: string) {
    const exam = await this.loadExam(u, examId);
    // Campus administrators only see results once the university has published them (policy P-08).
    if (u.role === 'CAMPUS_ADMIN' && exam.resultBatch?.status !== 'PUBLISHED') throw forbidden('Results are not yet published');
    const rows = await this.prisma.result.findMany({ where: { examId, student: { institutionId: scope.filter(u) } }, include: { student: { select: { regNo: true, institution: { select: { code: true } }, user: { select: { fullName: true } } } }, certificate: { select: { serial: true } } }, orderBy: { student: { regNo: 'asc' } } });
    const sat = rows.filter((r) => r.status !== 'ABSENT');
    const scores = sat.map((r) => r.percent).sort((a, b) => a - b);
    const mean = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    return {
      exam: { id: exam.id, code: exam.code, title: exam.title, status: exam.status, passPercent: exam.passPercent, totalMarks: exam.totalMarks }, batch: exam.resultBatch,
      summary: { candidates: rows.length, sat: sat.length, absent: rows.length - sat.length, passed: sat.filter((r) => r.status === 'PASS').length, mean: Math.round(mean * 100) / 100, median: scores.length ? scores[Math.floor(scores.length / 2)] : 0, passRate: sat.length ? Math.round((sat.filter((r) => r.status === 'PASS').length / sat.length) * 1000) / 10 : 0 },
      rows: rows.map((r) => ({ id: r.id, regNo: r.student.regNo, fullName: r.student.user.fullName, institution: r.student.institution.code, rawScore: r.rawScore, totalMarks: r.totalMarks, percent: r.percent, status: r.status, certificate: r.certificate?.serial ?? null })),
    };
  }

  async gradingQueue(u: AuthUser) {
    return this.prisma.exam.findMany({
      where: { status: { in: ['RESULT_PENDING', 'CLOSED', 'PUBLISHED'] }, ...(u.institutionIds === null ? {} : { institutions: { some: { institutionId: { in: u.institutionIds } } } }) },
      include: { course: { select: { code: true, title: true } }, resultBatch: true, _count: { select: { attempts: true, candidates: true } } }, orderBy: { closesAt: 'desc' }, take: 100,
    });
  }

  async myResults(u: AuthUser) {
    if (!u.studentId) throw forbidden();
    const rows = await this.prisma.result.findMany({
      where: { studentId: u.studentId, exam: { resultBatch: { status: 'PUBLISHED' } } },
      include: { exam: { select: { code: true, title: true, opensAt: true, passPercent: true, course: { select: { code: true, title: true, semester: true, program: { select: { code: true } } } } } }, certificate: { select: { serial: true } } },
      orderBy: { exam: { opensAt: 'desc' } },
    });
    return rows.map((r) => ({ id: r.id, exam: r.exam, rawScore: r.rawScore, totalMarks: r.totalMarks, percent: r.percent, status: r.status, certificateSerial: r.certificate?.serial ?? null }));
  }

  async myCertificate(u: AuthUser, resultId: string) {
    if (!u.studentId) throw forbidden();
    const r = await this.prisma.result.findFirst({
      where: { id: resultId, studentId: u.studentId, exam: { resultBatch: { status: 'PUBLISHED' } } },
      include: { certificate: true, exam: { include: { course: { include: { program: true } } } }, student: { include: { user: true, institution: true } } },
    });
    if (!r || !r.certificate || r.certificate.revokedAt) throw notFound('Certificate');
    return { serial: r.certificate.serial, verifyCode: r.certificate.verifyCode, issuedAt: r.certificate.issuedAt, student: { fullName: r.student.user.fullName, regNo: r.student.regNo, institution: r.student.institution.name }, program: r.exam.course.program.name, course: r.exam.course.title, exam: r.exam.title, percent: r.percent, rawScore: r.rawScore, totalMarks: r.totalMarks };
  }

  /** Public verification: requires both the serial and the code printed on the certificate; discloses minimal data. */
  async verify(serial: string, code: string) {
    const c = await this.prisma.certificate.findUnique({ where: { serial }, include: { result: { include: { exam: { select: { title: true } }, student: { select: { user: { select: { fullName: true } } } } } } } });
    if (!c || c.verifyCode !== code.toUpperCase()) return { valid: false as const };
    const parts = c.result.student.user.fullName.split(/\s+/).filter((p) => /^\p{L}/u.test(p));
    return { valid: !c.revokedAt, revoked: !!c.revokedAt, serial: c.serial, holder: `${parts[0] ?? ''} ${parts.slice(1).map((p) => p[0] + '.').join(' ')}`.trim(), exam: c.result.exam.title, issuedAt: c.issuedAt };
  }
}
