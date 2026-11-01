'use client';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { post, put, useGet } from '@/api';
import { useMe } from '@/session';
import { Async, Badge, Card, Field, Modal, PageHead, Pager, Status, Table, useAction, Confirm, CancelButton } from '@/ui';

const blankOpts = () => ['A', 'B', 'C', 'D', 'E'].map((label, i) => ({ label, text: '', isCorrect: i === 0 }));
const DIFF: Record<string, string> = { EASY: 'green', MEDIUM: 'amber', HARD: 'red' };

function Editor({ q, courses, institutionId, onClose, onSaved }: { q?: any; courses: any[]; institutionId?: string; onClose: () => void; onSaved: () => void }) {
  const { run, busy } = useAction();
  const [f, setF] = useState(() => q ? { courseId: q.courseId, type: q.type, vignette: q.vignette ?? '', stem: q.stem, explanation: q.explanation ?? '', difficulty: q.difficulty, options: [...q.options].sort((a: any, b: any) => a.label.localeCompare(b.label)).map((o: any) => ({ label: o.label, text: o.text, isCorrect: o.isCorrect })) } : { courseId: courses[0]?.id ?? '', type: 'MCQ', vignette: '', stem: '', explanation: '', difficulty: 'MEDIUM', options: blankOpts() });
  const opts = f.options.filter((o: any) => o.text.trim());
  const set = (k: string, v: any) => setF((s: any) => ({ ...s, [k]: v }));
  const setOpt = (i: number, patch: any) => setF((s: any) => ({ ...s, options: s.options.map((o: any, j: number) => j === i ? { ...o, ...patch } : patch.isCorrect ? { ...o, isCorrect: false } : o) }));
  async function save() {
    const body = { courseId: f.courseId, institutionId: q?.institutionId ?? institutionId, type: f.type, vignette: f.type === 'CLINICAL_MCQ' ? f.vignette : undefined, stem: f.stem, explanation: f.explanation || undefined, difficulty: f.difficulty, options: opts.map((o: any, i: number) => ({ ...o, label: 'ABCDE'[i] })) };
    // the correct flag must survive re-labelling after blank options were dropped
    const ok = await run(async () => { if (q) await put(`/questions/${q.id}`, body); else await post('/questions', body); return true; }, 'Question saved as draft');
    if (ok) { onSaved(); onClose(); }
  }
  return (
    <Modal title={q ? 'Edit question' : 'New question'} onClose={onClose} missing={[f.stem.length < 10 && (f.type === 'CLINICAL_MCQ' ? 'Lead-in question (at least 10 characters)' : 'Question stem (at least 10 characters)'), opts.length < 4 && 'at least 4 option texts', !opts.some((o: any) => o.isCorrect) && 'the correct option'].filter(Boolean) as string[]} footer={<><CancelButton /><button className="btn btn-green" disabled={busy || opts.length < 4 || !opts.some((o: any) => o.isCorrect) || f.stem.length < 10} onClick={save}>Save draft</button></>}>
      <div className="stack">
        <div className="grid g2"><Field label="Course"><select className="in" value={f.courseId} onChange={(e) => set('courseId', e.target.value)}>{courses.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.title}</option>)}</select></Field>
          <Field label="Type"><select className="in" value={f.type} onChange={(e) => set('type', e.target.value)}><option value="MCQ">Single best answer MCQ</option><option value="CLINICAL_MCQ">Clinical MCQ (vignette)</option></select></Field></div>
        {f.type === 'CLINICAL_MCQ' && <Field label="Clinical vignette" hint="History, examination and investigations (min. 40 characters)."><textarea className="in" value={f.vignette} onChange={(e) => set('vignette', e.target.value)} rows={4} /></Field>}
        <Field label={f.type === 'CLINICAL_MCQ' ? 'Lead-in question' : 'Question stem'} required><textarea className="in" value={f.stem} onChange={(e) => set('stem', e.target.value)} rows={2} /></Field>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }} className="stack"><legend className="small muted" style={{ fontWeight: 600, marginBottom: 6 }}>Options — select the single correct answer (4 or 5 options) <span aria-hidden className="req">*</span></legend>
          {f.options.map((o: any, i: number) => <div className="row" key={o.label}><input type="radio" name="correct" aria-label={`Option ${o.label} is correct`} checked={o.isCorrect} onChange={() => setOpt(i, { isCorrect: true })} /><span className="mono" style={{ width: 16 }}>{o.label}</span><input className="in" value={o.text} onChange={(e) => setOpt(i, { text: e.target.value })} placeholder={i >= 4 ? 'Optional fifth option' : 'Option text'} aria-label={`Option ${o.label} text`} /></div>)}
        </fieldset>
        <div className="grid g2"><Field label="Difficulty"><select className="in" value={f.difficulty} onChange={(e) => set('difficulty', e.target.value)}><option>EASY</option><option>MEDIUM</option><option>HARD</option></select></Field></div>
        <Field label="Explanation (reviewers only)"><textarea className="in" value={f.explanation} onChange={(e) => set('explanation', e.target.value)} rows={2} /></Field>
      </div>
    </Modal>
  );
}

