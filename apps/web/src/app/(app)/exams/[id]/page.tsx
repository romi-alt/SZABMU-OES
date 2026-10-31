'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { post, put, patch, fmtDT, useGet } from '@/api';
import { useMe } from '@/session';
import { Async, Badge, Card, Confirm, Field, Modal, Notice, PageHead, Stat, Status, Table, useAction } from '@/ui';

function PaperBuilder({ exam, reload }: { exam: any; reload: () => void }) {
  const { run, busy } = useAction(); const cur = useGet<any[]>(`/exams/${exam.id}/paper`); const bank = useGet<any>(`/questions?status=APPROVED&courseId=${exam.courseId}&pageSize=200`);
  const [sel, setSel] = useState<Record<string, number> | null>(null);
  const chosen: Record<string, number> = sel ?? Object.fromEntries((cur.data ?? []).map((q) => [q.questionId, q.marks as number]));
  const total = (Object.values(chosen) as number[]).reduce((a, b) => a + b, 0);
  const toggle = (id: string) => setSel((s) => { const c = { ...(s ?? chosen) }; if (id in c) delete c[id]; else c[id] = 1; return c; });
  return (
    <Card title={`Question paper (${Object.keys(chosen).length} questions · ${total} marks)`} actions={<>
      <button className="btn btn-sm" disabled={busy || !Object.keys(chosen).length} onClick={() => run(async () => { await put(`/exams/${exam.id}/paper`, { items: Object.entries(chosen).map(([questionId, marks]) => ({ questionId, marks })) }); setSel(null); cur.reload(); reload(); }, 'Paper saved')}>Save paper</button>
      <button className="btn btn-sm btn-green" disabled={busy || !cur.data?.length || sel !== null} onClick={() => run(async () => { await post(`/exams/${exam.id}/paper/submit`); reload(); }, 'Submitted for approval')}>Submit for approval</button></>}>
      {exam.paperReviewNote && <Notice tone="warn"><b>Returned:</b> {exam.paperReviewNote}</Notice>}
      <Async state={bank}>{(d) => <Table rowKey={(r: any) => r.id} empty="No approved questions exist for this course yet." rows={d.items} cols={[
        { h: '', cell: (r: any) => <input type="checkbox" aria-label="Include on paper" checked={r.id in chosen} onChange={() => toggle(r.id)} /> },
        { h: 'Question', cell: (r: any) => r.stem }, { h: 'Type', cell: (r: any) => r.type === 'CLINICAL_MCQ' ? 'Clinical' : 'MCQ' }, { h: 'Diff.', cell: (r: any) => r.difficulty.toLowerCase() },
        { h: 'Marks', num: true, cell: (r: any) => r.id in chosen ? <input className="in mono" style={{ width: 70 }} type="number" min={0.5} step={0.5} value={chosen[r.id]} onChange={(e) => setSel((s) => ({ ...(s ?? chosen), [r.id]: Math.max(0.5, +e.target.value) }))} aria-label="Marks" /> : null },
      ]} />}</Async>
    </Card>
  );
}

