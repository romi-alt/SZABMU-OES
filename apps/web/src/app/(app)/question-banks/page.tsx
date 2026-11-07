'use client';
import Link from 'next/link';
import { useState } from 'react';
import { fmtDT, post, useGet } from '@/api';
import { auditLabel } from '@/audit-labels';
import { useUrlState } from '@/url-state';
import { Async, Badge, CancelButton, Field, ListEmpty, Modal, Notice, PageHead, Pager, Table, useAction, useToast } from '@/ui';

/**
 * Teacher Question Banks (examiners and administrators who may approve questions): the queue of banks teachers have submitted, and the review
 * screen with every question, its answer key and the decision controls. A bank is visible here only once the teacher has submitted it.
 */
const STATE: Record<string, string> = { SUBMITTED: 'Under review', REJECTED: 'Returned for changes', APPROVED: 'Approved' };
const TONE: Record<string, string> = { SUBMITTED: 'amber', REJECTED: 'red', APPROVED: 'green' };
const cap = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

export default function TeacherQuestionBanks() {
  const url = useUrlState({ bank: '', status: 'SUBMITTED', search: '', page: '1' });
  return url.vals.bank ? <BankReview id={url.vals.bank} onBack={() => url.set('bank', '')} /> : <Queue url={url} />;
}

