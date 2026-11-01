'use client';
import Link from 'next/link';
import { useGet } from '@/api';
import { useMe } from '@/session';
import { Async, Card, PageHead, Stat } from '@/ui';
import { examPriority } from '@oes/shared';
import { ExamActionLink, ExamStatusCell, presentExam, type MyExam } from '@/exam-status-ui';

const TILES: Record<string, { k: string; key: string; s?: string; href?: string }[]> = {
  STUDENT: [{ k: 'Open now', key: 'openNow', s: 'You can start or resume', href: '/schedule' }, { k: 'Scheduled', key: 'scheduled', s: 'Not open yet', href: '/schedule' }, { k: 'Results published', key: 'completed', href: '/results' }, { k: 'Average score', key: 'avgPercent', s: 'Across published results' }],
  LECTURER: [{ k: 'My questions', key: 'myQuestions', href: '/questions' }, { k: 'Results to review', key: 'resultsToReview', href: '/exams' }, { k: 'Students at campus', key: 'students', href: '/students' }],
  EXAMINER: [{ k: 'Questions to review', key: 'questionsToReview', href: '/questions?status=SUBMITTED' }, { k: 'Papers pending', key: 'papersPending', href: '/exams?status=PAPER_PENDING' }, { k: 'Live exams', key: 'liveExams', href: '/monitor' }, { k: 'Results to approve', key: 'resultsToApprove', href: '/exams?status=RESULT_PENDING' }],
  CAMPUS_ADMIN: [{ k: 'Students', key: 'students', href: '/students' }, { k: 'Accounts', key: 'staffAndStudents', href: '/users' }, { k: 'Live now', key: 'liveExams', s: 'Examinations in progress', href: '/monitor' }, { k: 'Scheduled', key: 'scheduledExams', s: 'Not open yet', href: '/exams' }, { k: 'Open incidents', key: 'openIncidents', href: '/incidents' }],
  INVIGILATOR: [{ k: 'Assigned exams', key: 'assignedExams', href: '/monitor' }, { k: 'Live now', key: 'liveNow', href: '/monitor' }, { k: 'My open incidents', key: 'myOpenIncidents', href: '/incidents' }],
  CCE: [{ k: 'Papers to approve', key: 'papersToApprove', href: '/exams?status=PAPER_PENDING' }, { k: 'Results to publish', key: 'resultsToPublish', href: '/exams?status=RESULT_PENDING' }, { k: 'Open incidents', key: 'openIncidents', href: '/incidents' }, { k: 'Live exams', key: 'liveExams', href: '/monitor' }],
  SUPER_ADMIN: [{ k: 'Institutions', key: 'institutions', href: '/institutions' }, { k: 'Users', key: 'users', href: '/users' }, { k: 'Students', key: 'students', href: '/students' }, { k: 'Exams', key: 'exams', href: '/exams' }, { k: 'Audit entries', key: 'auditEntries', href: '/audit' }],
};

/** What needs the candidate's attention, in order, using the same status model as the schedule (UI-007). */
function MyExams() {
  const st = useGet<{ serverNow: string; items: MyExam[] }>('/me/exams');
  return (
    <Card title="Your examinations" actions={<Link className="btn btn-sm" href="/schedule">All examinations</Link>}>
      <Async state={st} idle={<div className="card-b muted">Nothing to show yet.</div>}>{(d) => {
        const off = new Date(d.serverNow).getTime() - Date.now();
        const rows = [...d.items].map((r) => ({ r, p: presentExam(r, off) })).filter(({ p }) => p.key !== 'CLOSED_NOT_SAT' && p.key !== 'CANCELLED').sort((a, b) => examPriority(a.p) - examPriority(b.p)).slice(0, 3);
        if (!rows.length) return <div className="card-b muted">No examinations are scheduled for you yet.</div>;
        return <div>{rows.map(({ r }) => <div key={r.examId} className="row between wrap" style={{ padding: '12px 16px', borderBottom: '1px solid var(--rose)', alignItems: 'flex-start' }}><div style={{ minWidth: 0 }}><b>{r.title}</b><div className="small faint">{r.course.title} · {r.durationMin} min</div><div style={{ marginTop: 6 }}><ExamStatusCell row={r} offset={off} /></div></div><ExamActionLink row={r} offset={off} size="md" /></div>)}</div>;
      }}</Async>
    </Card>
  );
}

export default function Dashboard() {
  const { me } = useMe(); const st = useGet<any>('/dashboard');
  if (!me) return null;
  const first = me.fullName.replace(/^(Dr\.|Prof\.)\s*/, '').split(' ')[0];
  return (
    <>
      <PageHead title={`Welcome back, ${first}`} sub={me.student ? `${me.student.program} · Semester ${me.student.semester} · Reg. ${me.student.regNo}` : me.institutions.map((i) => i.name).join(', ') || 'University-wide access'}>
        {me.role === 'STUDENT' && <Link className="btn btn-green" href="/schedule">View exam schedule</Link>}
      </PageHead>
      <Async state={st}>{(d) => (
        <div className="stack-lg">
          <div className={`grid g${Math.min(5, TILES[me.role]!.length)}`}>{TILES[me.role]!.map((t) => {
            const v = d[t.key]; const tile = <Stat key={t.k} k={t.k} v={v === null || v === undefined ? '—' : t.key === 'avgPercent' ? `${v}%` : v} s={t.s} />;
            return t.href ? <Link key={t.k} href={t.href} style={{ textDecoration: 'none', color: 'inherit' }}>{tile}</Link> : tile;
          })}</div>
          {me.role === 'STUDENT' && <MyExams />}
          {me.role === 'LECTURER' && d.byStatus && <Card title="My question pipeline"><div className="row wrap">{Object.entries(d.byStatus).map(([k, v]) => <span key={k} className="chip" aria-pressed="false">{k.toLowerCase()}: <b className="mono">{v as number}</b></span>)}</div></Card>}
        </div>)}
      </Async>
    </>
  );
}
