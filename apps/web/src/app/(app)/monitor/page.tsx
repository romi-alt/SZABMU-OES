'use client';
import Link from 'next/link';
import { fmtDT, useGet } from '@/api';
import { Async, Card, PageHead, Status, Table } from '@/ui';

export default function Monitor() {
  const st = useGet<any[]>('/invigilation/exams');
  return (
    <>
      <PageHead title="Live monitor" sub="Examinations you are assigned to (or, for administrators, within your scope)." />
      <Card flush><Async state={st}>{(rows: any[]) => <Table rowKey={(r: any) => r.id} empty="No scheduled or live examinations." rows={rows} cols={[
        { h: 'Code', cell: (r: any) => <span className="code">{r.code}</span> }, { h: 'Exam', cell: (r: any) => <b>{r.title}</b> }, { h: 'Opens', cell: (r: any) => fmtDT(r.opensAt) }, { h: 'Closes', cell: (r: any) => fmtDT(r.closesAt) }, { h: 'Candidates', num: true, cell: (r: any) => r._count.candidates }, { h: 'Status', cell: (r: any) => <Status s={r.status} /> }, { h: '', cell: (r: any) => <Link className="btn btn-sm btn-green" href={`/monitor/${r.id}`}>Monitor ›</Link> },
      ]} />}</Async></Card>
    </>
  );
}
