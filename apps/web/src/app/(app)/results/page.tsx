'use client';
import Link from 'next/link';
import { fmtDate, useGet } from '@/api';
import { useMe } from '@/session';
import { Async, Card, PageHead, Status, Table } from '@/ui';

export default function Results() {
  const { me } = useMe(); const st = useGet<any[]>(me?.role === 'STUDENT' ? '/me/results' : null);
  if (me && me.role !== 'STUDENT') return <p>This page is for candidates.</p>;
  return (
    <>
      <PageHead title="Results" sub="Published results only. Results appear here after examiner approval and publication by the Controller of Examinations.">
        {(st.data?.length ?? 0) > 0 && <Link className="btn" href="/performance">Performance trends ›</Link>}
      </PageHead>
      <Card title="Subject result view" flush><Async state={st}>{(rows: any[]) => <Table rowKey={(r: any) => r.id} empty="No results have been published yet." rows={rows} cols={[
        { h: 'Code', cell: (r: any) => <span className="code">{r.exam.code}</span> }, { h: 'Subject', cell: (r: any) => <b>{r.exam.course.title}</b> }, { h: 'Course', cell: (r: any) => r.exam.course.program.code },
        { h: 'Sem', num: true, cell: (r: any) => r.exam.course.semester }, { h: 'Date', cell: (r: any) => fmtDate(r.exam.opensAt) }, { h: 'Total', num: true, cell: (r: any) => r.totalMarks }, { h: 'Obtained', num: true, cell: (r: any) => <b>{r.rawScore}</b> },
        { h: '%', num: true, cell: (r: any) => r.percent.toFixed(1) }, { h: 'Status', cell: (r: any) => <Status s={r.status} /> },
        { h: '', cell: (r: any) => r.certificateSerial ? <Link href={`/certificate/${r.id}`}>Certificate ›</Link> : null },
      ]} />}</Async></Card>
    </>
  );
}
