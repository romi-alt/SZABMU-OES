import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma.service';
import { scope, type AuthUser } from '../../common/auth';
import { notFound } from '../../common/errors';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Role-specific landing statistics. Every count is computed under the caller's institution scope. */
  async dashboard(u: AuthUser) {
    const sf = scope.filter(u);
    const examScope = u.institutionIds === null ? {} : { institutions: { some: { institutionId: { in: u.institutionIds } } } };
    const now = new Date();
    switch (u.role) {
      case 'STUDENT': {
        const [upcoming, results, next] = await Promise.all([
          this.prisma.examCandidate.count({ where: { studentId: u.studentId, exam: { status: { in: ['SCHEDULED', 'LIVE'] }, closesAt: { gt: now } } } }),
          this.prisma.result.findMany({ where: { studentId: u.studentId, exam: { resultBatch: { status: 'PUBLISHED' } } }, select: { percent: true, status: true } }),
          this.prisma.examCandidate.findFirst({ where: { studentId: u.studentId, exam: { status: { in: ['SCHEDULED', 'LIVE'] }, closesAt: { gt: now } } }, orderBy: { exam: { opensAt: 'asc' } }, include: { exam: { select: { title: true, opensAt: true } } } }),
        ]);
        const sat = results.filter((r) => r.status !== 'ABSENT');
        return { upcoming, completed: sat.length, passed: sat.filter((r) => r.status === 'PASS').length, avgPercent: sat.length ? Math.round((sat.reduce((a, b) => a + b.percent, 0) / sat.length) * 10) / 10 : null, next: next?.exam ?? null };
      }
      case 'LECTURER': {
        const [mine, bySt, review, students] = await Promise.all([
          this.prisma.question.count({ where: { authorId: u.id } }),
          this.prisma.question.groupBy({ by: ['status'], where: { authorId: u.id }, _count: true }),
          this.prisma.exam.count({ where: { ...examScope, status: 'RESULT_PENDING', resultBatch: { status: 'GRADED' } } }),
          this.prisma.student.count({ where: { institutionId: sf } }),
        ]);
        return { myQuestions: mine, byStatus: Object.fromEntries(bySt.map((s) => [s.status, s._count])), resultsToReview: review, students };
      }
      case 'EXAMINER': {
        const [qs, papers, live, results] = await Promise.all([
          this.prisma.question.count({ where: { status: 'SUBMITTED' } }),
          this.prisma.exam.count({ where: { status: 'PAPER_PENDING' } }),
          this.prisma.exam.count({ where: { status: 'LIVE' } }),
          this.prisma.exam.count({ where: { status: 'RESULT_PENDING', resultBatch: { status: 'LECTURER_REVIEWED' } } }),
        ]);
        return { questionsToReview: qs, papersPending: papers, liveExams: live, resultsToApprove: results };
      }
      case 'CAMPUS_ADMIN': {
        const [students, users, exams, incidents] = await Promise.all([
          this.prisma.student.count({ where: { institutionId: sf } }),
          this.prisma.user.count({ where: { institutions: { some: { institutionId: sf } }, role: { in: ['STUDENT', 'LECTURER', 'INVIGILATOR'] } } }),
          this.prisma.exam.count({ where: { ...examScope, status: { in: ['SCHEDULED', 'LIVE'] } } }),
          this.prisma.incident.count({ where: { institutionId: sf, status: { in: ['OPEN', 'INVESTIGATING'] } } }),
        ]);
        return { students, staffAndStudents: users, upcomingExams: exams, openIncidents: incidents };
      }
      case 'INVIGILATOR': {
        const [duties, live, mine] = await Promise.all([
          this.prisma.examInvigilator.count({ where: { userId: u.id, exam: { status: { in: ['SCHEDULED', 'LIVE'] } } } }),
          this.prisma.examInvigilator.count({ where: { userId: u.id, exam: { status: 'LIVE' } } }),
          this.prisma.incident.count({ where: { reportedBy: u.id, status: { in: ['OPEN', 'INVESTIGATING'] } } }),
        ]);
        return { assignedExams: duties, liveNow: live, myOpenIncidents: mine };
      }
      case 'CCE': {
        const [papers, publish, incidents, live] = await Promise.all([
          this.prisma.exam.count({ where: { status: 'PAPER_PENDING' } }),
          this.prisma.exam.count({ where: { resultBatch: { status: 'EXAMINER_APPROVED' } } }),
          this.prisma.incident.count({ where: { status: { in: ['OPEN', 'INVESTIGATING'] } } }),
          this.prisma.exam.count({ where: { status: 'LIVE' } }),
        ]);
        return { papersToApprove: papers, resultsToPublish: publish, openIncidents: incidents, liveExams: live };
      }
      default: {
        const [institutions, users, students, exams, audit] = await Promise.all([
          this.prisma.institution.count(), this.prisma.user.count(), this.prisma.student.count(), this.prisma.exam.count(), this.prisma.auditLog.count(),
        ]);
        return { institutions, users, students, exams, auditEntries: audit };
      }
    }
  }

  async examReport(u: AuthUser, examId: string) {
    const exam = await this.prisma.exam.findFirst({ where: { id: examId, ...(u.institutionIds === null ? {} : { institutions: { some: { institutionId: { in: u.institutionIds } } } }) }, include: { resultBatch: true } });
    if (!exam) throw notFound('Exam');
    // Campus admins only receive aggregates for published results.
    const published = exam.resultBatch?.status === 'PUBLISHED';
    if (u.role === 'CAMPUS_ADMIN' && !published) return { exam: { id: exam.id, code: exam.code, title: exam.title }, available: false as const };
    const rows = await this.prisma.result.findMany({ where: { examId, student: { institutionId: scope.filter(u) } }, select: { percent: true, status: true, student: { select: { institution: { select: { code: true, name: true } } } } } });
    const sat = rows.filter((r) => r.status !== 'ABSENT');
    const buckets = Array.from({ length: 10 }, (_, i) => ({ from: i * 10, to: i * 10 + 10, count: 0 }));
    for (const r of sat) buckets[Math.min(9, Math.floor(r.percent / 10))]!.count++;
    const byInst = new Map<string, { code: string; name: string; sat: number; passed: number; sum: number }>();
    for (const r of sat) {
      const i = r.student.institution;
      const e = byInst.get(i.code) ?? { code: i.code, name: i.name, sat: 0, passed: 0, sum: 0 };
      e.sat++; e.sum += r.percent; if (r.status === 'PASS') e.passed++;
      byInst.set(i.code, e);
    }
    const mean = sat.length ? sat.reduce((a, b) => a + b.percent, 0) / sat.length : 0;
    const sd = sat.length ? Math.sqrt(sat.reduce((a, b) => a + (b.percent - mean) ** 2, 0) / sat.length) : 0;
    return {
      available: true as const, exam: { id: exam.id, code: exam.code, title: exam.title, status: exam.status }, candidates: rows.length, sat: sat.length, absent: rows.length - sat.length,
      mean: Math.round(mean * 100) / 100, stdDev: Math.round(sd * 100) / 100, passRate: sat.length ? Math.round((sat.filter((r) => r.status === 'PASS').length / sat.length) * 1000) / 10 : 0, distribution: buckets,
      byInstitution: [...byInst.values()].map((e) => ({ code: e.code, name: e.name, sat: e.sat, passRate: Math.round((e.passed / e.sat) * 1000) / 10, mean: Math.round((e.sum / e.sat) * 100) / 100 })),
    };
  }

  async examCsv(u: AuthUser, examId: string) {
    const exam = await this.prisma.exam.findFirst({ where: { id: examId, ...(u.institutionIds === null ? {} : { institutions: { some: { institutionId: { in: u.institutionIds } } } }) }, include: { resultBatch: true } });
    if (!exam) throw notFound('Exam');
    if (u.role === 'CAMPUS_ADMIN' && exam.resultBatch?.status !== 'PUBLISHED') throw notFound('Exam');
    const rows = await this.prisma.result.findMany({ where: { examId, student: { institutionId: scope.filter(u) } }, include: { student: { select: { regNo: true, institution: { select: { code: true } }, user: { select: { fullName: true } } } } }, orderBy: { student: { regNo: 'asc' } } });
    // Neutralise spreadsheet-formula injection in free-text cells.
    const cell = (v: string | number) => { const s = String(v).replace(/"/g, '""'); return /^[=+\-@\t\r]/.test(s) ? `"'${s}"` : `"${s}"`; };
    return ['regNo,name,institution,rawScore,totalMarks,percent,status', ...rows.map((r) => [r.student.regNo, r.student.user.fullName, r.student.institution.code, r.rawScore, r.totalMarks, r.percent, r.status].map(cell).join(','))].join('\n');
  }

  async institutionSummary() {
    return this.prisma.$queryRaw<{ code: string; name: string; students: number; users: number }[]>`
      SELECT i.code, i.name, (SELECT count(*)::int FROM students s WHERE s."institutionId" = i.id) AS students, (SELECT count(*)::int FROM user_institutions ui WHERE ui."institutionId" = i.id) AS users
      FROM institutions i ORDER BY i.name`;
  }
}