function PaperReview({ exam, reload }: { exam: any; reload: () => void }) {
  const { run, busy } = useAction(); const paper = useGet<any[]>(`/exams/${exam.id}/paper`); const [note, setNote] = useState(''); const [rej, setRej] = useState(false);
  return (
    <Card title="Paper awaiting approval" actions={<><button className="btn btn-sm btn-danger" onClick={() => setRej(true)}>Return to author</button><button className="btn btn-sm btn-green" disabled={busy} onClick={() => run(async () => { await post(`/exams/${exam.id}/paper/review`, { decision: 'APPROVE' }); reload(); }, 'Paper approved and frozen')}>Approve paper</button></>}>
      <Notice>Approval freezes each question and the answer key onto this paper. You cannot approve a paper you submitted.</Notice>
      <Async state={paper}>{(rows: any[]) => <div className="stack" style={{ marginTop: 12 }}>{rows.map((r) => <div key={r.id} className="card" style={{ padding: 12 }}><div className="small muted mono">Q{r.position} · {r.marks} mark(s)</div>{r.question.vignette && <div className="vignette small" style={{ margin: '6px 0' }}>{r.question.vignette}</div>}<b>{r.question.stem}</b>{r.question.options.map((o: any) => <div key={o.label} className="small row"><span className="mono" style={{ width: 14 }}>{o.label}</span>{o.text}{o.isCorrect && <Badge tone="green">key</Badge>}</div>)}</div>)}</div>}</Async>
      {rej && <Confirm title="Return paper" yes="Return" danger onNo={() => setRej(false)} onYes={() => run(async () => { await post(`/exams/${exam.id}/paper/review`, { decision: 'REJECT', note }); setRej(false); reload(); }, 'Returned')} body={<Field label="Reason"><textarea className="in" value={note} onChange={(e) => setNote(e.target.value)} /></Field>} />}
    </Card>
  );
}

function OverrideDialog({ exam, row, onClose, done }: { exam: any; row: any; onClose: () => void; done: () => void }) {
  const { run, busy } = useAction(); const [reason, setReason] = useState(''); const [force, setForce] = useState(false);
  const decision = row.admission === 'REVOKED' ? 'GRANT' : 'REVOKE'; const live = row.attempt === 'IN_PROGRESS';
  return (
    <Modal title={`${decision === 'GRANT' ? 'Admit' : 'Withdraw admission of'} ${row.regNo}`} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn btn-primary" disabled={busy || reason.trim().length < 10 || (live && decision === 'REVOKE' && !force)} onClick={() => run(async () => { await post(`/exams/${exam.id}/candidates/${row.studentId}/override`, { decision, reason: reason.trim(), forceSubmit: force || undefined }); done(); onClose(); }, 'Eligibility decision recorded')}>Record decision</button></>}>
      <div className="stack">
        <Notice tone="warn">This manual decision is permanent in the audit record: your name, the time, the old and new decision and your reason are stored and cannot be edited.</Notice>
        <Field label="Reason (at least 10 characters)"><textarea className="in" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} /></Field>
        {live && decision === 'REVOKE' && <label className="row"><input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} /> This candidate is sitting now. Seal their attempt immediately (answers saved so far are kept).</label>}
      </div>
    </Modal>
  );
}

function Roster({ exam, canAccommodate, canOverride }: { exam: any; canAccommodate: boolean; canOverride: boolean }) {
  const { run } = useAction(); const [ov, setOv] = useState<any>(null); const roster = useGet<any[]>(`/exams/${exam.id}/roster`); const [extra, setExtra] = useState<Record<string, string>>({});
  return (
    <Card title={`Roster${roster.data ? ` (${roster.data.length})` : ''}`} flush><Async state={roster}>{(rows: any[]) => <Table rowKey={(r: any) => r.studentId} empty="No candidates on the roster." rows={rows} cols={[
      { h: 'Reg. no.', cell: (r: any) => <span className="code">{r.regNo}</span> }, { h: 'Name', cell: (r: any) => r.fullName }, { h: 'Campus', cell: (r: any) => r.institution },
      { h: 'Extra time', num: true, cell: (r: any) => canAccommodate && !r.attempt && ['SCHEDULED', 'LIVE'].includes(exam.status) ? <span className="row" style={{ justifyContent: 'flex-end' }}><input className="in mono" style={{ width: 64 }} type="number" min={0} max={120} value={extra[r.studentId] ?? r.extraTimeMin} onChange={(e) => setExtra({ ...extra, [r.studentId]: e.target.value })} aria-label={`Extra minutes for ${r.regNo}`} /><button className="btn btn-sm" onClick={() => run(async () => { await patch(`/exams/${exam.id}/candidates/${r.studentId}`, { extraTimeMin: +(extra[r.studentId] ?? 0) }); roster.reload(); }, 'Accommodation saved')}>Set</button></span> : `${r.extraTimeMin} min` },
      { h: 'Admission', cell: (r: any) => <span title={r.statusReason ?? ''}><Badge tone={r.admission === 'REVOKED' ? 'bad' : 'green'}>{r.admission === 'REVOKED' ? 'Revoked' : 'Admitted'}</Badge>{r.decisionSource === 'OVERRIDE' && <span className="small faint"> manual</span>}</span> },
      { h: 'Attempt', cell: (r: any) => r.attempt ? <Status s={r.attempt} /> : <span className="faint">—</span> },
      ...(canOverride && ['SCHEDULED', 'LIVE'].includes(exam.status) ? [{ h: '', cell: (r: any) => !r.attempt || r.attempt === 'IN_PROGRESS' ? <button className="btn btn-sm" onClick={() => setOv(r)}>{r.admission === 'REVOKED' ? 'Admit…' : 'Withdraw…'}</button> : null }] : []),
    ]} />}</Async>{ov && <OverrideDialog exam={exam} row={ov} onClose={() => setOv(null)} done={roster.reload} />}</Card>
  );
}

