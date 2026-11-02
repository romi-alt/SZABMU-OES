'use client';
import { useState } from 'react';
import { del, get, post, put, useGet } from '@/api';
import { mcqRowsFromCsv, MCQ_TEMPLATE } from '@/csv';
import { useUrlState } from '@/url-state';
import { Async, Badge, CancelButton, Confirm, Field, Modal, Notice, PageHead, Pager, Status, Table, useAction, useToast } from '@/ui';

const DIFF = ['EASY', 'MEDIUM', 'HARD'] as const; const cap = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();
const download = (name: string, text: string, type = 'text/csv;charset=utf-8') => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); };
interface Draft { id?: string; stem: string; options: string[]; correctIndex: number; explanation: string; difficulty: 'EASY' | 'MEDIUM' | 'HARD'; topic: string; marks: string }
const blank = (): Draft => ({ stem: '', options: ['', '', '', ''], correctIndex: -1, explanation: '', difficulty: 'MEDIUM', topic: '', marks: '1' });

export default function Pools() {
  const url = useUrlState({ pool: '' }); const poolId = url.vals.pool;
  return poolId ? <PoolDetail poolId={poolId} onBack={() => url.set('pool', '')} /> : <PoolList onOpen={(id) => url.set('pool', id)} />;
}

function PoolList({ onOpen }: { onOpen: (id: string) => void }) {
  const st = useGet<any[]>('/teacher/pools'); const as = useGet<any[]>('/teacher/assignments'); const { run, busy } = useAction(); const toast = useToast();
  const [add, setAdd] = useState(false); const [f, setF] = useState({ assignmentId: '', name: '', description: '' }); const [rm, setRm] = useState<any | null>(null);
  const approved = (as.data ?? []).filter((a) => a.status === 'APPROVED');
  return (
    <>
      <PageHead title="MCQ Pool" sub="Question pools for your approved subjects. Submit a pool and the examiners review its questions.">
        <button className="btn btn-green" disabled={!approved.length} onClick={() => { setF({ assignmentId: approved[0]?.id ?? '', name: '', description: '' }); setAdd(true); }}>+ New pool</button>
      </PageHead>
      <Async state={st}>{(rows) => rows.length ? (
        <div data-testid="pool-list"><Table rowKey={(p: any) => p.id} rows={rows} cols={[
          { h: 'Pool', cell: (p: any) => <><button className="btn-link" onClick={() => onOpen(p.id)}><b>{p.name}</b></button>{p.description && <div className="small faint">{p.description}</div>}</> },
          { h: 'Subject', cell: (p: any) => <>{p.course?.title}<div className="small faint">{p.course?.code}</div></> }, { h: 'Session', cell: (p: any) => p.term },
          { h: 'Questions', num: true, cell: (p: any) => p.counts.total }, { h: 'Review', cell: (p: any) => <span className="small">{p.counts.draft} draft · {p.counts.submitted} submitted · {p.counts.approved} approved</span> },
          { h: '', cls: 'row-actions', cell: (p: any) => <><button className="btn btn-sm" onClick={() => onOpen(p.id)}>Open</button><button className="btn btn-sm" onClick={() => setRm(p)}>Delete</button></> },
        ]} /></div>
      ) : <p className="muted" data-testid="pool-empty">{approved.length ? 'No question pools yet. Create one to start adding MCQs.' : 'You need an approved class and subject before you can create a pool.'}</p>}</Async>
      {add && <Modal title="New question pool" onClose={() => setAdd(false)} missing={[!f.assignmentId && 'Class and subject', f.name.trim().length < 2 && 'Pool name'].filter(Boolean) as string[]}
        footer={<><CancelButton /><button className="btn btn-green" disabled={busy || !f.assignmentId || f.name.trim().length < 2} onClick={() => run(async () => { const r: any = await post('/teacher/pools', { assignmentId: f.assignmentId, name: f.name, description: f.description || undefined }); setAdd(false); toast('Pool created'); onOpen(r.id); })}>Create pool</button></>}>
        <div className="stack">
          <Field label="Class and subject" required><select className="in" value={f.assignmentId} onChange={(e) => setF({ ...f, assignmentId: e.target.value })}>{approved.map((a) => <option key={a.id} value={a.id}>{a.course.code} — {a.course.title} · {a.institution.code} · {a.term}</option>)}</select></Field>
          <Field label="Pool name" required><input className="in" value={f.name} maxLength={120} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Endocrine pathology — week 3" /></Field>
          <Field label="Description"><input className="in" value={f.description} maxLength={500} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        </div></Modal>}
      {rm && <Confirm title={`Delete “${rm.name}”?`} body={<>Draft questions in this pool are retired with it. A pool with submitted or approved questions cannot be deleted.</>} yes="Delete pool" danger onNo={() => setRm(null)} onYes={() => run(async () => { await del(`/teacher/pools/${rm.id}`); setRm(null); toast('Pool deleted'); st.reload(); })} />}
    </>
  );
}

