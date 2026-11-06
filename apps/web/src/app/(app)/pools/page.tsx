'use client';
import { useEffect, useRef, useState } from 'react';
import { del, get, post, put, useGet } from '@/api';
import { mcqRowsFromCsv, mcqRowsFromTable, MCQ_COLUMNS, MCQ_EXAMPLE, MCQ_TEMPLATE, type McqImportRow } from '@/csv';
import { MAX_XLSX_BYTES, readXlsx, writeXlsx, XlsxError } from '@/xlsx-lite';
import { useUrlState } from '@/url-state';
import { Async, Badge, CancelButton, Confirm, Field, Modal, Notice, PageHead, Pager, Status, Table, useAction, useToast } from '@/ui';

const DIFF = ['EASY', 'MEDIUM', 'HARD'] as const; const cap = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();
const downloadBlob = (name: string, blob: Blob) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); };
const download = (name: string, text: string, type = 'text/csv;charset=utf-8') => downloadBlob(name, new Blob([text], { type }));
const BLOOM = ['REMEMBER', 'UNDERSTAND', 'APPLY', 'ANALYZE', 'EVALUATE', 'CREATE'] as const;
const MAX_IMAGE_BYTES = 1_000_000;
interface Draft { id?: string; stem: string; options: string[]; correctIndex: number; explanation: string; difficulty: 'EASY' | 'MEDIUM' | 'HARD'; topic: string; subtopic: string; bloom: string; imageId: string; marks: string }
const blank = (): Draft => ({ stem: '', options: ['', '', '', ''], correctIndex: -1, explanation: '', difficulty: 'MEDIUM', topic: '', subtopic: '', bloom: '', imageId: '', marks: '1' });
/** The next blank form keeps the classification of the last one (topic, subtopic, difficulty, Bloom level, marks), because a batch usually shares them. */
const nextBlank = (d: Draft): Draft => ({ ...blank(), difficulty: d.difficulty, topic: d.topic, subtopic: d.subtopic, bloom: d.bloom, marks: d.marks });

