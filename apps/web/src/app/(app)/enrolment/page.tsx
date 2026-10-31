'use client';
import { useState } from 'react';
import { patch, post, useGet } from '@/api';
import { useMe } from '@/session';
import { Async, Card, Confirm, Field, Notice, PageHead, Status, Table, useAction } from '@/ui';

export default function Enrolment() {
  const { me, can } = useMe(); const { run } = useAction(); const programs = useGet<any[]>('/programs'); const insts = useGet<any[]>('/institutions');
  const [courseId, setCourseId] = useState(''); const [term, setTerm] = useState('2026-SPRING'); const [inst, setInst] = useState(''); const [att, setAtt] = useState<Record<string, string>>({}); const [cond, setCond] = useState<any>(null); const [note, setNote] = useState('');
  const courses = (programs.data ?? []).flatMap((p) => p.courses); const cid = courseId || courses[0]?.id; const iid = inst || me?.institutions[0]?.id || insts.data?.[0]?.id;
  const st = useGet<any[]>(cid && iid ? `/enrollments?courseId=${cid}&term=${term}&institutionId=${iid}` : null);
  return (
    <>
      <PageHead title="Enrolment & eligibility" sub="Record attendance. Candidates below 75% are excluded from the roster unless the Controller condones." />
      <Card flush>
        <div className="filters"><Field label="Course"><select className="in" value={cid ?? ''} onChange={(e) => setCourseId(e.target.value)}>{courses.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.title}</option>)}</select></Field><Field label="Term"><input className="in" value={term} onChange={(e) => setTerm(e.target.value)} /></Field>
          {(insts.data?.length ?? 0) > 1 && <Field label="Institution"><select className="in" value={iid ?? ''} onChange={(e) => setInst(e.target.value)}>{insts.data!.map((i) => <option key={i.id} value={i.id}>{i.code}</option>)}</select></Field>}
          {can('enrollment.manage') && <button className="btn btn-green" onClick={() => run(async () => { const r = await post('/enrollments/bulk', { courseId: cid, term, institutionId: iid }); st.reload(); return r; }, 'Cohort enrolled')}>Enrol whole cohort</button>}</div>
        <Async state={st}>{(rows: any[]) => <Table rowKey={(r: any) => r.id} rows={rows} empty="No enrolments for this course and term. Use “Enrol whole cohort”." cols={[
          { h: 'Reg. no.', cell: (r: any) => <span className="code">{r.student.regNo}</span> }, { h: 'Name', cell: (r: any) => r.student.user.fullName },
          { h: 'Attendance %', num: true, cell: (r: any) => can('enrollment.manage') ? <span className="row" style={{ justifyContent: 'flex-end' }}><input className="in mono" style={{ width: 72 }} type="number" min={0} max={100} value={att[r.id] ?? r.attendancePct ?? ''} onChange={(e) => setAtt({ ...att, [r.id]: e.target.value })} aria-label={`Attendance for ${r.student.regNo}`} /><button className="btn btn-sm" disabled={att[r.id] === undefined} onClick={() => run(async () => { await patch(`/enrollments/${r.id}/attendance`, { attendancePct: +att[r.id]! }); setAtt((a) => { const { [r.id]: _x, ...rest } = a; return rest; }); st.reload(); }, 'Recorded')}>Save</button></span> : r.attendancePct ?? '—' },
          { h: 'Eligibility', cell: (r: any) => <Status s={r.eligibility} /> }, { h: '', cell: (r: any) => can('eligibility.override') && r.eligibility === 'INELIGIBLE' ? <button className="btn btn-sm" onClick={() => { setCond(r); setNote(''); }}>Condone…</button> : null },
        ]} />}</Async>
      </Card>
      {cond && <Confirm title={`Condone ${cond.student.regNo}`} yes="Condone" onNo={() => setCond(null)} onYes={() => run(async () => { await post(`/enrollments/${cond.id}/condone`, { note }); setCond(null); st.reload(); }, 'Condoned')} body={<div className="stack"><Notice tone="warn">Condonation allows the candidate to sit despite insufficient attendance. It is recorded against your name.</Notice><Field label="Justification (min. 5 characters)"><textarea className="in" value={note} onChange={(e) => setNote(e.target.value)} /></Field></div>} />}
    </>
  );
}
