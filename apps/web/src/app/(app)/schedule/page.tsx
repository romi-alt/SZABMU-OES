'use client';
import { fmtDT, useGet } from '@/api';
import { useMe } from '@/session';
import { Async, Card, PageHead, Table } from '@/ui';
import { ExamActionLink, ExamStatusCell, type MyExam, NotEligibleNotice } from '@/exam-status-ui';

export default function Schedule() {
  const { me } = useMe(); const st = useGet<any>(me?.role === 'STUDENT' ? '/me/exams' : null);
  if (me && me.role !== 'STUDENT') return <p>This page is for candidates.</p>;
  return (
    <>
      <PageHead title="Exam schedule" sub="Your examinations and what you can do with each one right now (server time)." />
      {st.data && <NotEligibleNotice items={st.data.notEligible} />}
      <Card flush><Async state={st}>{(d) => {
        const off = new Date(d.serverNow).getTime() - Date.now();
        return <Table rowKey={(r: MyExam) => r.examId} empty="No examinations are scheduled for you yet." rows={d.items} cols={[
          { h: 'Code', cell: (r: MyExam) => <span className="code">{r.code}</span> }, { h: 'Subject', cell: (r: MyExam) => <><b>{r.title}</b><div className="small faint">{r.course.title} · Semester {r.course.semester}</div></> },
          { h: 'Planned window', cell: (r: MyExam) => <><div>{fmtDT(r.opensAt)}</div><div className="small muted">to {fmtDT(r.closesAt)}</div></> }, { h: 'Duration', num: true, cell: (r: MyExam) => `${r.durationMin} min` }, { h: 'Questions', num: true, cell: (r: MyExam) => r.questionCount },
          { h: 'Status', cell: (r: MyExam) => <ExamStatusCell row={r} offset={off} /> },
          { h: '', cell: (r: MyExam) => <ExamActionLink row={r} offset={off} /> },
        ]} />;
      }}</Async></Card>
    </>
  );
}
