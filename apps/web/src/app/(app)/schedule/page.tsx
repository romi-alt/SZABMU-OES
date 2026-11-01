'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { fmtDT, useGet } from '@/api';
import { useMe } from '@/session';
import type { MyExamsDto } from '@oes/shared';
import { Async, Card, PageHead, Status, Table } from '@/ui';

function Countdown({ to, offset }: { to: string; offset: number }) {
  const [n, setN] = useState(0);
  useEffect(() => { const t = setInterval(() => setN((x) => x + 1), 1000); return () => clearInterval(t); }, []);
  void n; const ms = new Date(to).getTime() - (Date.now() + offset);
  if (ms <= 0) return <span className="mono">now</span>;
  const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return <span className="mono">{d ? `${d}d ` : ''}{String(h).padStart(2, '0')}:{String(m).padStart(2, '0')}:{String(s % 60).padStart(2, '0')}</span>;
}

export default function Schedule() {
  const { me } = useMe(); const st = useGet<MyExamsDto>(me?.role === 'STUDENT' ? '/me/exams' : null);
  if (me && me.role !== 'STUDENT') return <p>This page is for candidates.</p>;
  return (
    <>
      <PageHead title="Exam schedule" sub="Your examinations. The start button unlocks when the examination opens (server time)." />
      <Card flush><Async state={st}>{(d) => {
        const off = new Date(d.serverNow).getTime() - Date.now();
        return <Table rowKey={(r) => r.examId} empty="No examinations are scheduled for you yet." rows={d.items} cols={[
          { h: 'Code', cell: (r) => <span className="code">{r.code}</span> }, { h: 'Subject', cell: (r) => <><b>{r.title}</b><div className="small faint">{r.course.title} · Semester {r.course.semester}</div></> },
          { h: 'Opens', cell: (r) => fmtDT(r.opensAt) }, { h: 'Closes', cell: (r) => fmtDT(r.closesAt) }, { h: 'Duration', num: true, cell: (r) => `${r.durationMin} min` }, { h: 'Questions', num: true, cell: (r) => r.questionCount },
          { h: 'Status', cell: (r) => r.attempt ? <Status s={r.attempt.status} /> : <Status s={r.status} /> },
          { h: 'Starts in', cell: (r) => r.attempt && r.attempt.status !== 'IN_PROGRESS' ? <span className="faint">—</span> : <Countdown to={r.opensAt} offset={off} /> },
          { h: '', cell: (r) => r.attempt && r.attempt.status !== 'IN_PROGRESS' ? <span className="small mono">{r.attempt.receiptCode}</span> : r.canStart ? <Link className="btn btn-green btn-sm" href={`/exam/${r.examId}`}>{r.attempt ? 'Resume →' : 'Start →'}</Link> : <button className="btn btn-sm" disabled>Locked</button> },
        ]} />;
      }}</Async></Card>
    </>
  );
}