function Inner() {
  const { me, can } = useMe(); const sp = useSearchParams(); const { run } = useAction();
  const [status, setStatus] = useState(sp.get('status') ?? ''); const [courseId, setCourseId] = useState(''); const [search, setSearch] = useState(''); const [page, setPage] = useState(1);
  const [edit, setEdit] = useState<any | 'new' | null>(null); const [rej, setRej] = useState<any>(null); const [note, setNote] = useState(''); const [view, setView] = useState<any>(null);
  const programs = useGet<any[]>('/programs'); const mine = useGet<any[]>(me?.role === 'LECTURER' ? '/me/course-assignments' : null);
  // Lecturers work only on assigned courses; everyone else sees the full catalogue (server enforces either way).
  const courses = me?.role === 'LECTURER' ? (mine.data ?? []).map((a) => a.course) : (programs.data ?? []).flatMap((p) => p.courses);
  const assignedInst = me?.role === 'LECTURER' ? mine.data?.[0]?.institution?.id : undefined;
  const qs = `/questions?page=${page}&pageSize=25${status ? `&status=${status}` : ''}${courseId ? `&courseId=${courseId}` : ''}${search ? `&search=${encodeURIComponent(search)}` : ''}`;
  const list = useGet<any>(qs);
  const canWrite = can('question.write'); const canReview = can('question.approve');
  const open = async (id: string) => setView(await (await fetch(`/api/questions/${id}`)).json());
  return (
    <>
      <PageHead title="Question bank" sub={canReview ? 'Review submitted questions and curate the approved bank.' : 'Author questions; submit for examiner approval. Approved questions are available for papers.'}>
        {canWrite && <button className="btn btn-green" onClick={() => setEdit('new')}>+ New question</button>}
      </PageHead>
      <Card flush>
        <div className="filters">
          <Field label="Status"><select className="in" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">All statuses</option>{['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'RETIRED'].map((s) => <option key={s}>{s}</option>)}</select></Field>
          <Field label="Course"><select className="in" value={courseId} onChange={(e) => { setCourseId(e.target.value); setPage(1); }}><option value="">All courses</option>{courses.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}</select></Field>
          <Field label="Search"><input className="in" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search question text…" /></Field>
        </div>
        <Async state={list}>{(d) => <>
          <Table rowKey={(r: any) => r.id} empty="No questions match." rows={d.items} cols={[
            { h: 'Question', cell: (r: any) => <button className="btn-link" style={{ textAlign: 'left', textDecoration: 'none', color: 'var(--ink)', fontWeight: 500 }} onClick={() => open(r.id)}>{r.stem.length > 90 ? r.stem.slice(0, 90) + '…' : r.stem}</button> },
            { h: 'Course', cell: (r: any) => <span className="code">{r.course.code}</span> }, { h: 'Type', cell: (r: any) => <Badge tone="blue">{r.type === 'CLINICAL_MCQ' ? 'Clinical' : 'MCQ'}</Badge> },
            { h: 'Diff.', cell: (r: any) => <Badge tone={DIFF[r.difficulty]!}>{r.difficulty.toLowerCase()}</Badge> }, { h: 'Used', num: true, cell: (r: any) => r.usedCount }, { h: 'Key', cell: (r: any) => <b className="mono">{r.correct}</b> }, { h: 'Status', cell: (r: any) => <Status s={r.status} /> },
            { h: '', cell: (r: any) => <div className="row">
              {canWrite && ['DRAFT', 'REJECTED', 'APPROVED'].includes(r.status) && (me?.role !== 'LECTURER' || r.authorId === me.id) && <button className="btn btn-sm" onClick={async () => setEdit(await (await fetch(`/api/questions/${r.id}`)).json())}>Edit</button>}
              {canWrite && ['DRAFT', 'REJECTED'].includes(r.status) && (me?.role !== 'LECTURER' || r.authorId === me.id) && <button className="btn btn-sm btn-green" onClick={() => run(async () => { await post(`/questions/${r.id}/submit`); list.reload(); }, 'Submitted for review')}>Submit</button>}
              {canReview && r.status === 'SUBMITTED' && r.authorId !== me?.id && <><button className="btn btn-sm btn-green" onClick={() => run(async () => { await post(`/questions/${r.id}/review`, { decision: 'APPROVE' }); list.reload(); }, 'Approved')}>Approve</button><button className="btn btn-sm btn-danger" onClick={() => { setRej(r); setNote(''); }}>Reject</button></>}
            </div> },
          ]} />
          <Pager page={page} total={d.total} size={25} onPage={setPage} /></>}</Async>
      </Card>
      {edit && <Editor q={edit === 'new' ? undefined : edit} courses={courses} institutionId={assignedInst ?? me?.institutions[0]?.id} onClose={() => setEdit(null)} onSaved={list.reload} />}
      {rej && <Confirm title="Reject question" yes="Reject" danger onNo={() => setRej(null)} onYes={() => run(async () => { await post(`/questions/${rej.id}/review`, { decision: 'REJECT', note }); setRej(null); list.reload(); }, 'Rejected')} body={<Field label="Reason (sent to the author)"><textarea className="in" value={note} onChange={(e) => setNote(e.target.value)} /></Field>} />}
      {view && <Modal title="Question" onClose={() => setView(null)}>
        <div className="stack">{view.vignette && <div className="vignette">{view.vignette}</div>}<b>{view.stem}</b>
          {view.options.map((o: any) => <div key={o.label} className="row"><span className="mono" style={{ width: 16 }}>{o.label}</span><span>{o.text}</span>{o.isCorrect && <Badge tone="green">correct</Badge>}</div>)}
          {view.explanation && <div className="notice small"><b>Explanation:</b> {view.explanation}</div>}{view.reviewNote && <div className="notice warn small"><b>Reviewer note:</b> {view.reviewNote}</div>}</div></Modal>}
    </>
  );
}
export default function Questions() { return <Suspense><Inner /></Suspense>; }