/** A question's image, fetched from the author's own bank (the API serves it to its uploader only). */
function QImage({ id, alt }: { id: string; alt?: string }) {
  const st = useGet<{ data: string }>(id ? `/teacher/images/${id}` : null);
  return st.data ? <img src={st.data.data} alt={alt ?? 'Image attached to the question'} style={{ maxWidth: '100%', maxHeight: 280, borderRadius: 6, border: '1px solid var(--rose)' }} /> : st.error ? <span className="small faint">The image could not be loaded.</span> : null;
}

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
      <PageHead title="MCQ Question Banks" sub="Question banks for your approved subjects. Submit a bank and the examiners review its questions.">
        <button className="btn btn-green" disabled={!approved.length} onClick={() => { setF({ assignmentId: approved[0]?.id ?? '', name: '', description: '' }); setAdd(true); }}>+ New question bank</button>
      </PageHead>
      <Async state={st}>{(rows) => rows.length ? (
        <div data-testid="pool-list"><Table rowKey={(p: any) => p.id} rows={rows} cols={[
          { h: 'Question bank', cell: (p: any) => <><button className="btn-link" onClick={() => onOpen(p.id)}><b>{p.name}</b></button>{p.description && <div className="small faint">{p.description}</div>}</> },
          { h: 'Subject', cell: (p: any) => <>{p.course?.title}<div className="small faint">{p.course?.code}</div></> }, { h: 'Session', cell: (p: any) => p.term },
          { h: 'Questions', num: true, cell: (p: any) => p.counts.total }, { h: 'Review', cell: (p: any) => <span className="small">{p.counts.draft} draft · {p.counts.submitted} submitted · {p.counts.approved} approved</span> },
          { h: '', cls: 'row-actions', cell: (p: any) => <><button className="btn btn-sm" onClick={() => onOpen(p.id)}>Open</button><button className="btn btn-sm" onClick={() => setRm(p)}>Delete</button></> },
        ]} /></div>
      ) : <p className="muted" data-testid="pool-empty">{approved.length ? 'No question banks yet. Create one to start adding MCQs.' : 'You need an approved class and subject before you can create a question bank.'}</p>}</Async>
      {add && <Modal title="New question bank" onClose={() => setAdd(false)} missing={[!f.assignmentId && 'Class and subject', f.name.trim().length < 2 && 'Bank title'].filter(Boolean) as string[]}
        footer={<><CancelButton /><button className="btn btn-green" disabled={busy || !f.assignmentId || f.name.trim().length < 2} onClick={() => run(async () => { const r: any = await post('/teacher/pools', { assignmentId: f.assignmentId, name: f.name, description: f.description || undefined }); setAdd(false); toast('Question bank created'); onOpen(r.id); })}>Create question bank</button></>}>
        <div className="stack">
          <Field label="Class and subject" required><select className="in" value={f.assignmentId} onChange={(e) => setF({ ...f, assignmentId: e.target.value })}>{approved.map((a) => <option key={a.id} value={a.id}>{a.course.code} — {a.course.title} · {a.institution.code} · {a.term}</option>)}</select></Field>
          <Field label="Bank title" required><input className="in" value={f.name} maxLength={120} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Endocrine pathology — week 3" /></Field>
          <Field label="Description"><input className="in" value={f.description} maxLength={500} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        </div></Modal>}
      {rm && <Confirm title={`Delete “${rm.name}”?`} body={<>Draft questions in this bank are retired with it. A bank with submitted or approved questions cannot be deleted.</>} yes="Delete question bank" danger onNo={() => setRm(null)} onYes={() => run(async () => { await del(`/teacher/pools/${rm.id}`); setRm(null); toast('Question bank deleted'); st.reload(); })} />}
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
      <PageHead title={pool?.name ?? 'Question bank'} sub={pool ? `${pool.course?.code} — ${pool.course?.title} · ${pool.term}` : undefined}>
        <button className="btn" onClick={onBack}>← All question banks</button>
        <button className="btn btn-green" onClick={() => setEdit(blank())}>+ Add MCQ</button>
      </PageHead>
      <div className="toolbar" role="toolbar" aria-label="Question bank actions">
        <button className="btn btn-sm" onClick={() => setImp(true)}>Import from CSV or Excel</button>
        <button className="btn btn-sm" onClick={() => run(async () => { const r: any = await get(`/teacher/pools/${poolId}/export`); download(r.filename, r.csv); toast(`Exported ${r.rows} question${r.rows === 1 ? '' : 's'}`); })}>Export CSV</button>
        <button className="btn btn-sm" onClick={() => run(async () => { const r: any = await get(`/teacher/pools/${poolId}/export`); downloadBlob(r.filename.replace(/\.csv$/, '.xlsx'), writeXlsx(pool?.name ?? 'Questions', r.table.head, r.table.rows)); toast(`Exported ${r.rows} question${r.rows === 1 ? '' : 's'} to Excel`); })}>Export Excel</button>
        <button className="btn btn-sm btn-primary" disabled={!pool?.counts.draft} onClick={() => setSubmit(true)}>Submit question bank for review{pool?.counts.draft ? ` (${pool.counts.draft})` : ''}</button>
      </div>
      <div className="filters" style={{ margin: '12px 0' }}>
        <Field label="Search"><input className="in" type="search" value={search} onChange={(e) => { url.set('search', e.target.value); url.set('page', '1'); }} placeholder="Statement, topic or subtopic" /></Field>
        <Field label="Difficulty"><select className="in" value={difficulty} onChange={(e) => { url.set('difficulty', e.target.value); url.set('page', '1'); }}><option value="">All</option>{DIFF.map((d) => <option key={d} value={d}>{cap(d)}</option>)}</select></Field>
        <Field label="Topic"><select className="in" value={topic} onChange={(e) => { url.set('topic', e.target.value); url.set('page', '1'); }}><option value="">All topics</option>{(qs.data?.topics ?? []).map((t: string) => <option key={t} value={t}>{t}</option>)}</select></Field>
        <Field label="Status"><select className="in" value={status} onChange={(e) => { url.set('status', e.target.value); url.set('page', '1'); }}><option value="">All</option>{['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'].map((s) => <option key={s} value={s}>{cap(s)}</option>)}</select></Field>
      </div>
      <Async state={qs}>{(d) => d.items.length ? (
        <>
          <div data-testid="question-list"><Table rowKey={(q: any) => q.id} rowLabel={(q: any) => q.stem.slice(0, 40)} rows={d.items} cols={[
            { h: 'Question', cell: (q: any) => <><button className="btn-link" onClick={() => setPrev(q)}>{q.stem.length > 110 ? q.stem.slice(0, 110) + '…' : q.stem}</button>{q.reviewNote && <div className="small faint">Reviewer: {q.reviewNote}</div>}</> },
            { h: 'Topic', cell: (q: any) => <>{q.topic ?? '—'}{q.subtopic && <div className="small faint">{q.subtopic}</div>}</> }, { h: 'Difficulty', cell: (q: any) => cap(q.difficulty) }, { h: 'Bloom', more: true, cell: (q: any) => q.bloom ? cap(q.bloom) : '—' }, { h: 'Marks', num: true, cell: (q: any) => q.marks }, { h: 'Status', cell: (q: any) => <Status s={q.status} /> },
            { h: '', cls: 'row-actions', cell: (q: any) => <>
              <button className="btn btn-sm" onClick={() => setPrev(q)}>Preview</button>
              <button className="btn btn-sm" disabled={q.status === 'SUBMITTED'} onClick={() => setEdit({ id: q.id, stem: q.stem, options: q.options.map((o: any) => o.text), correctIndex: q.options.findIndex((o: any) => o.isCorrect), explanation: q.explanation ?? '', difficulty: q.difficulty, topic: q.topic ?? '', subtopic: q.subtopic ?? '', bloom: q.bloom ?? '', imageId: q.imageId ?? '', marks: String(q.marks) })}>Edit</button>
              <button className="btn btn-sm" onClick={() => run(async () => { await post(`/teacher/questions/${q.id}/duplicate`); toast('Duplicated as a new draft'); refresh(); })}>Duplicate</button>
              <button className="btn btn-sm" onClick={() => setRm(q)}>Delete</button></> },
          ]} /></div>
          <Pager page={page} total={d.total} size={20} onPage={(n) => url.set('page', String(n))} />
        </>) : <p className="muted" data-testid="question-empty">{filtered ? 'No questions match these filters.' : 'This question bank has no questions yet. Add an MCQ or import a CSV or Excel file.'} {filtered && <button className="btn-link" onClick={url.reset}>Clear filters</button>}</p>}
      </Async>

      {edit && <Editor draft={edit} onClose={() => setEdit(null)} onChanged={refresh} poolId={poolId} />}
      {prev && <Modal title="Preview" onClose={() => setPrev(null)} footer={<CancelButton>Close</CancelButton>}>
        <div className="stack" data-testid="question-preview"><p style={{ margin: 0, fontWeight: 600 }}>{prev.stem}</p>{prev.imageId && <QImage id={prev.imageId} />}
          <ol className="preview-options">{prev.options.map((o: any) => <li key={o.label} className={o.isCorrect ? 'correct' : ''}><span className="lab">{o.label}</span>{o.text}{o.isCorrect && <Badge tone="green">correct</Badge>}</li>)}</ol>
          {prev.explanation && <p className="muted" style={{ margin: 0 }}><b>Explanation:</b> {prev.explanation}</p>}
          <p className="small faint" style={{ margin: 0 }}>{cap(prev.difficulty)} · {prev.marks} mark{prev.marks === 1 ? '' : 's'}{prev.topic ? ` · ${prev.topic}` : ''}{prev.subtopic ? ` › ${prev.subtopic}` : ''}{prev.bloom ? ` · Bloom: ${cap(prev.bloom)}` : ''} · This is what you see; students never receive the correct answer before the paper is scored.</p></div></Modal>}
      {rm && <Confirm title="Delete this question?" body={<>It is retired, not erased: an examination that already uses it keeps its approved copy.</>} yes="Delete" danger onNo={() => setRm(null)} onYes={() => run(async () => { await del(`/teacher/questions/${rm.id}`); setRm(null); toast('Question deleted'); refresh(); })} />}
      {submit && <Confirm title="Submit this question bank for review?" body={<>{pool?.counts.draft} draft question{pool?.counts.draft === 1 ? '' : 's'} will be sent to the examiners and cannot be edited until they respond.</>} yes="Submit for review" onNo={() => setSubmit(false)} onYes={() => run(async () => { const r: any = await post(`/teacher/pools/${poolId}/submit`); setSubmit(false); toast(`${r.submitted} question${r.submitted === 1 ? '' : 's'} submitted`); refresh(); })} />}
      {imp && <ImportModal poolId={poolId} onClose={() => setImp(false)} onDone={() => { setImp(false); refresh(); }} />}
      <p className="sr-only" aria-live="polite">{busy ? 'Working…' : ''}</p>
    </>
  );
}