function PoolDetail({ poolId, onBack }: { poolId: string; onBack: () => void }) {
  const url = useUrlState({ page: '1', search: '', difficulty: '', topic: '', status: '' }); const { page: pg, search, difficulty, topic, status } = url.vals; const page = Number(pg) || 1;
  const pools = useGet<any[]>('/teacher/pools');
  const qs = useGet<any>(`/teacher/questions?poolId=${poolId}&page=${page}&pageSize=20${search ? `&search=${encodeURIComponent(search)}` : ''}${difficulty ? `&difficulty=${difficulty}` : ''}${topic ? `&topic=${encodeURIComponent(topic)}` : ''}${status ? `&status=${status}` : ''}`);
  const pool = pools.data?.find((p) => p.id === poolId); const { run, busy } = useAction(); const toast = useToast();
  const [edit, setEdit] = useState<Draft | null>(null); const [prev, setPrev] = useState<any | null>(null); const [rm, setRm] = useState<any | null>(null); const [imp, setImp] = useState(false); const [submit, setSubmit] = useState(false);
  const refresh = () => { qs.reload?.(); pools.reload?.(); };
  const filtered = !!(search || difficulty || topic || status);
  return (
    <>
      <PageHead title={pool?.name ?? 'Question pool'} sub={pool ? `${pool.course?.code} — ${pool.course?.title} · ${pool.term}` : undefined}>
        <button className="btn" onClick={onBack}>← All pools</button>
        <button className="btn btn-green" onClick={() => setEdit(blank())}>+ Add MCQ</button>
      </PageHead>
      <div className="toolbar" role="toolbar" aria-label="Pool actions">
        <button className="btn btn-sm" onClick={() => setImp(true)}>Import CSV</button>
        <button className="btn btn-sm" onClick={() => run(async () => { const r: any = await get(`/teacher/pools/${poolId}/export`); download(r.filename, r.csv); toast(`Exported ${r.rows} question${r.rows === 1 ? '' : 's'}`); })}>Export CSV</button>
        <button className="btn btn-sm btn-primary" disabled={!pool?.counts.draft} onClick={() => setSubmit(true)}>Submit pool for review{pool?.counts.draft ? ` (${pool.counts.draft})` : ''}</button>
      </div>
      <div className="filters" style={{ margin: '12px 0' }}>
        <Field label="Search"><input className="in" type="search" value={search} onChange={(e) => { url.set('search', e.target.value); url.set('page', '1'); }} placeholder="Statement or topic" /></Field>
        <Field label="Difficulty"><select className="in" value={difficulty} onChange={(e) => { url.set('difficulty', e.target.value); url.set('page', '1'); }}><option value="">All</option>{DIFF.map((d) => <option key={d} value={d}>{cap(d)}</option>)}</select></Field>
        <Field label="Topic"><select className="in" value={topic} onChange={(e) => { url.set('topic', e.target.value); url.set('page', '1'); }}><option value="">All topics</option>{(qs.data?.topics ?? []).map((t: string) => <option key={t} value={t}>{t}</option>)}</select></Field>
        <Field label="Status"><select className="in" value={status} onChange={(e) => { url.set('status', e.target.value); url.set('page', '1'); }}><option value="">All</option>{['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'].map((s) => <option key={s} value={s}>{cap(s)}</option>)}</select></Field>
      </div>
      <Async state={qs}>{(d) => d.items.length ? (
        <>
          <div data-testid="question-list"><Table rowKey={(q: any) => q.id} rows={d.items} cols={[
            { h: 'Question', cell: (q: any) => <><button className="btn-link" onClick={() => setPrev(q)}>{q.stem.length > 110 ? q.stem.slice(0, 110) + '…' : q.stem}</button>{q.reviewNote && <div className="small faint">Reviewer: {q.reviewNote}</div>}</> },
            { h: 'Topic', cell: (q: any) => q.topic ?? '—' }, { h: 'Difficulty', cell: (q: any) => cap(q.difficulty) }, { h: 'Marks', num: true, cell: (q: any) => q.marks }, { h: 'Status', cell: (q: any) => <Status s={q.status} /> },
            { h: '', cls: 'row-actions', cell: (q: any) => <>
              <button className="btn btn-sm" onClick={() => setPrev(q)}>Preview</button>
              <button className="btn btn-sm" disabled={q.status === 'SUBMITTED'} onClick={() => setEdit({ id: q.id, stem: q.stem, options: q.options.map((o: any) => o.text), correctIndex: q.options.findIndex((o: any) => o.isCorrect), explanation: q.explanation ?? '', difficulty: q.difficulty, topic: q.topic ?? '', marks: String(q.marks) })}>Edit</button>
              <button className="btn btn-sm" onClick={() => run(async () => { await post(`/teacher/questions/${q.id}/duplicate`); toast('Duplicated as a new draft'); refresh(); })}>Duplicate</button>
              <button className="btn btn-sm" onClick={() => setRm(q)}>Delete</button></> },
          ]} /></div>
          <Pager page={page} total={d.total} size={20} onPage={(n) => url.set('page', String(n))} />
        </>) : <p className="muted" data-testid="question-empty">{filtered ? 'No questions match these filters.' : 'This pool has no questions yet. Add an MCQ or import a CSV file.'} {filtered && <button className="btn-link" onClick={url.reset}>Clear filters</button>}</p>}
      </Async>

      {edit && <Editor draft={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); refresh(); }} poolId={poolId} />}
      {prev && <Modal title="Preview" onClose={() => setPrev(null)} footer={<CancelButton>Close</CancelButton>}>
        <div className="stack" data-testid="question-preview"><p style={{ margin: 0, fontWeight: 600 }}>{prev.stem}</p>
          <ol className="preview-options">{prev.options.map((o: any) => <li key={o.label} className={o.isCorrect ? 'correct' : ''}><span className="lab">{o.label}</span>{o.text}{o.isCorrect && <Badge tone="green">correct</Badge>}</li>)}</ol>
          {prev.explanation && <p className="muted" style={{ margin: 0 }}><b>Explanation:</b> {prev.explanation}</p>}
          <p className="small faint" style={{ margin: 0 }}>{cap(prev.difficulty)} · {prev.marks} mark{prev.marks === 1 ? '' : 's'}{prev.topic ? ` · ${prev.topic}` : ''} · This is what you see; students never receive the correct answer before the paper is scored.</p></div></Modal>}
      {rm && <Confirm title="Delete this question?" body={<>It is retired, not erased: an examination that already uses it keeps its approved copy.</>} yes="Delete" danger onNo={() => setRm(null)} onYes={() => run(async () => { await del(`/teacher/questions/${rm.id}`); setRm(null); toast('Question deleted'); refresh(); })} />}
      {submit && <Confirm title="Submit this pool for review?" body={<>{pool?.counts.draft} draft question{pool?.counts.draft === 1 ? '' : 's'} will be sent to the examiners and cannot be edited until they respond.</>} yes="Submit for review" onNo={() => setSubmit(false)} onYes={() => run(async () => { const r: any = await post(`/teacher/pools/${poolId}/submit`); setSubmit(false); toast(`${r.submitted} question${r.submitted === 1 ? '' : 's'} submitted`); refresh(); })} />}
      {imp && <ImportModal poolId={poolId} onClose={() => setImp(false)} onDone={() => { setImp(false); refresh(); }} />}
      <p className="sr-only" aria-live="polite">{busy ? 'Working…' : ''}</p>
    </>
  );
}