function Invigilators({ exam }: { exam: any }) {
  const { run } = useAction(); const [inst, setInst] = useState(exam.institutions[0]?.institutionId ?? ''); const [user, setUser] = useState('');
  const users = useGet<any>(`/users?role=INVIGILATOR&institutionId=${inst}&pageSize=100`);
  return <Card title="Assign invigilators"><div className="row wrap" style={{ alignItems: 'flex-end' }}>
    <Field label="Institution"><select className="in" value={inst} onChange={(e) => setInst(e.target.value)}>{exam.institutions.map((i: any) => <option key={i.institutionId} value={i.institutionId}>{i.institution.code}</option>)}</select></Field>
    <Field label="Invigilator"><select className="in" value={user} onChange={(e) => setUser(e.target.value)}><option value="">Select…</option>{(users.data?.items ?? []).map((u: any) => <option key={u.id} value={u.id}>{u.fullName}</option>)}</select></Field>
    <button className="btn btn-green" disabled={!user} onClick={() => run(async () => { await post(`/exams/${exam.id}/invigilators`, { userId: user, institutionId: inst }); }, 'Invigilator assigned')}>Assign</button></div></Card>;
}

function Results({ exam, reload }: { exam: any; reload: () => void }) {
  const { me, can } = useMe(); const { run, busy } = useAction(); const res = useGet<any>(`/results/exams/${exam.id}`); const ana = useGet<any>(can('grading.review') ? `/grading/exams/${exam.id}/analysis` : null);
  const [key, setKey] = useState<any>(null); const [reason, setReason] = useState(''); const [newLabel, setNewLabel] = useState('A'); const [kind, setKind] = useState<'VOID' | 'CHANGE_KEY'>('VOID');
  const refresh = () => { res.reload(); ana.reload(); reload(); };
  return (
    <div className="stack-lg">
      <Async state={res}>{(d) => (<>
        <div className="grid g4"><Stat k="Candidates" v={d.summary.candidates} s={`${d.summary.absent} absent`} /><Stat k="Sat" v={d.summary.sat} /><Stat k="Mean" v={`${d.summary.mean}%`} s={`Median ${d.summary.median}%`} /><Stat k="Pass rate" v={`${d.summary.passRate}%`} s={`${d.summary.passed} passed`} /></div>
        <Card title={<>Results workflow <Status s={d.batch?.status ?? 'GRADED'} /></>} actions={<>
          {can('grading.review') && d.batch?.status === 'GRADED' && exam.status === 'RESULT_PENDING' && <button className="btn btn-sm btn-green" disabled={busy} onClick={() => run(async () => { await post(`/grading/exams/${exam.id}/review`, { note: 'Item analysis reviewed' }); refresh(); }, 'Marked as reviewed')}>Complete lecturer review</button>}
          {can('result.approve_examiner') && d.batch?.status === 'LECTURER_REVIEWED' && <button className="btn btn-sm btn-green" disabled={busy} onClick={() => run(async () => { await post(`/results/exams/${exam.id}/approve`); refresh(); }, 'Approved for publication')}>Examiner approval</button>}
          {can('result.publish') && d.batch?.status === 'EXAMINER_APPROVED' && <button className="btn btn-sm btn-primary" disabled={busy || d.batch?.examinerApprovedBy === me?.id} onClick={() => run(async () => { await post(`/results/exams/${exam.id}/publish`); refresh(); }, 'Results published')}>Publish results</button>}
          {can('report.read') && <a className="btn btn-sm" href={`/api/reports/exams/${exam.id}/csv`}>Export CSV</a>}</>}>
          <p className="muted small" style={{ margin: 0 }}>Graded → lecturer review → examiner approval → publication by the Controller (a different person from the approver). Open incidents block approval.</p>
        </Card>
        <Card title="Candidate results" flush><Table rowKey={(r: any) => r.id} empty="No results are visible to you yet." rows={d.rows} cols={[
          { h: 'Reg. no.', cell: (r: any) => <span className="code">{r.regNo}</span> }, { h: 'Name', cell: (r: any) => r.fullName }, { h: 'Campus', cell: (r: any) => r.institution }, { h: 'Score', num: true, cell: (r: any) => `${r.rawScore} / ${r.totalMarks}` }, { h: '%', num: true, cell: (r: any) => r.percent.toFixed(1) }, { h: 'Result', cell: (r: any) => <Status s={r.status} /> }, { h: 'Certificate', cell: (r: any) => <span className="code">{r.certificate ?? '—'}</span> },
        ]} /></Card></>)}</Async>
      {ana.data && <Card title="Item analysis" flush><Table rowKey={(r: any) => r.examQuestionId} rows={ana.data.questions} cols={[
        { h: '#', num: true, cell: (r: any) => r.position }, { h: 'Question', cell: (r: any) => (r.stem.length > 80 ? r.stem.slice(0, 80) + '…' : r.stem) }, { h: 'Key', cell: (r: any) => <b className="mono">{r.key}</b> },
        { h: 'Answers', cell: (r: any) => <span className="mono small">{Object.entries(r.distribution).map(([k, v]) => `${k}:${v}`).join('  ')}</span> }, { h: '% correct', num: true, cell: (r: any) => r.pCorrect },
        { h: 'Flag', cell: (r: any) => r.actions.length ? <Badge tone="amber">{r.actions.map((a: any) => a.kind === 'VOID' ? 'voided' : `key→${a.newLabel}`).join(', ')}</Badge> : r.flag ? <Badge tone="red">{r.flag.replace(/_/g, ' ').toLowerCase()}</Badge> : null },
        { h: '', cell: (r: any) => can('grading.keyaction') && ['RESULT_PENDING'].includes(exam.status) && res.data?.batch?.status !== 'EXAMINER_APPROVED' ? <button className="btn btn-sm" onClick={() => { setKey(r); setReason(''); }}>Correct…</button> : null },
      ]} /></Card>}
      {key && <Confirm title={`Correct question ${key.position}`} yes="Apply and regrade" danger onNo={() => setKey(null)} onYes={() => run(async () => { await post(`/grading/exams/${exam.id}/key-actions`, { examQuestionId: key.examQuestionId, kind, newLabel: kind === 'CHANGE_KEY' ? newLabel : undefined, reason }); setKey(null); refresh(); }, 'Regraded')} body={<div className="stack">
        <Notice tone="warn">This regrades every candidate and returns results to lecturer review.</Notice>
        <Field label="Action"><select className="in" value={kind} onChange={(e) => setKind(e.target.value as never)}><option value="VOID">Void question (full marks to all)</option><option value="CHANGE_KEY">Change answer key</option></select></Field>
        {kind === 'CHANGE_KEY' && <Field label="New correct option"><select className="in" value={newLabel} onChange={(e) => setNewLabel(e.target.value)}>{['A', 'B', 'C', 'D', 'E'].filter((l) => l !== key.key).map((l) => <option key={l}>{l}</option>)}</select></Field>}
        <Field label="Reason (min. 10 characters, audited)"><textarea className="in" value={reason} onChange={(e) => setReason(e.target.value)} /></Field></div>} />}
    </div>
  );
}