/** Owns the open/blank cycle: "Save & add another" remounts the form (fresh dialog state, so the unsaved-changes guard starts clean) with the same classification. */
function Editor({ draft, onClose, onChanged, poolId }: { draft: Draft; onClose: () => void; onChanged: () => void; poolId: string }) {
  const [cur, setCur] = useState<Draft>(draft); const [n, setN] = useState(0); const [added, setAdded] = useState(0);
  return <EditorForm key={n} draft={cur} added={added} poolId={poolId} onClose={onClose} onChanged={onChanged} onAnother={(saved) => { setCur(nextBlank(saved)); setAdded((a) => a + 1); setN((x) => x + 1); }} />;
}

function EditorForm({ draft, added, onClose, onChanged, onAnother, poolId }: { draft: Draft; added: number; onClose: () => void; onChanged: () => void; onAnother: (saved: Draft) => void; poolId: string }) {
  const [d, setD] = useState<Draft>(draft); const { run, busy } = useAction(); const toast = useToast(); const [tried, setTried] = useState(false); const [preview, setPreview] = useState(false);
  const [img, setImg] = useState<{ data: string } | null>(null); const [imgErr, setImgErr] = useState(''); const [upBusy, setUpBusy] = useState(false); const stemRef = useRef<HTMLTextAreaElement>(null);
  const initial = useRef(JSON.stringify(draft)); const dirty = JSON.stringify(d) !== initial.current;
  const opts = d.options.map((o) => o.trim()); const distinct = new Set(opts.map((o) => o.toLowerCase())).size === opts.length;
  const marks = Number(d.marks);
  const missing = [d.stem.trim().length < 3 && 'Question statement', opts.some((o) => !o) && 'All answer options', d.correctIndex < 0 && 'The correct answer', !(marks > 0 && marks <= 100) && 'Marks (0–100)'].filter(Boolean) as string[];
  const problems = [...missing, ...(!distinct && !opts.some((o) => !o) ? ['Answer options must all be different'] : [])];
  const set = (i: number, v: string) => setD({ ...d, options: d.options.map((o, k) => (k === i ? v : o)) });
  useEffect(() => { stemRef.current?.focus(); }, []);                                                   // a fresh form starts at the statement
  useEffect(() => { if (!dirty) return; const h = (e: BeforeUnloadEvent) => { e.preventDefault(); }; window.addEventListener('beforeunload', h); return () => window.removeEventListener('beforeunload', h); }, [dirty]);   // closing the tab/window with unsaved work
  const attach = async (file: File | undefined) => {
    if (!file) return; setImgErr('');
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { setImgErr('Choose a PNG, JPEG or WebP image.'); return; }
    if (file.size > MAX_IMAGE_BYTES) { setImgErr('The image is too large. Choose one under 1 MB.'); return; }
    setUpBusy(true);
    try {
      const data = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error('The image could not be read.')); r.readAsDataURL(file); });
      const up: any = await post('/teacher/images', { data }); setImg({ data }); setD((x) => ({ ...x, imageId: up.id }));
    } catch (e) { setImgErr((e as Error).message); } finally { setUpBusy(false); }
  };
  const body = () => ({ stem: d.stem, options: d.options, correctIndex: d.correctIndex, explanation: d.explanation || undefined, difficulty: d.difficulty, topic: d.topic || undefined, subtopic: d.subtopic.trim() || null, bloom: d.bloom || null, imageId: d.imageId || null, marks });
  const save = (another: boolean) => { setTried(true); if (problems.length || upBusy) return; void run(async () => {
    if (d.id) await put(`/teacher/questions/${d.id}`, body()); else await post(`/teacher/pools/${poolId}/questions`, body());
    toast(another ? 'Saved as a draft — ready for the next question' : d.id ? 'Question saved as a draft' : 'Question saved as a draft'); onChanged();
    if (another) onAnother(d); else onClose(); }); };
  const shown = img?.data ?? null;
  return (
    <Modal title={preview ? 'Preview MCQ' : d.id ? 'Edit MCQ' : 'Add MCQ'} onClose={onClose} missing={tried ? problems : []}
      footer={<><CancelButton />
        <button type="button" className="btn" onClick={() => setPreview(!preview)}>{preview ? 'Back to editing' : 'Preview'}</button>
        <button type="button" className="btn btn-green" disabled={busy || upBusy} onClick={() => save(false)}>{busy ? 'Saving…' : 'Save draft'}</button>
        <button type="button" className="btn btn-primary" disabled={busy || upBusy} onClick={() => save(true)}>{busy ? 'Saving…' : 'Save & add another'}</button></>}>
      <div className="stack" onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(true); } }}>
        {added > 0 && <p className="notice ok small" role="status" data-testid="added-count" style={{ margin: 0 }}>{added} question{added === 1 ? '' : 's'} saved in this session. Topic, difficulty and marks are kept for the next one.</p>}
        {preview ? (
          <div className="stack" data-testid="editor-preview"><p style={{ margin: 0, fontWeight: 600 }}>{d.stem || <span className="faint">(no statement yet)</span>}</p>{shown && <img src={shown} alt="Image attached to the question" style={{ maxWidth: '100%', maxHeight: 280, borderRadius: 6, border: '1px solid var(--rose)' }} />}{!shown && d.imageId && <QImage id={d.imageId} />}
            <ol className="preview-options">{d.options.map((o, i) => <li key={i} className={d.correctIndex === i ? 'correct' : ''}><span className="lab">{'ABCDE'[i]}</span>{o || <span className="faint">(empty)</span>}{d.correctIndex === i && <Badge tone="green">correct</Badge>}</li>)}</ol>
            {d.explanation && <p className="muted" style={{ margin: 0 }}><b>Explanation:</b> {d.explanation}</p>}
            <p className="small faint" style={{ margin: 0 }}>{cap(d.difficulty)} · {d.marks} mark{d.marks === '1' ? '' : 's'}{d.topic ? ` · ${d.topic}` : ''}{d.subtopic ? ` › ${d.subtopic}` : ''}{d.bloom ? ` · Bloom: ${cap(d.bloom)}` : ''}</p></div>
        ) : (<>
        <Field label="Question statement" required error={tried && d.stem.trim().length < 3 ? 'Enter the question.' : undefined}><textarea ref={stemRef} className="in" rows={3} value={d.stem} maxLength={2000} onChange={(e) => setD({ ...d, stem: e.target.value })} /></Field>
        <div className="stack" style={{ gap: 6 }}>
          <div className="row" style={{ alignItems: 'center' }}>
            <label className="btn btn-sm">{d.imageId ? 'Replace image' : 'Add image or diagram (optional)'}<input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label="Image or diagram" onChange={(e) => { void attach(e.target.files?.[0]); e.target.value = ''; }} /></label>
            {d.imageId && <button type="button" className="btn btn-sm" onClick={() => { setD({ ...d, imageId: '' }); setImg(null); }}>Remove image</button>}
            {upBusy && <span className="small muted" role="status">Uploading…</span>}
          </div>
          {shown ? <img src={shown} alt="Image attached to the question" style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 6, border: '1px solid var(--rose)' }} /> : d.imageId ? <QImage id={d.imageId} /> : null}
          {imgErr && <span className="err-text" role="alert">{imgErr}</span>}
          <span className="small faint">PNG, JPEG or WebP, under 1 MB. Images are kept in your question bank and shown to reviewers; they are not shown to students in an examination yet.</span>
        </div>
        <fieldset className="opts"><legend>Answer options <span className="small faint">— select the correct one</span></legend>
          {d.options.map((o, i) => (
            <div className="opt-row" key={i}>
              <input type="radio" name="correct" id={`c${i}`} checked={d.correctIndex === i} onChange={() => setD({ ...d, correctIndex: i })} aria-label={`Option ${'ABCDE'[i]} is correct`} />
              <span className="lab" aria-hidden>{'ABCDE'[i]}</span>
              <input className="in" value={o} maxLength={500} onChange={(e) => set(i, e.target.value)} aria-label={`Option ${'ABCDE'[i]}`}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); (e.currentTarget.closest('.opts')?.querySelectorAll<HTMLInputElement>('input.in')[i + 1] ?? document.getElementById('mcq-explanation'))?.focus(); } }} />
              {d.options.length > 4 && i === 4 && <button type="button" className="btn btn-sm" onClick={() => setD({ ...d, options: d.options.slice(0, 4), correctIndex: d.correctIndex === 4 ? -1 : d.correctIndex })}>Remove</button>}
            </div>))}
          {d.options.length < 5 && <button type="button" className="btn btn-sm" onClick={() => setD({ ...d, options: [...d.options, ''] })}>+ Add option E</button>}
          {tried && d.correctIndex < 0 && <span className="err-text" role="alert">Select the correct answer.</span>}
        </fieldset>
        <Field label="Explanation (optional)"><textarea id="mcq-explanation" className="in" rows={2} value={d.explanation} maxLength={2000} onChange={(e) => setD({ ...d, explanation: e.target.value })} /></Field>
        <div className="grid g3">
          <Field label="Difficulty"><select className="in" value={d.difficulty} onChange={(e) => setD({ ...d, difficulty: e.target.value as Draft['difficulty'] })}>{DIFF.map((x) => <option key={x} value={x}>{cap(x)}</option>)}</select></Field>
          <Field label="Bloom's level (optional)"><select className="in" value={d.bloom} onChange={(e) => setD({ ...d, bloom: e.target.value })}><option value="">Not set</option>{BLOOM.map((x) => <option key={x} value={x}>{cap(x)}</option>)}</select></Field>
          <Field label="Marks" required><input className="in" inputMode="decimal" value={d.marks} onChange={(e) => setD({ ...d, marks: e.target.value })} /></Field>
        </div>
        <div className="grid g2">
          <Field label="Topic"><input className="in" value={d.topic} maxLength={120} onChange={(e) => setD({ ...d, topic: e.target.value })} /></Field>
          <Field label="Subtopic"><input className="in" value={d.subtopic} maxLength={120} onChange={(e) => setD({ ...d, subtopic: e.target.value })} /></Field>
        </div>
        {d.id && <p className="small faint" style={{ margin: 0 }}>Saving returns an approved question to draft for re-review. Examinations that already use it keep the approved copy.</p>}
        <p className="small faint" style={{ margin: 0 }}>Tip: Enter moves to the next option; Ctrl+Enter saves and opens a new question.</p>
        </>)}
      </div>
    </Modal>
  );
}

