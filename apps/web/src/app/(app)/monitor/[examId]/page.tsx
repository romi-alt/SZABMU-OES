'use client';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { post, fmtTime, openStream, useGet } from '@/api';
import { isCampusScoped } from '@oes/shared';
import { useMe } from '@/session';
import { useUrlState } from '@/url-state';
import { Async, Card, Confirm, Field, ListEmpty, PageHead, Stat, Status, Table, useAction } from '@/ui';

export default function MonitorExam() {
  const { examId } = useParams<{ examId: string }>(); const { me, can } = useMe(); const { run } = useAction();
  const url = useUrlState({ page: '1', q: '' }); const page = Number(url.vals.page) || 1; const q = url.vals.q; const setPage = (n: number) => url.set('page', String(n)); const setQ = (v: string) => url.set('q', v); const [act, setAct] = useState<{ kind: 'extend' | 'force' | 'incident'; row: any } | null>(null);
  const [live, setLive] = useState(false); const [snap, setSnap] = useState<any>(null);
  const first = useGet<any>(`/invigilation/exams/${examId}/snapshot`);
  const st = useGet<any>(`/invigilation/exams/${examId}/candidates?page=${page}&pageSize=50${q ? `&search=${encodeURIComponent(q)}` : ''}`);
  const [minutes, setMinutes] = useState(10); const [reason, setReason] = useState(''); const [sev, setSev] = useState('LOW'); const [type, setType] = useState('TECHNICAL');
  const refused = !!first.error && first.error.status >= 400 && first.error.status < 500;   // not found / not permitted: nothing to reconnect to
  const reload = st.reload; const last = useRef(0);
  // Push (SSE) with automatic catch-up on reconnect; polling only while the stream is down. Scope is enforced by the server for this campus.
  useEffect(() => refused ? undefined : openStream(`/invigilation/exams/${examId}/stream`, { status: setLive, event: (name, data) => { if (name === 'stats') { setSnap(data); if (Date.now() - last.current > 5000) { last.current = Date.now(); void reload(); } } else if (name !== 'state') void reload(); } }), [examId, reload, refused]);
  useEffect(() => { if (live || refused) return; const t = setInterval(() => { void reload(); void first.reload(); }, 8000); return () => clearInterval(t); }, [live, refused, reload, first.reload]);
  const close = () => { setAct(null); setReason(''); };
  const scope = !me ? '' : isCampusScoped(me.role) ? `${me.institutions.map((i) => i.code).join(', ') || 'Your campus'} only` : 'All participating campuses';
  return (
    <>
      <PageHead title="Live monitor" sub={<>{refused ? 'Live updates are off for this examination' : live ? 'Live (push)' : 'Reconnecting — refreshing every 8 s'}. <span data-testid="monitor-scope">{scope}</span>. Counts and answers come from the database; connection state from candidate heartbeats.</>} />
      <Async state={first}>{(f) => <Async state={st}>{(d) => {
        const sn = snap ?? f; const t = sn.totals; const rows = d.rows;
        return <div className="stack-lg">
          {sn.freshness?.degraded && <div className="notice warn" role="status">Monitoring degraded: {sn.freshness.reasons.join('; ')}.</div>}
          <div className="grid g4"><Stat k="Candidates" v={t.allocated} s={`${t.allocated - t.admitted} not started`} /><Stat k="In progress" v={t.inProgress + t.suspended} s={`${t.disconnected ?? '—'} disconnected${t.suspended ? ` · ${t.suspended} suspended` : ''}`} /><Stat k="Submitted" v={t.submitted + t.autoSubmitted} s={`${t.autoSubmitted} automatic`} /><Stat k="Open incidents" v={t.activeIncidents} /></div>
          <Card flush>
            <div className="filters"><Field label="Find candidate"><input className="in" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Reg. no. or name" /></Field></div>
            <Table rowKey={(r: any) => r.studentId} rows={rows} empty={q ? <ListEmpty noun="candidates" filters={[`“${q}”`]} onClear={url.reset} /> : 'No candidates.'} cols={[
              { h: 'Reg. no.', cell: (r: any) => <span className="code">{r.regNo}</span> }, { h: 'Name', cell: (r: any) => r.fullName }, { h: 'Campus', cell: (r: any) => r.institution },
              { h: 'Status', cell: (r: any) => <Status s={r.suspended ? 'SUSPENDED' : r.status} /> }, { h: 'Connection', cell: (r: any) => <Status s={r.connection} /> },
              { h: 'Answered', num: true, cell: (r: any) => r.attemptId ? r.answered : '—' }, { h: 'Deadline', cell: (r: any) => fmtTime(r.deadlineAt) }, { h: 'Flags', num: true, cell: (r: any) => r.integrityFlags || '' },
              { h: '', cell: (r: any) => <div className="row">
                {can('invigilation.intervene') && r.status === 'IN_PROGRESS' && <><button className="btn btn-sm" aria-label={`Add time for ${r.regNo}`} onClick={() => setAct({ kind: 'extend', row: r })}>Add time</button><button className="btn btn-sm btn-danger" aria-label={`End attempt for ${r.regNo}`} onClick={() => setAct({ kind: 'force', row: r })}>End attempt…</button></>}
                {can('incident.report') && <button className="btn btn-sm" aria-label={`Report incident for ${r.regNo}`} onClick={() => setAct({ kind: 'incident', row: r })}>Report incident</button>}</div> },
            ]} />
            <div className="row between" style={{ padding: '8px 16px' }}><span className="small muted">Page {d.page} of {Math.max(1, Math.ceil(d.total / d.pageSize))} · {d.total} candidates</span><span className="row"><button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><button className="btn btn-sm" disabled={page * d.pageSize >= d.total} onClick={() => setPage(page + 1)}>Next</button></span></div>
          </Card>
          {act?.kind === 'extend' && <Confirm title={`Extend time — ${act.row.regNo}`} yes="Extend" onNo={close} onYes={() => run(async () => { await post(`/invigilation/attempts/${act.row.attemptId}/extend`, { minutes, reason }); close(); st.reload(); }, 'Time extended')} body={<div className="stack"><Field label="Minutes (1–60)"><input className="in" type="number" min={1} max={60} value={minutes} onChange={(e) => setMinutes(+e.target.value)} /></Field><Field label="Reason (audited)"><textarea className="in" value={reason} onChange={(e) => setReason(e.target.value)} /></Field></div>} />}
          {act?.kind === 'force' && <Confirm title={`End attempt — ${act.row.regNo}`} yes="End and seal answers" danger onNo={close} onYes={() => run(async () => { await post(`/invigilation/attempts/${act.row.attemptId}/force-submit`, { reason }); close(); st.reload(); }, 'Attempt ended')} body={<div className="stack"><p>The candidate's saved answers are sealed and submitted. This cannot be undone.</p><Field label="Reason (audited)"><textarea className="in" value={reason} onChange={(e) => setReason(e.target.value)} /></Field></div>} />}
          {act?.kind === 'incident' && <Confirm title={`Report incident — ${act.row.regNo}`} yes="File report" onNo={close} onYes={() => run(async () => { const inst = me?.institutions.find((i) => i.code === act.row.institution)?.id ?? me?.institutions[0]?.id; await post('/incidents', { examId, institutionId: inst, attemptId: act.row.attemptId ?? undefined, type, severity: sev, description: reason }); close(); }, 'Incident reported')} body={<div className="stack"><div className="grid g2"><Field label="Type"><select className="in" value={type} onChange={(e) => setType(e.target.value)}>{['CONNECTIVITY', 'TECHNICAL', 'IDENTITY', 'MISCONDUCT', 'ENVIRONMENT', 'OTHER'].map((t) => <option key={t}>{t}</option>)}</select></Field><Field label="Severity"><select className="in" value={sev} onChange={(e) => setSev(e.target.value)}>{['LOW', 'MEDIUM', 'HIGH'].map((t) => <option key={t}>{t}</option>)}</select></Field></div><Field label="Description (min. 10 characters)"><textarea className="in" value={reason} onChange={(e) => setReason(e.target.value)} /></Field></div>} />}
        </div>;
      }}</Async>}</Async>
    </>
  );
}
