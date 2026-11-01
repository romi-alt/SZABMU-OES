'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { post, fmtDT, toLocalInput, useGet } from '@/api';
import { useMe } from '@/session';
import { useUrlState } from '@/url-state';
import type { ExamListItem, InstitutionRef, Paged, ProgramDto } from '@oes/shared';
import { Async, Card, Field, Modal, PageHead, Pager, Status, Table, useAction, CancelButton, ListEmpty } from '@/ui';

function Create({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { run, busy } = useAction(); const programs = useGet<ProgramDto[]>('/programs'); const insts = useGet<InstitutionRef[]>('/institutions');
  const courses = (programs.data ?? []).flatMap((p) => p.courses);
  const [f, setF] = useState({ code: '', title: '', courseId: '', term: '2026-SPRING', opensAt: toLocalInput(new Date(Date.now() + 86400000)), closesAt: toLocalInput(new Date(Date.now() + 2 * 86400000)), durationMin: 90, passPercent: 50, negativeMarking: 0, shuffleQuestions: true, instructions: '', institutionIds: [] as string[] });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const toggle = (id: string) => set('institutionIds', f.institutionIds.includes(id) ? f.institutionIds.filter((x) => x !== id) : [...f.institutionIds, id]);
  const ok = f.code && f.title && (f.courseId || courses[0]) && f.institutionIds.length;
  return (
    <Modal title="Schedule a new examination" onClose={onClose} missing={[!f.title && 'Exam title', !f.code && 'Code', !(f.courseId || courses[0]) && 'Course', !f.institutionIds.length && 'at least one participating institution'].filter(Boolean) as string[]} footer={<><CancelButton /><button className="btn btn-green" disabled={busy || !ok} onClick={() => run(async () => { await post('/exams', { ...f, courseId: f.courseId || courses[0]!.id, code: f.code.toUpperCase(), opensAt: new Date(f.opensAt).toISOString(), closesAt: new Date(f.closesAt).toISOString(), instructions: f.instructions || undefined }); onDone(); onClose(); }, 'Exam created as draft')}>Create draft</button></>}>
      <div className="stack">
        <div className="grid g2"><Field label="Exam title" required><input className="in" value={f.title} onChange={(e) => set('title', e.target.value)} /></Field><Field label="Code" required><input className="in mono" value={f.code} onChange={(e) => set('code', e.target.value.toUpperCase())} placeholder="MBBS-PATH-MT" /></Field></div>
        <div className="grid g2"><Field label="Course"><select className="in" value={f.courseId} onChange={(e) => set('courseId', e.target.value)}>{courses.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.title}</option>)}</select></Field><Field label="Term"><input className="in" value={f.term} onChange={(e) => set('term', e.target.value)} /></Field></div>
        <div className="grid g2"><Field label="Window opens"><input className="in" type="datetime-local" value={f.opensAt} onChange={(e) => set('opensAt', e.target.value)} /></Field><Field label="Window closes"><input className="in" type="datetime-local" value={f.closesAt} onChange={(e) => set('closesAt', e.target.value)} /></Field></div>
        <div className="grid g3"><Field label="Duration (min)"><input className="in" type="number" min={5} max={480} value={f.durationMin} onChange={(e) => set('durationMin', +e.target.value)} /></Field><Field label="Pass mark (%)"><input className="in" type="number" min={0} max={100} value={f.passPercent} onChange={(e) => set('passPercent', +e.target.value)} /></Field><Field label="Negative marking" hint="Fraction of marks lost per wrong answer (0–1)"><input className="in" type="number" step={0.25} min={0} max={1} value={f.negativeMarking} onChange={(e) => set('negativeMarking', +e.target.value)} /></Field></div>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}><legend className="small muted" style={{ fontWeight: 600, marginBottom: 6 }}>Participating institutions <span aria-hidden className="req">*</span><span className="sr-only"> (required, choose at least one)</span></legend><div className="row wrap">{(insts.data ?? []).map((i) => <label key={i.id} className={`chip${f.institutionIds.includes(i.id) ? ' on' : ''}`} style={{ cursor: 'pointer' }}><input type="checkbox" className="sr" style={{ position: 'absolute', opacity: 0 }} checked={f.institutionIds.includes(i.id)} onChange={() => toggle(i.id)} />{i.code}</label>)}</div></fieldset>
        <label className="row"><input type="checkbox" checked={f.shuffleQuestions} onChange={(e) => set('shuffleQuestions', e.target.checked)} /> Shuffle question order per candidate</label>
        <Field label="Candidate instructions"><textarea className="in" value={f.instructions} onChange={(e) => set('instructions', e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function Inner() {
  const { can } = useMe(); const sp = useSearchParams(); const url = useUrlState({ status: sp.get('status') ?? '', page: '1' }); const status = url.vals.status; const page = Number(url.vals.page) || 1; const setStatus = (v: string) => url.set('status', v); const setPage = (n: number) => url.set('page', String(n)); const [create, setCreate] = useState(false);
  const list = useGet<Paged<ExamListItem>>(`/exams?page=${page}&pageSize=25${status ? `&status=${status}` : ''}`);
  return (
    <>
      <PageHead title="Examinations" sub="Build papers, approve, schedule, monitor and publish.">{can('exam.schedule') && <button className="btn btn-green" onClick={() => setCreate(true)}>+ New examination</button>}</PageHead>
      <Card flush>
        <div className="filters"><Field label="Status"><select className="in" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">All</option>{['DRAFT', 'PAPER_PENDING', 'APPROVED', 'SCHEDULED', 'LIVE', 'CLOSED', 'RESULT_PENDING', 'PUBLISHED', 'CANCELLED'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</select></Field></div>
        <Async state={list}>{(d) => <><Table rowKey={(r) => r.id} empty={<ListEmpty noun="examinations" filters={[status && status.toLowerCase().replace(/_/g, ' ')].filter(Boolean) as string[]} onClear={url.reset} />} rows={d.items} cols={[
          { h: 'Code', cell: (r) => <Link className="code" href={`/exams/${r.id}`}>{r.code}</Link> }, { h: 'Title', cell: (r) => <b>{r.title}</b> }, { h: 'Course', cell: (r) => r.course.code },
          { h: 'Opens', cell: (r) => fmtDT(r.opensAt) }, { h: 'Min', num: true, cell: (r) => r.durationMin }, { h: 'Qs', num: true, cell: (r) => r._count.questions }, { h: 'Candidates', num: true, cell: (r) => r._count.candidates },
          { h: 'Status', cell: (r) => <Status s={r.status} /> }, { h: '', cell: (r) => <Link href={`/exams/${r.id}`}>Open ›</Link> },
        ]} /><Pager page={page} total={d.total} size={25} onPage={setPage} /></>}</Async>
      </Card>
      {create && <Create onClose={() => setCreate(false)} onDone={list.reload} />}
    </>
  );
}
export default function Exams() { return <Suspense><Inner /></Suspense>; }
