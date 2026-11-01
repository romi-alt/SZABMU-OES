'use client';
import Link from 'next/link';
import { useGet, fmtDT } from '@/api';
import { useMe } from '@/session';
import { Async, Card, PageHead, Stat } from '@/ui';
import type { DashboardDto } from '@oes/shared';

const TILES: Record<string, { k: string; key: string; s?: string; href?: string }[]> = {
  STUDENT: [{ k: 'Upcoming exams', key: 'upcoming', href: '/schedule' }, { k: 'Completed', key: 'completed', s: 'Published results', href: '/results' }, { k: 'Average score', key: 'avgPercent', s: 'Across published results' }, { k: 'Passed', key: 'passed' }],
  LECTURER: [{ k: 'My questions', key: 'myQuestions', href: '/questions' }, { k: 'Results to review', key: 'resultsToReview', href: '/exams' }, { k: 'Students at campus', key: 'students', href: '/students' }],
  EXAMINER: [{ k: 'Questions to review', key: 'questionsToReview', href: '/questions?status=SUBMITTED' }, { k: 'Papers pending', key: 'papersPending', href: '/exams?status=PAPER_PENDING' }, { k: 'Live exams', key: 'liveExams', href: '/monitor' }, { k: 'Results to approve', key: 'resultsToApprove', href: '/exams?status=RESULT_PENDING' }],
  CAMPUS_ADMIN: [{ k: 'Students', key: 'students', href: '/students' }, { k: 'Accounts', key: 'staffAndStudents', href: '/users' }, { k: 'Upcoming exams', key: 'upcomingExams', href: '/exams' }, { k: 'Open incidents', key: 'openIncidents', href: '/incidents' }],
  INVIGILATOR: [{ k: 'Assigned exams', key: 'assignedExams', href: '/monitor' }, { k: 'Live now', key: 'liveNow', href: '/monitor' }, { k: 'My open incidents', key: 'myOpenIncidents', href: '/incidents' }],
  CCE: [{ k: 'Papers to approve', key: 'papersToApprove', href: '/exams?status=PAPER_PENDING' }, { k: 'Results to publish', key: 'resultsToPublish', href: '/exams?status=RESULT_PENDING' }, { k: 'Open incidents', key: 'openIncidents', href: '/incidents' }, { k: 'Live exams', key: 'liveExams', href: '/monitor' }],
  SUPER_ADMIN: [{ k: 'Institutions', key: 'institutions', href: '/institutions' }, { k: 'Users', key: 'users', href: '/users' }, { k: 'Students', key: 'students', href: '/students' }, { k: 'Exams', key: 'exams', href: '/exams' }, { k: 'Audit entries', key: 'auditEntries', href: '/audit' }],
};

export default function Dashboard() {
  const { me } = useMe(); const st = useGet<DashboardDto>('/dashboard');
  if (!me) return null;
  const first = me.fullName.replace(/^(Dr\.|Prof\.)\s*/, '').split(' ')[0];
  return (
    <>
      <PageHead title={`Welcome back, ${first}`} sub={me.student ? `${me.student.program} · Semester ${me.student.semester} · Reg. ${me.student.regNo}` : me.institutions.map((i) => i.name).join(', ') || 'University-wide access'}>
        {me.role === 'STUDENT' && <Link className="btn btn-green" href="/schedule">View exam schedule</Link>}
      </PageHead>
      <Async state={st}>{(d) => (
        <div className="stack-lg">
          <div className={`grid g${Math.min(4, TILES[me.role]!.length)}`}>{TILES[me.role]!.map((t) => {
            const v = d[t.key] as number | null | undefined; const tile = <Stat key={t.k} k={t.k} v={v === null || v === undefined ? '—' : t.key === 'avgPercent' ? `${v}%` : v} s={t.s} />;
            return t.href ? <Link key={t.k} href={t.href} style={{ textDecoration: 'none', color: 'inherit' }}>{tile}</Link> : tile;
          })}</div>
          {me.role === 'STUDENT' && d.next && <Card title="Next examination"><div className="row between"><div><b>{d.next.title}</b><div className="muted small">Opens {fmtDT(d.next.opensAt)}</div></div><Link className="btn btn-primary" href="/schedule">Go to schedule</Link></div></Card>}
          {me.role === 'LECTURER' && d.byStatus && <Card title="My question pipeline"><div className="row wrap">{Object.entries(d.byStatus).map(([k, v]) => <span key={k} className="chip" aria-pressed="false">{k.toLowerCase()}: <b className="mono">{v as number}</b></span>)}</div></Card>}
        </div>)}
      </Async>
    </>
  );
}