export default function ExamDetail() {
  const { id } = useParams<{ id: string }>(); const { can } = useMe(); const { run, busy } = useAction(); const st = useGet<any>(`/exams/${id}`); const [cancel, setCancel] = useState(false); const [why, setWhy] = useState('');
  return (
    <Async state={st}>{(e) => (
      <>
        <PageHead title={e.title} sub={<><span className="mono">{e.code}</span> · {e.course.code} {e.course.title} · {e.durationMin} min · {e.totalMarks} marks · pass {e.passPercent}%</>}>
          <Status s={e.status} />
          {['LIVE', 'SCHEDULED'].includes(e.status) && can('invigilation.monitor') && <Link className="btn" href={`/monitor/${e.id}`}>Live monitor</Link>}
          {can('exam.schedule') && e.status === 'APPROVED' && <button className="btn btn-green" disabled={busy} onClick={() => run(async () => { const r = await post(`/exams/${e.id}/schedule`); st.reload(); return r; }, 'Scheduled; roster built from eligible enrolments')}>Schedule &amp; build roster</button>}
          {can('exam.schedule') && ['DRAFT', 'PAPER_PENDING', 'APPROVED', 'SCHEDULED'].includes(e.status) && <button className="btn btn-danger" onClick={() => setCancel(true)}>Cancel exam</button>}
        </PageHead>
        <div className="stack-lg">
          <Card title="Details"><div className="grid g4 small"><div><div className="faint">Opens</div>{fmtDT(e.opensAt)}</div><div><div className="faint">Closes</div>{fmtDT(e.closesAt)}</div><div><div className="faint">Term</div>{e.term}</div><div><div className="faint">Institutions</div>{e.institutions.map((i: any) => i.institution.code).join(', ')}</div></div></Card>
          {e.status === 'DRAFT' && can('paper.build') && <PaperBuilder exam={e} reload={st.reload} />}
          {e.status === 'PAPER_PENDING' && can('paper.approve') && <PaperReview exam={e} reload={st.reload} />}
          {['APPROVED', 'SCHEDULED', 'LIVE', 'CLOSED', 'RESULT_PENDING', 'PUBLISHED'].includes(e.status) && can('question.read') && <Card title="Approved paper (frozen)"><span className="muted small">{e._count.questions} questions · {e.totalMarks} marks. Content is immutable after approval.</span></Card>}
          {['SCHEDULED', 'LIVE', 'CLOSED', 'RESULT_PENDING', 'PUBLISHED'].includes(e.status) && <Roster exam={e} canAccommodate={can('enrollment.manage')} canOverride={can('eligibility.override')} />}
          {['SCHEDULED', 'LIVE'].includes(e.status) && can('invigilator.assign') && can('user.manage') && <Invigilators exam={e} />}
          {['CLOSED', 'RESULT_PENDING', 'PUBLISHED'].includes(e.status) && can('result.read_scoped') && <Results exam={e} reload={st.reload} />}
        </div>
        {cancel && <Confirm title="Cancel examination" yes="Cancel exam" danger onNo={() => setCancel(false)} onYes={() => run(async () => { await post(`/exams/${e.id}/cancel`, { reason: why }); setCancel(false); st.reload(); }, 'Cancelled')} body={<Field label="Reason (audited)"><textarea className="in" value={why} onChange={(e2) => setWhy(e2.target.value)} /></Field>} />}
      </>)}</Async>
  );
}
