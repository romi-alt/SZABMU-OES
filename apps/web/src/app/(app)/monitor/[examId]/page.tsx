'use client';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { post, fmtTime, useGet } from '@/api';
import { useMe } from '@/session';
import { Async, Card, Confirm, Field, PageHead, Stat, Status, Table, useAction } from '@/ui';

export default function MonitorExam() {
  const { examId } = useParams<{ examId: string }>(); const { me, can } = useMe(); const { run } = useAction();
  const st = useGet<any>(`/invigilation/exams/${examId}/monitor`); const [q, setQ] = useState(''); const [act, setAct] = useState<{ kind: 'extend' | 'force' | 'incident'; row: any } | null>(null);
  const [minutes, setMinutes] = useState(10); const [reason, setReason] = useState(''); const [sev, setSev] = useState('LOW'); const [type, setType] = useState('TECHNICAL');
  useEffect(() => { const t = setInterval(() => st.reload(), 5000); return () => clearInterval(t); }, [st.reload]);
  const close = () => { setAct(null); setReason(''); };
  return (
    <>
      <PageHead title="Live monitor" sub="Refreshes every 5 seconds. Connection state comes from candidate heartbeats; answers come from the database." />
      <Async state={st}>{(d) => {
        const rows = d.rows.filter((r: any) => !q || r.regNo.toLowerCase().includes(q.toLowerCase()) || r.fullName.toLowerCase().includes(q.toLowerCase()));
        const s = d.summary;
        return <div className="stack-lg">
          <div className="grid g4"><Stat k="Candidates" v={s.candidates} s={`${s.notStarted} not started`} /><Stat k="In progress" v={s.inProgress} s={`${s.disconnected} disconnected`} /><Stat k="Submitted" v={s.submitted} /><Stat k="Integrity flags" v={s.flagged} s="tab switches etc." /></div>
          <Card flush>
            <div className="filters"><Field label="Find candidate"><input className="in" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Reg. no. or name" /></Field></div>
            <Table rowKey={(r: any) => r.studentId} rows={rows} empty="No candidates." cols={[
              { h: 'Reg. no.', cell: (r: any) => <span className="code">{r.regNo}</span> }, { h: 'Name', cell: (r: any) => r.fullName }, { h: 'Campus', cell: (r: any) => r.institution },
              { h: 'Status', cell: (r: any) => <Status s={r.status} /> }, { h: 'Connection', cell: (r: any) => <Status s={r.connection} /> },
              { h: 'Answered', num: true, cell: (r: any) => r.attemptId ? `${r.answered}/${r.total}` : '—' }, { h: 'Deadline', cell: (r: any) => fmtTime(r.deadlineAt) }, { h: 'Flags', num: true, cell: (r: any) => r.integrityFlags || '' },
              { h: '', cell: (r: any) => <div className="row">
                {can('invigilation.intervene') && r.status === 'IN_PROGRESS' && <><button className="btn btn-sm" onClick={() => setAct({ kind: 'extend', row: r })}>+ Time</button><button className="btn btn-sm btn-danger" onClick={() => setAct({ kind: 'force', row: r })}>End</button></>}
                {can('incident.report') && <button className="btn btn-sm" onClick={() => setAct({ kind: 'incident', row: r })}>Report</button>}</div> },
            ]} />
          </Card>
          {act?.kind === 'extend' && <Confirm title={`Extend time — ${act.row.regNo}`} yes="Extend" onNo={close} onYes={() => run(async () => { await post(`/invigilation/attempts/${act.row.attemptId}/extend`, { minutes, reason }); close(); st.reload(); }, 'Time extended')} body={<div className="stack"><Field label="Minutes (1–60)"><input className="in" type="number" min={1} max={60} value={minutes} onChange={(e) => setMinutes(+e.target.value)} /></Field><Field label="Reason (audited)"><textarea className="in" value={reason} onChange={(e) => setReason(e.target.value)} /></Field></div>} />}
          {act?.kind === 'force' && <Confirm title={`End attempt — ${act.row.regNo}`} yes="End and seal answers" danger onNo={close} onYes={() => run(async () => { await post(`/invigilation/attempts/${act.row.attemptId}/force-submit`, { reason }); close(); st.reload(); }, 'Attempt ended')} body={<div className="stack"><p>The candidate's saved answers are sealed and submitted. This cannot be undone.</p><Field label="Reason (audited)"><textarea className="in" value={reason} onChange={(e) => setReason(e.target.value)} /></Field></div>} />}
          {act?.kind === 'incident' && <Confirm title={`Report incident — ${act.row.regNo}`} yes="File report" onNo={close} onYes={() => run(async () => { const inst = me?.institutions.find((i) => i.code === act.row.institution)?.id ?? me?.institutions[0]?.id; await post('/incidents', { examId, institutionId: inst, attemptId: act.row.attemptId ?? undefined, type, severity: sev, description: reason }); close(); }, 'Incident reported')} body={<div className="stack"><div className="grid g2"><Field label="Type"><select className="in" value={type} onChange={(e) => setType(e.target.value)}>{['CONNECTIVITY', 'TECHNICAL', 'IDENTITY', 'MISCONDUCT', 'ENVIRONMENT', 'OTHER'].map((t) => <option key={t}>{t}</option>)}</select></Field><Field label="Severity"><select className="in" value={sev} onChange={(e) => setSev(e.target.value)}>{['LOW', 'MEDIUM', 'HIGH'].map((t) => <option key={t}>{t}</option>)}</select></Field></div><Field label="Description (min. 10 characters)"><textarea className="in" value={reason} onChange={(e) => setReason(e.target.value)} /></Field></div>} />}
        </div>;
      }}</Async>
    </>
  );
}