function Editor({ draft, onClose, onSaved, poolId }: { draft: Draft; onClose: () => void; onSaved: () => void; poolId: string }) {
  const [d, setD] = useState<Draft>(draft); const { run, busy } = useAction(); const toast = useToast(); const [tried, setTried] = useState(false);
  const opts = d.options.map((o) => o.trim()); const distinct = new Set(opts.map((o) => o.toLowerCase())).size === opts.length;
  const marks = Number(d.marks);
  const missing = [d.stem.trim().length < 3 && 'Question statement', opts.some((o) => !o) && 'All answer options', d.correctIndex < 0 && 'The correct answer', !(marks > 0 && marks <= 100) && 'Marks (0–100)'].filter(Boolean) as string[];
  const problems = [...missing, ...(!distinct && !opts.some((o) => !o) ? ['Answer options must all be different'] : [])];
  const set = (i: number, v: string) => setD({ ...d, options: d.options.map((o, k) => (k === i ? v : o)) });
  return (
    <Modal title={d.id ? 'Edit MCQ' : 'Add MCQ'} onClose={onClose} missing={tried ? problems : []}
      footer={<><CancelButton /><button className="btn btn-green" disabled={busy} onClick={() => { setTried(true); if (problems.length) return; void run(async () => {
        const body = { stem: d.stem, options: d.options, correctIndex: d.correctIndex, explanation: d.explanation || undefined, difficulty: d.difficulty, topic: d.topic || undefined, marks };
        if (d.id) await put(`/teacher/questions/${d.id}`, body); else await post(`/teacher/pools/${poolId}/questions`, body);
        toast(d.id ? 'Question saved as a draft' : 'Question added'); onSaved(); }); }}>{d.id ? 'Save draft' : 'Add question'}</button></>}>
      <div className="stack">
        <Field label="Question statement" required error={tried && d.stem.trim().length < 3 ? 'Enter the question.' : undefined}><textarea className="in" rows={3} value={d.stem} maxLength={2000} onChange={(e) => setD({ ...d, stem: e.target.value })} /></Field>
        <fieldset className="opts"><legend>Answer options <span className="small faint">— select the correct one</span></legend>
          {d.options.map((o, i) => (
            <div className="opt-row" key={i}>
              <input type="radio" name="correct" id={`c${i}`} checked={d.correctIndex === i} onChange={() => setD({ ...d, correctIndex: i })} aria-label={`Option ${'ABCDE'[i]} is correct`} />
              <span className="lab" aria-hidden>{'ABCDE'[i]}</span>
              <input className="in" value={o} maxLength={500} onChange={(e) => set(i, e.target.value)} aria-label={`Option ${'ABCDE'[i]}`} />
              {d.options.length > 4 && i === 4 && <button type="button" className="btn btn-sm" onClick={() => setD({ ...d, options: d.options.slice(0, 4), correctIndex: d.correctIndex === 4 ? -1 : d.correctIndex })}>Remove</button>}
            </div>))}
          {d.options.length < 5 && <button type="button" className="btn btn-sm" onClick={() => setD({ ...d, options: [...d.options, ''] })}>+ Add option E</button>}
          {tried && d.correctIndex < 0 && <span className="err-text" role="alert">Select the correct answer.</span>}
        </fieldset>
        <Field label="Explanation (optional)"><textarea className="in" rows={2} value={d.explanation} maxLength={2000} onChange={(e) => setD({ ...d, explanation: e.target.value })} /></Field>
        <div className="grid g3">
          <Field label="Difficulty"><select className="in" value={d.difficulty} onChange={(e) => setD({ ...d, difficulty: e.target.value as Draft['difficulty'] })}>{DIFF.map((x) => <option key={x} value={x}>{cap(x)}</option>)}</select></Field>
          <Field label="Topic"><input className="in" value={d.topic} maxLength={120} onChange={(e) => setD({ ...d, topic: e.target.value })} /></Field>
          <Field label="Marks" required><input className="in" inputMode="decimal" value={d.marks} onChange={(e) => setD({ ...d, marks: e.target.value })} /></Field>
        </div>
        {d.id && <p className="small faint" style={{ margin: 0 }}>Saving returns an approved question to draft for re-review. Examinations that already use it keep the approved copy.</p>}
      </div>
    </Modal>
  );
}

