'use client';
import { useEffect, useState } from 'react';
import { patch, post, useGet } from '@/api';
import { useMe } from '@/session';
import { useUrlState } from '@/url-state';
import { Async, Card, Confirm, Empty, ErrorBox, Field, Loading, Notice, PageHead, Status, Table, useAction } from '@/ui';

export default function Enrolment() {
  const { me, can } = useMe(); const { run } = useAction(); const programs = useGet<any[]>('/programs'); const insts = useGet<any[]>('/institutions');
  const url = useUrlState({ course: '', term: '2026-SPRING', inst: '' }); const courseId = url.vals.course; const term = url.vals.term; const inst = url.vals.inst; const setCourseId = (v: string) => url.set('course', v); const setTerm = (v: string) => url.set('term', v); const setInst = (v: string) => url.set('inst', v); const [att, setAtt] = useState<Record<string, string>>({}); const [cond, setCond] = useState<any>(null); const [note, setNote] = useState('');
  const courses: any[] = Array.isArray(programs.data) ? programs.data.flatMap((p) => (Array.isArray(p.courses) ? p.courses : [])) : [];
  const instList: any[] = Array.isArray(insts.data) ? insts.data : []; const cid = courseId || courses[0]?.id; const iid = inst || me?.institutions[0]?.id || instList[0]?.id;
  const st = useGet<any[]>(cid && iid ? `/enrollments?courseId=${cid}&term=${encodeURIComponent(term)}&institutionId=${iid}` : null);
  // Terms already used by this course (exams, enrolments): choose one instead of typing it — a typo would silently create an unrelated term (audit A-11).
  const terms = useGet<{ term: string; exams: number; enrolled: number }[]>(cid ? `/courses/${cid}/terms` : null);
  const known = terms.data?.find((t) => t.term === term); const [other, setOther] = useState(false);
  useEffect(() => { if (!other && terms.data?.length && !terms.data.some((t) => t.term === term)) setTerm(terms.data.find((t) => t.exams > 0)?.term ?? terms.data[0]!.term); }, [terms.data, term, other]);
  return (
    <>
      <PageHead title="Enrolment & eligibility" sub="Record attendance. Candidates below 75% are excluded from the roster unless the Controller condones." />
      <Card flush>
        <div className="filters"><Field label="Course"><select className="in" value={cid ?? ''} onChange={(e) => setCourseId(e.target.value)}>{courses.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.title}</option>)}</select></Field><Field label="Term"><select className="in" value={other ? '__other' : term} onChange={(e) => { if (e.target.value === '__other') setOther(true); else { setOther(false); setTerm(e.target.value); } }}>
            {(terms.data ?? []).map((t) => <option key={t.term} value={t.term}>{t.term} — {t.exams} exam{t.exams === 1 ? '' : 's'}, {t.enrolled} enrolled</option>)}
            {!terms.data?.some((t) => t.term === term) && !other && <option value={term}>{term}</option>}
            <option value="__other">Another term…</option></select></Field>
          {other && <Field label="New term" hint="Format YEAR-SESSION, e.g. 2027-SPRING"><input className="in" value={term} onChange={(e) => setTerm(e.target.value.toUpperCase().replace(/\s+/g, ''))} /></Field>}
          {instList.length > 1 && <Field label="Institution"><select className="in" value={iid ?? ''} onChange={(e) => setInst(e.target.value)}>{instList.map((i) => <option key={i.id} value={i.id}>{i.code}</option>)}</select></Field>}
          {can('enrollment.manage') && <button className="btn btn-green" onClick={() => run(async () => { const r = await post('/enrollments/bulk', { courseId: cid, term, institutionId: iid }); st.reload(); return r; }, 'Cohort enrolled')}>Enrol whole cohort</button>}</div>
        {cid && terms.data && (!known || known.exams === 0) && <div className="card-b"><Notice tone="warn">No examination of this course uses the term “{term}” yet. Check the spelling: students enrolled under a different term will not be placed on an examination roster.</Notice></div>}
        {programs.error ? <div className="card-b"><ErrorBox error={programs.error} onRetry={programs.reload} /></div>
          : programs.loading ? <div className="card-b"><Loading /></div>
          : !courses.length ? <Empty>No courses are available for enrolment yet. Courses appear here once a programme has been set up.</Empty>
          : !iid ? <Empty>No institution is assigned to your account, so there is no cohort to show.</Empty>
          : <Async state={st} idle={<Empty>Choose a course and term to see the cohort.</Empty>}>{(rows: any[]) => <Table rowKey={(r: any) => r.id} rows={rows} empty="No enrolments for this course and term. Use “Enrol whole cohort”." cols={[
          { h: 'Reg. no.', cell: (r: any) => <span className="code">{r.student.regNo}</span> }, { h: 'Name', cell: (r: any) => r.student.user.fullName },
          { h: 'Attendance %', num: true, cell: (r: any) => can('enrollment.manage') ? <span className="row" style={{ justifyContent: 'flex-end' }}><input className="in mono" style={{ width: 72 }} type="number" min={0} max={100} value={att[r.id] ?? r.attendancePct ?? ''} onChange={(e) => setAtt({ ...att, [r.id]: e.target.value })} aria-label={`Attendance for ${r.student.regNo}`} /><button className="btn btn-sm" disabled={att[r.id] === undefined} onClick={() => run(async () => { await patch(`/enrollments/${r.id}/attendance`, { attendancePct: +att[r.id]! }); setAtt((a) => { const { [r.id]: _x, ...rest } = a; return rest; }); st.reload(); }, 'Recorded')}>Save</button></span> : r.attendancePct ?? '—' },
          { h: 'Eligibility', cell: (r: any) => <Status s={r.eligibility} /> }, { h: '', cell: (r: any) => can('eligibility.override') && r.eligibility === 'INELIGIBLE' ? <button className="btn btn-sm" onClick={() => { setCond(r); setNote(''); }}>Condone…</button> : null },
        ]} />}</Async>}
      </Card>
      {cond && <Confirm title={`Condone ${cond.student.regNo}`} yes="Condone" onNo={() => setCond(null)} onYes={() => run(async () => { await post(`/enrollments/${cond.id}/condone`, { note }); setCond(null); st.reload(); }, 'Condoned')} body={<div className="stack"><Notice tone="warn">Condonation allows the candidate to sit despite insufficient attendance. It is recorded against your name.</Notice><Field label="Justification (min. 5 characters)"><textarea className="in" value={note} onChange={(e) => setNote(e.target.value)} /></Field></div>} />}
    </>
  );
}
