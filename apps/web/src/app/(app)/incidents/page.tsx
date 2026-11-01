'use client';
import { useState } from 'react';
import { patch, post, fmtDT, useGet } from '@/api';
import { useMe } from '@/session';
import { Async, Card, Confirm, Field, PageHead, Status, Table, useAction } from '@/ui';

export default function Incidents() {
  const { can } = useMe(); const { run } = useAction(); const [status, setStatus] = useState(''); const st = useGet<any[]>(`/incidents${status ? `?status=${status}` : ''}`);
  const [act, setAct] = useState<any>(null); const [text, setText] = useState(''); const [to, setTo] = useState('RESOLVED');
  return (
    <>
      <PageHead title="Incidents" sub="Reports raised during examinations. Open incidents block result approval." />
      <Card flush>
        <div className="filters"><Field label="Status"><select className="in" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option>{['OPEN', 'INVESTIGATING', 'RESOLVED', 'DISMISSED'].map((s) => <option key={s}>{s}</option>)}</select></Field></div>
        <Async state={st}>{(rows: any[]) => <Table rowKey={(r: any) => r.id} rows={rows} empty="No incidents." cols={[
          { h: 'Filed', cell: (r: any) => fmtDT(r.createdAt) }, { h: 'Exam', cell: (r: any) => <span className="code">{r.exam.code}</span> }, { h: 'Campus', cell: (r: any) => r.institution.code }, { h: 'Type', cell: (r: any) => r.type.toLowerCase() }, { h: 'Severity', cell: (r: any) => <Status s={r.severity} /> },
          { h: 'Description', cell: (r: any) => <>{r.description}{r.resolution && <div className="small faint">Resolution: {r.resolution}</div>}{r.notes.map((n: any) => <div key={n.id} className="small faint">Note: {n.body}</div>)}</> }, { h: 'Status', cell: (r: any) => <Status s={r.status} /> },
          { h: '', cell: (r: any) => <div className="row">{!['RESOLVED', 'DISMISSED'].includes(r.status) && <button className="btn btn-sm" onClick={() => { setAct({ ...r, mode: 'note' }); setText(''); }}>Add note</button>}{can('incident.resolve') && !['RESOLVED', 'DISMISSED'].includes(r.status) && <button className="btn btn-sm btn-green" onClick={() => { setAct({ ...r, mode: 'resolve' }); setText(''); setTo('RESOLVED'); }}>Update</button>}</div> },
        ]} />}</Async>
      </Card>
      {act?.mode === 'note' && <Confirm title="Add note" yes="Add" onNo={() => setAct(null)} onYes={() => run(async () => { await post(`/incidents/${act.id}/notes`, { body: text }); setAct(null); st.reload(); }, 'Note added')} body={<Field label="Note"><textarea className="in" value={text} onChange={(e) => setText(e.target.value)} /></Field>} />}
      {act?.mode === 'resolve' && <Confirm title="Update incident" yes="Save" onNo={() => setAct(null)} onYes={() => run(async () => { await patch(`/incidents/${act.id}`, { status: to, resolution: text || undefined }); setAct(null); st.reload(); }, 'Incident updated')} body={<div className="stack"><Field label="New status"><select className="in" value={to} onChange={(e) => setTo(e.target.value)}><option>INVESTIGATING</option><option>RESOLVED</option><option>DISMISSED</option></select></Field><Field label="Resolution statement (required to close)"><textarea className="in" value={text} onChange={(e) => setText(e.target.value)} /></Field></div>} />}
    </>
  );
}