function ImportModal({ poolId, onClose, onDone }: { poolId: string; onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState(''); const [err, setErr] = useState(''); const { run, busy } = useAction(); const toast = useToast();
  const parsed = text.trim() ? mcqRowsFromCsv(text) : null;
  return (
    <Modal title="Import MCQs from CSV" onClose={onClose} missing={parsed && !parsed.error && parsed.rows.length ? [] : ['a CSV file with at least one question']}
      footer={<><CancelButton /><button className="btn btn-green" disabled={busy || !parsed || !!parsed.error || !parsed.rows.length} onClick={() => run(async () => {
        try { const r: any = await post(`/teacher/pools/${poolId}/import`, { rows: parsed!.rows }); toast(`${r.created} question${r.created === 1 ? '' : 's'} imported as drafts`); onDone(); }
        catch (e) { setErr((e as Error).message); } })}>Import {parsed?.rows.length ? `${parsed.rows.length} question${parsed.rows.length === 1 ? '' : 's'}` : ''}</button></>}>
      <div className="stack">
        <p className="muted small" style={{ margin: 0 }}>Columns: <span className="mono">statement, option_a … option_e, correct, explanation, difficulty, topic, marks</span>. Everything is checked first; if any row is wrong, nothing is imported. XLSX files are not supported — save the sheet as CSV.</p>
        <div className="row"><button className="btn btn-sm" onClick={() => download('mcq-template.csv', MCQ_TEMPLATE)}>Download template</button>
          <label className="btn btn-sm">Choose file<input type="file" accept=".csv,text/csv" className="sr-only" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { setErr(''); setText(await f.text()); } }} /></label></div>
        <textarea className="in mono" rows={7} value={text} onChange={(e) => { setText(e.target.value); setErr(''); }} aria-label="CSV content" placeholder="Paste CSV here, or choose a file" />
        {parsed?.error && <Notice tone="bad">{parsed.error}</Notice>}
        {parsed && !parsed.error && <p className="small" style={{ margin: 0 }}>{parsed.rows.length} question{parsed.rows.length === 1 ? '' : 's'} found.</p>}
        {err && <Notice tone="bad">{err}</Notice>}
      </div>
    </Modal>
  );
}