type QueueUrl = { vals: Record<'bank' | 'status' | 'search' | 'page', string>; set: (k: 'bank' | 'status' | 'search' | 'page', v: string) => void; reset: () => void };
function Queue({ url }: { url: QueueUrl }) {
  const { status, search } = url.vals; const page = Number(url.vals.page) || 1;
  const st = useGet<any>(`/question-banks?status=${status}&page=${page}&pageSize=20${search ? `&search=${encodeURIComponent(search)}` : ''}`);
  return (
    <>
      <PageHead title="Teacher Question Banks" sub="Question banks that teachers have submitted for review. Approved questions become available when you prepare an examination paper.">
        <Link className="btn" href="/questions?status=SUBMITTED">Submitted questions (all sources)</Link>
      </PageHead>
      <Async state={st}>{(d) => (
        <>
          <p className="small" style={{ margin: '0 0 8px' }} data-testid="queue-waiting"><b>{d.waiting}</b> question bank{d.waiting === 1 ? ' is' : 's are'} waiting for review.</p>
          <div className="filters" style={{ margin: '0 0 12px' }}>
            <Field label="Show"><select className="in" value={status} onChange={(e) => { url.set('status', e.target.value); url.set('page', '1'); }}>{Object.entries(STATE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <Field label="Search"><input className="in" type="search" value={search} placeholder="Bank title or teacher name" onChange={(e) => { url.set('search', e.target.value); url.set('page', '1'); }} /></Field>
          </div>
          {d.items.length ? (
            <div data-testid="bank-queue"><Table rowKey={(b: any) => b.id} rowLabel={(b: any) => b.name} rows={d.items} cols={[
              { h: 'Question bank', cell: (b: any) => <button className="btn-link" onClick={() => url.set('bank', b.id)}><b>{b.name}</b></button> },
              { h: 'Teacher', cell: (b: any) => <>{b.owner.fullName}{b.owner.department && <div className="small faint">{b.owner.department}</div>}</> },
              { h: 'Subject', more: true, cell: (b: any) => <>{b.course?.title}<div className="small faint">{b.course?.code} · {b.term}</div></> },
              { h: 'Campus', more: true, cell: (b: any) => b.institution?.code ?? '—' },
              { h: status === 'SUBMITTED' ? 'Submitted' : 'Reviewed', more: true, cell: (b: any) => fmtDT(status === 'SUBMITTED' ? b.submittedAt : b.reviewedAt) },
              { h: 'Questions', cell: (b: any) => <span className="small">{b.counts.submitted} waiting · {b.counts.approved} approved · {b.counts.rejected} returned</span> },
              { h: '', cell: (b: any) => <button className="btn btn-sm" onClick={() => url.set('bank', b.id)} aria-label={`${status === 'SUBMITTED' ? 'Review' : 'Open'} ${b.name}`}>{status === 'SUBMITTED' ? 'Review' : 'Open'}</button> },
            ]} /></div>
          ) : <ListEmpty noun="question banks" filters={[search && `“${search}”`, (STATE[status] ?? '').toLowerCase()].filter(Boolean) as string[]} onClear={url.reset} />}
          <Pager page={page} total={d.total} size={20} onPage={(n) => url.set('page', String(n))} />
        </>)}
      </Async>
    </>
  );
}

function ReviewImage({ bankId, imageId }: { bankId: string; imageId: string }) {
  const st = useGet<{ data: string }>(`/question-banks/${bankId}/images/${imageId}`);
  return st.data ? <img src={st.data.data} alt="Image attached to the question" style={{ maxWidth: '100%', maxHeight: 260, borderRadius: 6, border: '1px solid var(--rose)' }} /> : st.error ? <span className="small faint">The image could not be loaded.</span> : null;
}

function BankReview({ id, onBack }: { id: string; onBack: () => void }) {
  const st = useGet<any>(`/question-banks/${id}`);
  return (
    <>
      <PageHead title={st.data?.name ?? 'Question bank'} sub={st.data ? `${st.data.course?.code} — ${st.data.course?.title} · ${st.data.term ?? ''} · ${st.data.institution?.name ?? ''}` : undefined}>
        <button className="btn" onClick={onBack}>← All question banks</button>
      </PageHead>
      <Async state={st}>{(d) => <ReviewBody d={d} reload={() => st.reload?.()} />}</Async>
    </>
  );
}

type Dec = { decision: '' | 'APPROVE' | 'REJECT'; note: string };
function ReviewBody({ d, reload }: { d: any; reload: () => void }) {
  const { run, busy } = useAction(); const toast = useToast();
  const waiting = d.questions.filter((q: any) => q.status === 'SUBMITTED');
  const [dec, setDec] = useState<Record<string, Dec>>({}); const [bankNote, setBankNote] = useState(''); const [ask, setAsk] = useState<'approve' | 'return' | null>(null); const [returnNote, setReturnNote] = useState('');
  const get = (qid: string): Dec => dec[qid] ?? { decision: '', note: '' };
  const set = (qid: string, patch: Partial<Dec>) => setDec((x) => ({ ...x, [qid]: { ...get(qid), ...patch } }));
  const decided = waiting.filter((q: any) => get(q.id).decision).length;
  const needNote = waiting.filter((q: any) => get(q.id).decision === 'REJECT' && !get(q.id).note.trim() && !bankNote.trim());
  const canSave = !!waiting.length && decided === waiting.length && !needNote.length;
  const submit = (body: object, done: string) => run(async () => { const r: any = await post(`/question-banks/${d.id}/review`, body); toast(done); setAsk(null); reload(); return r; });
  return (
    <div className="stack-lg">
      <section className="card" aria-label="Bank details"><div className="card-b stack" data-testid="bank-info">
        <div className="row between wrap"><div><b>{d.owner.fullName}</b><div className="small faint">{[d.owner.designation, d.owner.department, d.owner.employeeId].filter(Boolean).join(' · ')}</div></div>
          <div><Badge tone={TONE[d.status] ?? 'grey'}>{STATE[d.status] ?? d.status}</Badge></div></div>
        <div className="small muted">{d.questions.length} question{d.questions.length === 1 ? '' : 's'} to look at · submitted {d.submittedAt ? fmtDT(d.submittedAt) : '—'}{d.reviewedAt ? ` · last decision ${fmtDT(d.reviewedAt)}` : ''}</div>
        {d.description && <div className="small">{d.description}</div>}
        {d.reviewNote && <Notice tone={d.status === 'REJECTED' ? 'warn' : 'ok'}><span data-testid="bank-feedback"><b>Comment given to the teacher:</b> {d.reviewNote}</span></Notice>}
      </div></section>

      {d.questions.map((q: any, i: number) => (
        <article className="card" key={q.id} aria-label={`Question ${i + 1}`} data-testid="review-question"><div className="card-b stack">
          <div className="row between wrap"><b>Question {i + 1}</b><span><Badge tone={q.status === 'APPROVED' ? 'green' : q.status === 'REJECTED' ? 'red' : 'amber'}>{q.status === 'SUBMITTED' ? 'Waiting' : q.status === 'REJECTED' ? 'Returned' : 'Approved'}</Badge> <span className="small faint">version {q.version}</span></span></div>
          {q.vignette && <div className="vignette">{q.vignette}</div>}
          <p style={{ margin: 0, fontWeight: 600 }}>{q.stem}</p>
          {q.imageId && <ReviewImage bankId={d.id} imageId={q.imageId} />}
          <ol className="preview-options" aria-label="Answer options">{q.options.map((o: any) => <li key={o.label} className={o.isCorrect ? 'correct' : ''}><span className="lab">{o.label}</span>{o.text}{o.isCorrect && <Badge tone="green">correct answer</Badge>}</li>)}</ol>
          {q.explanation && <p className="muted small" style={{ margin: 0 }}><b>Explanation:</b> {q.explanation}</p>}
          <p className="small faint" style={{ margin: 0 }}>{cap(q.difficulty)} · {q.marks} mark{q.marks === 1 ? '' : 's'}{q.topic ? ` · ${q.topic}` : ''}{q.subtopic ? ` › ${q.subtopic}` : ''}{q.bloom ? ` · Bloom: ${cap(q.bloom)}` : ''}</p>
          {q.reviewNote && q.status !== 'SUBMITTED' && <p className="small" style={{ margin: 0 }}><b>Comment:</b> {q.reviewNote}</p>}
          {q.status === 'SUBMITTED' && d.status === 'SUBMITTED' && (
            <fieldset className="opts" style={{ margin: 0 }}><legend className="small">Your decision on question {i + 1}</legend>
              <div className="row">
                <label className="row" style={{ gap: 6 }}><input type="radio" name={`dec-${q.id}`} checked={get(q.id).decision === 'APPROVE'} onChange={() => set(q.id, { decision: 'APPROVE' })} /> Approve</label>
                <label className="row" style={{ gap: 6 }}><input type="radio" name={`dec-${q.id}`} checked={get(q.id).decision === 'REJECT'} onChange={() => set(q.id, { decision: 'REJECT' })} /> Return for changes</label>
              </div>
              {get(q.id).decision === 'REJECT' && <Field label={`Comment for the teacher on question ${i + 1}`} hint={bankNote.trim() ? 'Leave empty to use the comment for the whole bank.' : undefined} required={!bankNote.trim()}><textarea className="in" rows={2} maxLength={2000} value={get(q.id).note} onChange={(e) => set(q.id, { note: e.target.value })} /></Field>}
            </fieldset>)}
        </div></article>))}

      {d.status === 'SUBMITTED' && waiting.length > 0 && (
        <section className="card" aria-label="Decision"><div className="card-b stack">
          <Field label="Comment for the teacher about the whole bank (optional)"><textarea className="in" rows={2} maxLength={2000} value={bankNote} onChange={(e) => setBankNote(e.target.value)} /></Field>
          <p className="small muted" style={{ margin: 0 }} role="status" data-testid="decision-progress">{decided} of {waiting.length} question{waiting.length === 1 ? '' : 's'} decided{needNote.length ? ` · ${needNote.length} returned question${needNote.length === 1 ? ' needs' : 's need'} a comment` : ''}.</p>
          <div className="row wrap">
            <button className="btn btn-green" disabled={busy || !canSave} onClick={() => void submit({ items: waiting.map((q: any) => ({ questionId: q.id, decision: get(q.id).decision, note: get(q.id).note.trim() || undefined })), note: bankNote.trim() || undefined }, 'Decisions saved and the teacher notified')}>Save decisions</button>
            <button className="btn" disabled={busy} onClick={() => setAsk('approve')}>Approve all {waiting.length}</button>
            <button className="btn btn-danger" disabled={busy} onClick={() => { setReturnNote(bankNote); setAsk('return'); }}>Return all with a comment…</button>
          </div>
        </div></section>)}
      {d.status !== 'SUBMITTED' && <Notice><span data-testid="review-closed">{d.status === 'APPROVED' ? 'This question bank is approved.' : 'This question bank was returned to the teacher. It appears here again when they submit it.'}</span></Notice>}

      <section aria-label="History" className="plain-section"><details data-testid="bank-activity"><summary><b>History of this question bank</b></summary>
        {d.activity.length ? <ul className="plain-list">{d.activity.map((a: any, n: number) => <li key={n}>{auditLabel(a.action)}{a.note ? <> — “{a.note}”</> : null}<div className="small faint">{fmtDT(a.at)} · {a.actor}</div></li>)}</ul> : <p className="muted small">Nothing recorded yet.</p>}
      </details></section>

      {ask === 'approve' && <Modal title={`Approve all ${waiting.length} questions?`} onClose={() => setAsk(null)} footer={<><CancelButton /><button className="btn btn-green" disabled={busy} onClick={() => void submit({ decision: 'APPROVE', note: bankNote.trim() || undefined }, 'Question bank approved')}>Approve all</button></>}>
        <p style={{ margin: 0 }}>Every question waiting in this bank is approved and becomes available for examination papers. The teacher is notified.</p></Modal>}
      {ask === 'return' && <Modal title={`Return all ${waiting.length} questions?`} onClose={() => setAsk(null)} missing={returnNote.trim() ? [] : ['A comment for the teacher']} footer={<><CancelButton /><button className="btn btn-primary" disabled={busy || !returnNote.trim()} onClick={() => void submit({ decision: 'REJECT', note: returnNote.trim() }, 'Question bank returned to the teacher')}>Return to the teacher</button></>}>
        <Field label="Comment for the teacher" required hint="The teacher sees this and edits the questions before submitting again."><textarea className="in" rows={4} maxLength={2000} value={returnNote} onChange={(e) => setReturnNote(e.target.value)} /></Field></Modal>}
    </div>
  );
}