function ImportModal({ poolId, onClose, onDone }: { poolId: string; onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState(''); const [file, setFile] = useState<{ name: string; rows: McqImportRow[]; error?: string } | null>(null); const [err, setErr] = useState(''); const { run, busy } = useAction(); const toast = useToast();
  const parsed = file ? { rows: file.rows, error: file.error } : text.trim() ? mcqRowsFromCsv(text) : null;
  const pick = async (f: File | undefined) => {
    if (!f) return; setErr('');
    if (/\.xlsx$/i.test(f.name) || f.type.includes('spreadsheetml')) {
      if (f.size > MAX_XLSX_BYTES) { setFile({ name: f.name, rows: [], error: 'The file is too large (2 MB at most).' }); return; }
      try { setText(''); setFile({ name: f.name, ...mcqRowsFromTable(await readXlsx(f)) }); } catch (e) { setFile({ name: f.name, rows: [], error: e instanceof XlsxError ? e.message : 'The Excel file could not be read.' }); }
    } else if (/\.xls$/i.test(f.name)) { setFile({ name: f.name, rows: [], error: 'Old .xls files are not supported. Save the sheet as .xlsx or CSV.' }); }
    else { setFile(null); setText(await f.text()); }
  };
  return (
    <Modal title="Import MCQs from CSV or Excel" onClose={onClose} missing={parsed && !parsed.error && parsed.rows.length ? [] : ['a CSV or Excel file with at least one question']}
      footer={<><CancelButton /><button className="btn btn-green" disabled={busy || !parsed || !!parsed.error || !parsed.rows.length} onClick={() => run(async () => {
        try { const r: any = await post(`/teacher/pools/${poolId}/import`, { rows: parsed!.rows }); toast(`${r.created} question${r.created === 1 ? '' : 's'} imported as drafts`); onDone(); }
        catch (e) { setErr((e as Error).message); } })}>Import {parsed?.rows.length ? `${parsed.rows.length} question${parsed.rows.length === 1 ? '' : 's'}` : ''}</button></>}>
      <div className="stack">
        <p className="muted small" style={{ margin: 0 }}>Columns: <span className="mono">{MCQ_COLUMNS.join(', ')}</span>. Only the first sheet of an Excel file is read. Everything is checked first; if any row is wrong, nothing is imported, and the message names the row.</p>
        <div className="row"><button className="btn btn-sm" onClick={() => download('mcq-template.csv', MCQ_TEMPLATE)}>Download CSV template</button>
          <button className="btn btn-sm" onClick={() => downloadBlob('mcq-template.xlsx', writeXlsx('Questions', [...MCQ_COLUMNS], [[...MCQ_EXAMPLE]]))}>Download Excel template</button>
          <label className="btn btn-sm">Choose file<input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" aria-label="CSV or Excel file" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} /></label></div>
        {file ? <p className="small" style={{ margin: 0 }} data-testid="import-file">File: <b>{file.name}</b> <button className="btn-link" onClick={() => { setFile(null); setErr(''); }}>Clear</button></p>
          : <textarea className="in mono" rows={7} value={text} onChange={(e) => { setText(e.target.value); setErr(''); }} aria-label="CSV content" placeholder="Paste CSV here, or choose a CSV or Excel file" />}
        {parsed?.error && <Notice tone="bad">{parsed.error}</Notice>}
        {parsed && !parsed.error && <p className="small" style={{ margin: 0 }}>{parsed.rows.length} question{parsed.rows.length === 1 ? '' : 's'} found.</p>}
        {err && <Notice tone="bad">{err}</Notice>}
      </div>
    </Modal>
  );
}
