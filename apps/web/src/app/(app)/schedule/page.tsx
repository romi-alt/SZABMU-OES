'use client';
import { fmtDT, useGet } from '@/api';
import { useMe } from '@/session';
import { Async, PageHead, Table } from '@/ui';
import { ExamActionLink, ExamStatusCell, presentExam, type MyExam, NotEligibleNotice } from '@/exam-status-ui';

const AVAILABLE = ['OPEN_TO_START', 'ADMISSION_OPEN', 'IN_PROGRESS', 'SUSPENDED'];
const UPCOMING = ['SCHEDULED_AUTO', 'SCHEDULED_MANUAL', 'NOT_AVAILABLE', 'ADMISSION_CLOSED'];

/** My Examinations: only what the server lists for this student (their roster entries), grouped by what they can do now. Eligibility is enforced by the API, not here. */
export default function Schedule() {
  const { me } = useMe(); const st = useGet<any>(me?.role === 'STUDENT' ? '/me/exams' : null);
  if (me && me.role !== 'STUDENT') return <p>This page is for candidates.</p>;
  return (
    <>
      <PageHead title="My Examinations" sub="The examinations assigned to you and what you can do with each one right now (server time)." />
      {st.data && <NotEligibleNotice items={st.data.notEligible} />}
      <Async state={st}>{(d) => {
        const off = new Date(d.serverNow).getTime() - Date.now(); const rows: MyExam[] = d.items;
        if (!rows.length) return <div className="mx-empty" data-testid="no-exams"><b>No examinations are currently assigned to your account.</b></div>;
        const key = (r: MyExam) => presentExam(r, off).key;
        const groups: [string, string, MyExam[]][] = [['Available exams', 'available', rows.filter((r) => AVAILABLE.includes(key(r)))], ['Upcoming exams', 'upcoming', rows.filter((r) => UPCOMING.includes(key(r)))], ['Completed exams', 'completed', rows.filter((r) => !AVAILABLE.includes(key(r)) && !UPCOMING.includes(key(r)))]];
        return <>{groups.filter(([, , list]) => list.length).map(([title, id, list]) => (
          <section key={id} className="mx-section" aria-labelledby={`mx-${id}`} data-testid={`exams-${id}`}>
            <h2 id={`mx-${id}`}>{title} <span className="count">{list.length}</span></h2>
            <Table rowKey={(r: MyExam) => r.examId} rows={list} cols={[
              { h: 'Examination', cell: (r: MyExam) => <><b>{r.title}</b><div className="small faint"><span className="code">{r.code}</span> · {r.course.title}</div><div className="mx-facts"><span>{(r as any).course.program?.code ? `${(r as any).course.program.code} · ` : ''}Semester {r.course.semester}</span></div></> },
              { h: 'Scheduled', cell: (r: MyExam) => <><div>{fmtDT(r.opensAt)}</div><div className="small muted">to {fmtDT(r.closesAt)}</div></> },
              { h: 'Duration', num: true, cell: (r: MyExam) => `${r.durationMin} min` }, { h: 'Questions', num: true, cell: (r: MyExam) => r.questionCount }, { h: 'Marks', num: true, cell: (r: MyExam) => (r as any).totalMarks ?? '—' },
              { h: 'Status', cell: (r: MyExam) => <ExamStatusCell row={r} offset={off} /> },
              { h: '', cell: (r: MyExam) => <ExamActionLink row={r} offset={off} /> },
            ]} />
          </section>))}</>;
      }}</Async>
    </>
  );
}
