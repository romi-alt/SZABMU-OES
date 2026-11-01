'use client';
import { BrandLogo } from '@/brand';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ApiError, fmtDT, get, openStream, post } from '@/api';
import { ExamEngine, paletteKind } from '@/exam-engine';
import { useMe } from '@/session';
import { NotEligibleNotice, type NotEligible } from '@/exam-status-ui';
import { describeExam } from '@oes/shared';
import { Loading, Modal, Notice, errMsg } from '@/ui';
import { QuestionPalette, GLYPH, labelFor, type Filter, type PalItem } from './palette';

interface Q { id: string; number: number; position: number; marks: number; type: string; vignette: string | null; stem: string; options: { label: string; text: string }[] }
interface Receipt { receiptCode: string; submittedAt: string; answered: number; total: number; status: string; replayed?: boolean; late?: boolean }

const pad = (n: number) => String(n).padStart(2, '0');
const clock = (ms: number) => { const s = Math.ceil(ms / 1000); const h = Math.floor(s / 3600); return `${h ? pad(h) + ':' : ''}${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`; };
const uid = () => (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/[^A-Za-z0-9_-]/g, '');

export default function ExamPage() {
  const { examId } = useParams<{ examId: string }>(); const router = useRouter(); const { me, loading } = useMe();
  const [info, setInfo] = useState<any>(null); const [notElig, setNotElig] = useState<NotEligible[]>([]); const [error, setError] = useState(''); const [starting, setStarting] = useState(false);
  const [session, setSession] = useState<{ engine: ExamEngine; questions: Q[]; exam: any; attemptId: string } | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [lobby, setLobby] = useState<{ status: string } | null>(null);
  const clientId = useRef('');
  if (!clientId.current && typeof window !== 'undefined') {
    // one id per browser tab: a second tab/device gets a different id and takes over the attempt
    clientId.current = sessionStorage.getItem('oes:client') ?? `c${uid()}`; sessionStorage.setItem('oes:client', clientId.current);
  }

  useEffect(() => { if (loading || !me) return; get('/me/exams').then((d) => { setNotElig((d.notEligible ?? []).filter((x: { examId: string }) => x.examId === examId)); setInfo(d.items.find((x: any) => x.examId === examId) ?? false); }).catch((e) => setError(errMsg(e))); }, [examId, me, loading]);

  const begin = useCallback(async () => {
    setStarting(true); setError('');
    try {
      const r = await post('/attempts/start', { examId, clientId: clientId.current });
      const engine = new ExamEngine(r.attempt.id, clientId.current, r.questions.map((q: Q) => q.id), r.answers, r.attempt.deadlineAt, r.serverNow);
      engine.suspended = !!r.control?.suspended; engine.examStatus = r.control?.examStatus ?? '';
      setLobby(null); setSession({ engine, questions: r.questions, exam: r.exam, attemptId: r.attempt.id });
      try { sessionStorage.setItem(`oes:run:${examId}`, '1'); } catch { /* storage unavailable */ }
    } catch (e) {
      if (e instanceof ApiError && e.code === 'WAITING_FOR_START') { setLobby({ status: e.body?.status ?? 'ADMISSION_OPEN' }); }
      else if (e instanceof ApiError && e.code === 'ALREADY_SUBMITTED') { try { sessionStorage.removeItem(`oes:run:${examId}`); } catch { /* */ } setReceipt({ receiptCode: e.body.receiptCode, submittedAt: e.body.submittedAt, answered: 0, total: 0, status: 'SUBMITTED' }); }
      else setError(errMsg(e));
    } finally { setStarting(false); }
  }, [examId]);

  useEffect(() => () => session?.engine.dispose(), [session]);

  // Reloading the page of an examination you are sitting resumes it directly, with a one-line notice (UI-040). Only a genuine reload of this tab does:
  // arriving from the schedule still shows the instructions, and another device or window is never taken over silently.
  const autoTried = useRef(false); const [resumedNote, setResumedNote] = useState('');
  useEffect(() => {
    if (autoTried.current || !info || session || receipt || lobby || starting) return;
    let reloaded = false, ran = false;
    try { reloaded = (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type === 'reload'; ran = sessionStorage.getItem(`oes:run:${examId}`) === '1'; } catch { /* */ }
    if (reloaded && ran && info.canStart && info.attempt?.status === 'IN_PROGRESS') { autoTried.current = true; setResumedNote('Welcome back — you were taken straight to your examination. Your saved answers and the server clock are unchanged.'); void begin(); }
  }, [info, session, receipt, lobby, starting, examId, begin]);

  // Synchronized exam: the candidate waits in the lobby; the server pushes EXAM_STARTED (events are hints — we re-ask the server, which decides).
  useEffect(() => {
    if (!lobby) return;
    const go = () => { void begin(); };
    const close = openStream(`/me/exams/${examId}/stream`, { event: (name) => { if (name === 'EXAM_STARTED' || name === 'resync') go(); } });
    const poll = setInterval(async () => { try { const st = await get(`/me/exams/${examId}/state`); if (st.status === 'LIVE') go(); } catch { /* keep waiting */ } }, 10_000);
    return () => { close(); clearInterval(poll); };
  }, [lobby, examId, begin]);

  if (loading || !me) return <div style={{ padding: 40 }}><Loading /></div>;
  if (receipt) return <ReceiptView receipt={receipt} attemptId={session?.attemptId} examTitle={session?.exam?.title ?? info?.title} onDone={() => router.push('/dashboard')} />;
  if (session) return <Player key={session.attemptId} {...session} clientId={clientId.current} initialMsg={resumedNote} onSubmitted={(r) => { session.engine.clearBuffer(); session.engine.dispose(); try { sessionStorage.removeItem(`oes:run:${examId}`); } catch { /* */ } setReceipt(r); }} onTakeover={() => { session.engine.dispose(); setSession(null); void begin(); }} />;
  if (lobby) return <Shell><h1>{info?.title ?? 'Examination'}</h1><div className="card" role="status" data-testid="lobby"><div className="card-b stack"><h2>You are admitted — waiting for the examination to start</h2><p className="muted" style={{ margin: 0 }}>The examination office starts this paper for every candidate at the same time. Stay on this page: it will open automatically. Your clock begins when the examination starts, not before.</p></div></div></Shell>;
  if (info === false) return <Shell>{notElig.length ? <NotEligibleNotice items={notElig} /> : <Notice tone="bad">You are not registered for this examination.</Notice>}<Link href="/schedule">Back to schedule</Link></Shell>;
  if (!info) return <Shell>{error ? <Notice tone="bad">{error}</Notice> : <Loading />}</Shell>;

  const resuming = info.attempt?.status === 'IN_PROGRESS';
  return (
    <Shell>
      <h1>{info.title}</h1>
      <p className="muted" style={{ margin: '4px 0 16px' }}>{info.course.title} · {info.questionCount} questions · {info.totalMarks} marks · {info.durationMin} minutes</p>
      <div className="card"><div className="card-h"><h2>Before you begin</h2></div><div className="card-b stack">
        {info.instructions && <p style={{ margin: 0 }}>{info.instructions}</p>}
        <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.8 }}>
          <li>Each question has one best answer. {info.negativeMarking > 0 ? `A wrong answer loses ${info.negativeMarking * 100}% of the question's marks.` : 'There is no negative marking.'}</li>
          <li>The countdown is controlled by the server. Closing the page does not pause it.</li>
          <li>Answers save automatically. A question shows <b>Saved</b> only after the server has stored it. If your connection drops, keep working — answers are retried automatically.</li>
          <li>Do not open the examination in a second window; the newest window takes over and the older one stops saving.</li>
          <li>Review your answers and confirm before submitting. You receive a receipt code on submission.</li>
        </ul>
        {error && <Notice tone="bad">{error}</Notice>}
        {!info.canStart && !error && (() => { const p = describeExam(info, new Date(), (d) => fmtDT(d)); return <Notice tone="warn"><b>{p.label}.</b> {p.detail}</Notice>; })()}
        <div className="row"><button className="btn btn-green" disabled={!info.canStart || starting} onClick={begin}>{starting ? 'Starting…' : resuming ? 'Resume examination →' : 'Begin examination →'}</button><Link className="btn" href="/schedule">Back</Link></div>
      </div></div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main id="main" style={{ maxWidth: 760, margin: '0 auto', padding: '32px 20px' }}><BrandLogo plate className="shell-logo" />{children}</main>;
}

function Player({ engine, questions, exam, attemptId, clientId, initialMsg = '', onSubmitted, onTakeover }: { initialMsg?: string; engine: ExamEngine; questions: Q[]; exam: any; attemptId: string; clientId: string; onSubmitted: (r: Receipt) => void; onTakeover: () => void }) {
  useSyncExternalStore(engine.subscribe, engine.getVersion, engine.getVersion);
  const [idx, setIdx] = useState(0); const [filter, setFilter] = useState<Filter>('all'); const [view, setView] = useState<'q' | 'review'>('q');
  const [layout, setLayout] = useState<'single' | 'all'>(() => (typeof window !== 'undefined' && sessionStorage.getItem('oes:layout') === 'all' ? 'all' : 'single'));
  const chooseLayout = (l: 'single' | 'all') => { setLayout(l); setView('q'); sessionStorage.setItem('oes:layout', l); };
  const [palOpen, setPalOpen] = useState(false); const [remaining, setRemaining] = useState(engine.remainingMs()); const [msg, setMsg] = useState(initialMsg);
  const submitKey = useRef(''); if (!submitKey.current) { submitKey.current = sessionStorage.getItem(`oes:sk:${attemptId}`) ?? `sk${uid()}`; sessionStorage.setItem(`oes:sk:${attemptId}`, submitKey.current); }
  const q = questions[idx]!; const st = engine.get(q.id); const counts = engine.counts();
  const timeUp = useRef(false);
  const asideRef = useRef<HTMLElement>(null); const toggleRef = useRef<HTMLButtonElement>(null); const wasOpen = useRef(false); const [isSheet, setIsSheet] = useState(false);
  const ss = engine.saveStatus(); const numOf = new Map(questions.map((x) => [x.id, x.number])); const qList = (ids: string[]) => ids.map((id) => numOf.get(id)).filter((n): n is number => !!n).sort((a, b) => a - b).join(', ');
  useEffect(() => { const m = window.matchMedia('(max-width: 960px)'); const f = () => setIsSheet(m.matches); f(); m.addEventListener('change', f); return () => m.removeEventListener('change', f); }, []);
  // the palette sheet is a dialog on small screens: focus moves into it on open, Escape closes it, focus returns to the "Questions" button
  useEffect(() => { if (palOpen) asideRef.current?.focus(); else if (wasOpen.current) toggleRef.current?.focus(); wasOpen.current = palOpen; }, [palOpen]);
  useEffect(() => { if (!palOpen) return; const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setPalOpen(false); }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [palOpen]);
  // the sticky palette sits below the sticky header, whatever height the header has
  useEffect(() => { const el = document.querySelector('.exam-bar') as HTMLElement | null; if (!el || typeof ResizeObserver === 'undefined') return; const set = () => document.documentElement.style.setProperty('--exam-bar-h', `${el.offsetHeight}px`); set(); const ro = new ResizeObserver(set); ro.observe(el); return () => ro.disconnect(); }, []);
  const [ctlMsg, setCtlMsg] = useState('');

  // Live control: authoritative state arrives with every heartbeat; an SSE event just makes us ask NOW instead of in ≤15 s.
  useEffect(() => { void engine.heartbeat(); }, [engine]);
  useEffect(() => {
    const note = (name: string, extendedMs?: number) => {
      if (name === 'EXAM_SUSPENDED') setCtlMsg('The examination has been suspended by the examination office. Your saved answers are safe.');
      else if (name === 'EXAM_RESUMED') setCtlMsg('The examination has resumed. Your remaining time is shown above.');
      else if (name === 'DEADLINE_EXTENDED') setCtlMsg(extendedMs && extendedMs > 0 ? `Your time has been extended by ${Math.round(extendedMs / 60000)} minute(s).` : 'The examination time was extended.');
      else if (name === 'EXAM_CLOSING') setCtlMsg('The examination is closing. Finish and submit your answers.');
      else if (name === 'ADMISSION_CLOSED') setCtlMsg('Admission has closed for late arrivals. Your own attempt is not affected.');
      else if (name === 'EXAM_CLOSED') setCtlMsg('The examination has been closed.');
    };
    return openStream(`/me/exams/${exam.id}/stream`, { event: (name) => { if (name === 'state') return; void engine.heartbeat().then((r) => note(name, r?.extendedMs)); } });
  }, [engine, exam.id]);

  useEffect(() => { if (layout === 'single') engine.visit(q.id); }, [engine, q.id, layout]);
  useEffect(() => { const t = setInterval(() => setRemaining(engine.remainingMs()), 250); return () => clearInterval(t); }, [engine]);

  const fetchReceipt = useCallback(async () => { const r = await get(`/attempts/${attemptId}/receipt`); onSubmitted(r); }, [attemptId, onSubmitted]);
  useEffect(() => { // time is up (server clock) or attempt closed elsewhere → settle and show receipt
    if ((remaining <= 0 || engine.phase === 'closed') && !timeUp.current) {
      timeUp.current = true; setMsg('Time is up. Submitting your saved answers…');
      void (async () => { await engine.flushAll(4000); for (let i = 0; i < 20; i++) { const h = await engine.heartbeat(); if (h && h.status !== 'IN_PROGRESS') break; await new Promise((r) => setTimeout(r, 1500)); } try { await fetchReceipt(); } catch { setMsg('Your time has ended. Your saved answers are being finalised — refresh to see your receipt.'); } })();
    }
  }, [remaining, engine, fetchReceipt, engine.phase]);

  const go = useCallback((n: number) => {
    const i = Math.max(0, Math.min(questions.length - 1, n)); setIdx(i); setView('q');
    if (layout === 'all') setTimeout(() => document.getElementById(`q-${questions[i]!.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30);
  }, [questions, layout]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (view !== 'q' || layout !== 'single' || (e.target as HTMLElement)?.tagName === 'TEXTAREA' || e.ctrlKey || e.metaKey) return;
      if (e.key === 'ArrowRight') go(idx + 1); else if (e.key === 'ArrowLeft') go(idx - 1);
      else if (/^g$/i.test(e.key) && !e.altKey && !(e.target as HTMLElement)?.closest?.('input,select,textarea,[role=dialog]')) { e.preventDefault(); if (isSheet) setPalOpen(true); setTimeout(() => document.getElementById('jump-input')?.focus(), 60); }
      else if (/^[a-e]$/i.test(e.key) && q.options.some((o) => o.label === e.key.toUpperCase())) engine.select(q.id, e.key.toUpperCase());
    };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, [engine, go, idx, q, view, layout, isSheet]);

  const all = useMemo<PalItem[]>(() => questions.map((x, i) => { const t = engine.get(x.id); return { id: x.id, number: x.number, index: i, kind: paletteKind(t), marked: t.marked, unsynced: t.rev > t.savedRev }; }), [questions, engine.getVersion()]);
  const visible = useMemo(() => all.filter(({ kind, marked }) => filter === 'all' || (filter === 'marked' ? marked : kind === filter)), [all, filter]);

  // Saving is automatic and never blocks navigation: Next gives pending saves a short head start, then carries on (UI-004). One forward action (UI-016).
  function nextQuestion() { go(idx + 1); void engine.flushAll(1200); }          // moves at once; any pending save is nudged along in the background and stays tracked until confirmed
  async function openReview() {
    await engine.flushAll(1500);                                   // normal case: everything is confirmed before the screen opens
    if (engine.pendingCount() === 0) { const bad = await engine.reconcile().catch(() => null); setMsg(bad && bad.length ? `${bad.length} answer(s) differed from what the server holds and were refreshed. Please review.` : ''); }
    else setMsg('');                                               // never reconcile over unconfirmed local edits; the review screen lists them
    setView('review'); setPalOpen(false);
  }

  const sync = st.sync; const saved = sync === 'saved' && st.savedRev > 0;
  const unconfirmedText = ss.state === 'offline_pending' ? 'Not saved — offline, will retry' : ss.state === 'not_confirmed' ? 'Not confirmed by the server — retrying' : ss.state === 'reconciliation_required' ? 'Checking with the server…' : 'Not yet saved — retrying';
  const indicator = engine.phase !== 'running' ? { c: 'bad', t: 'Not saving' } : sync === 'error' ? { c: 'bad', t: 'Could not save — contact the invigilator' } : saved ? { c: 'ok', t: '✓ Saved' } : sync === 'saving' && ss.state === 'saving' ? { c: 'wait', t: 'Saving…' } : st.rev === 0 ? { c: '', t: '' } : st.rev > st.savedRev && ss.state === 'saving' ? { c: 'wait', t: 'Saving…' } : { c: ss.state === 'retrying' ? 'wait' : 'bad', t: unconfirmedText };

  if (engine.phase === 'superseded') return (
    <Modal title="Examination open in another window" onClose={() => undefined} footer={<button className="btn btn-primary" onClick={onTakeover}>Use this window instead</button>}>
      <p>This attempt was opened in another browser window or device, which now controls it. This window has stopped saving to protect your answers.</p>
      <p className="muted">If you want to continue here, choose <b>Use this window</b>. The other window will then stop saving.</p>
    </Modal>);

  const low = remaining < 5 * 60_000;
  return (
    <div className="exam">
      <header className="exam-bar">
        <BrandLogo className="exam-logo" />
        <div className="grow exam-title"><h1 className="title">{exam.title}</h1><div className="small muted">{questions.length} questions · {exam.totalMarks} marks</div></div>
        <div className="small muted exam-answered" aria-live="polite">Answered <b className="mono" style={{ color: 'var(--ink)' }}>{counts.answered}</b> / {questions.length}</div>
        <div className={`exam-clock ${low ? 'low' : ''}`} role="timer" aria-label="Time remaining"><div className="k">Remaining</div><div className="v" data-testid="remaining">{clock(remaining)}</div></div>
        <button ref={toggleRef} className="btn pal-toggle" data-testid="palette-toggle" aria-expanded={palOpen} aria-controls="question-navigator" onClick={() => setPalOpen(!palOpen)}>Questions {counts.answered}/{questions.length}</button>
        <button className="btn btn-primary" onClick={openReview} disabled={engine.suspended}>Review &amp; submit</button>
      </header>
      {!engine.online && <div className="conn off" role="alert">Connection lost. Keep working — your answers are held on this device and are saved automatically once the connection returns. {engine.pendingCount()} not yet saved.</div>}
      {(ss.state === 'not_confirmed' || ss.state === 'reconciliation_required') && ss.pendingIds.length > 0 && (
        <div className="conn off" role="alert" data-testid="save-banner"><b>{ss.pendingIds.length === 1 ? '1 answer is' : `${ss.pendingIds.length} answers are`} not confirmed by the server.</b> Question {qList(ss.pendingIds)}. {ss.state === 'reconciliation_required' ? 'We could not check what the server holds yet. ' : ''}Your choice is kept on this device and retried automatically — keep this window open. <button className="btn btn-sm" onClick={() => void engine.retryNow()}>Retry now</button> <button className="btn btn-sm" onClick={() => void openReview()}>Review unconfirmed answers</button></div>)}
      {ss.refreshedIds.length > 0 && <div className="conn" style={{ background: '#FFFBEF', borderBottom: '1px solid #EBD9A8' }} role="status" data-testid="refreshed-banner">The server held a different, newer copy of {ss.refreshedIds.length === 1 ? 'one answer' : `${ss.refreshedIds.length} answers`} (Question {qList(ss.refreshedIds)}); {ss.refreshedIds.length === 1 ? 'it was' : 'they were'} updated to match. Please check {ss.refreshedIds.length === 1 ? 'it' : 'them'}. <button className="btn-link small" onClick={() => engine.dismissRefreshed()}>Dismiss</button></div>}
      {msg && <div className="conn" style={{ background: '#FFFBEF', borderBottom: '1px solid #EBD9A8' }} role="status">{msg}</div>}
      {ctlMsg && <div className="conn" style={{ background: '#EEF6F1', borderBottom: '1px solid #BBD9C8' }} role="status" data-testid="control-message">{ctlMsg} <button className="btn-link small" onClick={() => setCtlMsg('')}>Dismiss</button></div>}
      {engine.suspended && <div className="conn off" role="alert" data-testid="suspended-banner"><b>Examination suspended.</b> You cannot answer or submit until it resumes. Do not close this window — your saved answers are safe and it resumes automatically.</div>}
      <main className="exam-body" id="main" style={engine.suspended ? { opacity: 0.5, pointerEvents: 'none' } : undefined} aria-disabled={engine.suspended}>
        <div className="stack" style={{ minWidth: 0 }}>
        <div className="row layout-toggle no-print" role="group" aria-label="Question layout">
          <span className="small muted">View</span>
          <button className={`btn btn-sm ${layout === 'single' ? 'btn-primary' : ''}`} aria-pressed={layout === 'single'} onClick={() => chooseLayout('single')} data-testid="layout-single">One question at a time</button>
          <button className={`btn btn-sm ${layout === 'all' ? 'btn-primary' : ''}`} aria-pressed={layout === 'all'} onClick={() => chooseLayout('all')} data-testid="layout-all">All questions on one page</button>
        </div>
        {view === 'q' && layout === 'all' ? (
          <div className="stack" data-testid="all-questions" style={{ gap: 16 }}>
            {questions.map((x, i) => <QuestionBlock key={x.id} engine={engine} q={x} total={questions.length} current={i === idx} onFocus={() => setIdx(i)} />)}
            <div className="card"><div className="card-b row"><span className="small muted">{counts.answered} of {questions.length} answered. Answers save automatically as you choose them.</span><span className="grow" /><button className="btn btn-primary" onClick={openReview}>Review &amp; submit</button></div></div>
          </div>
        ) : view === 'q' ? (
          <section className="q-card" aria-label={`Question ${q.number}`}>
            <div className="q-head"><span>QUESTION {pad(q.number)} / {questions.length}{q.type === 'CLINICAL_MCQ' ? ' · CLINICAL' : ''}</span><span>{q.marks} MARK{q.marks === 1 ? '' : 'S'}</span></div>
            <div className="q-body">
              {q.vignette && <div className="vignette">{q.vignette}</div>}
              <div className="q-stem" id="stem">{q.stem}</div>
              <div role="radiogroup" aria-labelledby="stem" className="stack" style={{ gap: 10 }}>
                {q.options.map((o) => <button key={o.label} role="radio" aria-checked={st.selectedLabel === o.label} className="opt" onClick={() => engine.select(q.id, o.label)} data-testid={`opt-${o.label}`}><span className="radio" /><span className="lab">{o.label}</span><span>{o.text}</span></button>)}
              </div>
            </div>
            <div className="q-foot">
              <button className="btn" onClick={() => go(idx - 1)} disabled={idx === 0}>← Previous</button>
              <button className="btn" onClick={() => engine.toggleMark(q.id)} aria-pressed={st.marked}>{st.marked ? 'Unmark review' : 'Mark for review'}</button>
              <ClearResponse key={q.id} engine={engine} qid={q.id} selected={st.selectedLabel} />
              <span className="grow" />
              <span className={`save-state ${indicator.c}`} role="status" aria-live="polite" data-testid="save-state">{indicator.t}</span>
              {idx === questions.length - 1
                ? <button className="btn btn-green" onClick={() => void openReview()} data-testid="next-or-review">Review answers →</button>
                : <button className="btn btn-green" onClick={nextQuestion} data-testid="next-or-review">Next →</button>}
            </div>
          </section>
        ) : <ReviewView engine={engine} questions={questions} attemptId={attemptId} clientId={clientId} submitKey={submitKey.current} onBack={(n) => go(n ?? idx)} onSubmitted={onSubmitted} />}
        </div>

        <aside ref={asideRef} tabIndex={-1} className={`stack pal-aside ${palOpen ? 'open' : ''}`} id="question-navigator" aria-label="Question navigator" role={isSheet && palOpen ? 'dialog' : undefined} aria-modal={isSheet && palOpen ? true : undefined}>
          <button type="button" className="btn btn-sm pal-close" onClick={() => setPalOpen(false)}>Close ✕</button>
          <QuestionPalette items={visible} all={all} total={questions.length} current={idx} inView={view === 'q'} counts={counts} filter={filter} setFilter={setFilter} onGo={(i) => { go(i); setPalOpen(false); }} sheet={isSheet} />
          <div className="notice small">Press <b className="mono">A–E</b> to choose an option, <b className="mono">←</b> <b className="mono">→</b> to move and <b className="mono">G</b> to go to a question number. Answers save automatically.</div>
        </aside>
        {palOpen && <div className="nav-scrim pal-scrim" onClick={() => setPalOpen(false)} aria-hidden />}
      </main>
    </div>
  );
}

function QuestionBlock({ engine, q, total, current, onFocus }: { engine: ExamEngine; q: Q; total: number; current: boolean; onFocus: () => void }) {
  const st = engine.get(q.id); const ref = useRef<HTMLElement>(null);
  // "visited" is recorded when the question has actually been on screen, so the palette stays honest
  useEffect(() => {
    const el = ref.current; if (!el || typeof IntersectionObserver === 'undefined') { engine.visit(q.id); return; }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { engine.visit(q.id); io.disconnect(); } }, { threshold: 0.4 });
    io.observe(el); return () => io.disconnect();
  }, [engine, q.id]);
  const ind = engine.phase !== 'running' ? { c: 'bad', t: 'Not saving' } : st.sync === 'error' ? { c: 'bad', t: 'Could not save' } : st.sync === 'saved' && st.savedRev > 0 ? { c: 'ok', t: '✓ Saved' } : st.sync === 'saving' ? { c: 'wait', t: 'Saving…' } : st.rev === 0 ? { c: '', t: '' } : { c: 'wait', t: 'Not yet saved — retrying' };
  return (
    <section ref={ref} id={`q-${q.id}`} className={`q-card ${current ? 'q-current' : ''}`} aria-label={`Question ${q.number}`} onFocusCapture={onFocus} style={{ scrollMarginTop: 90 }}>
      <div className="q-head"><span>QUESTION {pad(q.number)} / {total}{q.type === 'CLINICAL_MCQ' ? ' · CLINICAL' : ''}</span><span>{q.marks} MARK{q.marks === 1 ? '' : 'S'}</span></div>
      <div className="q-body">
        {q.vignette && <div className="vignette">{q.vignette}</div>}
        <div className="q-stem" id={`stem-${q.id}`}>{q.stem}</div>
        <div role="radiogroup" aria-labelledby={`stem-${q.id}`} className="stack" style={{ gap: 10 }}>
          {q.options.map((o) => <button key={o.label} role="radio" aria-checked={st.selectedLabel === o.label} className="opt" onClick={() => { onFocus(); engine.select(q.id, o.label); }} data-testid={`all-opt-${q.number}-${o.label}`}><span className="radio" /><span className="lab">{o.label}</span><span>{o.text}</span></button>)}
        </div>
      </div>
      <div className="q-foot">
        <button className="btn" onClick={() => engine.toggleMark(q.id)} aria-pressed={st.marked}>{st.marked ? 'Unmark review' : 'Mark for review'}</button>
        <ClearResponse key={q.id} engine={engine} qid={q.id} selected={st.selectedLabel} />
        <span className="grow" />
        <span className={`save-state ${ind.c}`} role="status" aria-live="polite">{ind.t}</span>
      </div>
    </section>
  );
}

function ReviewView({ engine, questions, attemptId, clientId, submitKey, onBack, onSubmitted }: { engine: ExamEngine; questions: Q[]; attemptId: string; clientId: string; submitKey: string; onBack: (n?: number) => void; onSubmitted: (r: Receipt) => void }) {
  const [agree, setAgree] = useState(false); const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [confirm, setConfirm] = useState(false); const [waiting, setWaiting] = useState(false); const cancelled = useRef(false);
  const c = engine.counts(); const ss = engine.saveStatus(); const pending = ss.pendingIds; const idxOf = new Map(questions.map((x, i) => [x.id, i]));
  const pendingNums = pending.map((id) => ({ id, i: idxOf.get(id) ?? 0, n: questions[idxOf.get(id) ?? 0]?.number ?? 0 })).sort((a, b) => a.n - b.n);
  const items: PalItem[] = questions.map((x, i) => { const t = engine.get(x.id); return { id: x.id, number: x.number, index: i, kind: paletteKind(t), marked: t.marked, unsynced: t.rev > t.savedRev }; });
  const left = clock(engine.remainingMs());
  // Submission is the authoritative step. Anything the server has not confirmed is NOT part of `expected` and will not be counted — the candidate is told exactly which
  // questions, gets a bounded, cancellable attempt to confirm them first, and must acknowledge before submitting without them. Nothing is dropped silently.
  async function submit() {
    setBusy(true); setErr(''); cancelled.current = false;
    if (engine.pendingCount() > 0) {
      setWaiting(true); await engine.retryNow(); await engine.flushAll(15000, () => cancelled.current); setWaiting(false);
      if (cancelled.current) { setBusy(false); return; }
    }
    const unconfirmed = engine.pendingCount();
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const r = await post(`/attempts/${attemptId}/submit`, { clientId, submitKey, expected: engine.expected() });
        onSubmitted(r); return;
      } catch (e) {
        if (e instanceof ApiError && e.code === 'ANSWERS_OUT_OF_SYNC') { await engine.reconcile(); setBusy(false); setConfirm(false); setErr('Some answers on screen differed from what is stored; they have been refreshed. Please review and submit again.'); return; }
        if (e instanceof ApiError && e.code === 'SESSION_SUPERSEDED') { setBusy(false); setErr('This examination is open in another window.'); return; }
        if (e instanceof ApiError && e.status < 500 && e.status !== 429) { setBusy(false); setErr(errMsg(e)); return; }
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1))); // network/5xx: retry with the SAME submit key (idempotent)
      }
    }
    setBusy(false); setErr(unconfirmed ? `Could not reach the server, so nothing was submitted. ${unconfirmed} answer(s) are still not confirmed. You have ${left} left — press Submit again when the connection returns.` : 'Could not reach the server, so nothing was submitted. Your confirmed answers are safe; press Submit again when the connection returns.');
  }
  return (
    <section className="card" aria-label="Review answers">
      <div className="card-h"><h2>Review your answers</h2><div className="row"><span className="small muted" data-testid="review-time-left">Time left <b className="mono">{left}</b></span><button className="btn btn-sm" onClick={() => onBack()}>← Back to questions</button></div></div>
      <div className="card-b stack">
        <div className="grid g4"><Cnt k="Answered" v={c.answered} /><Cnt k="Not answered" v={c.skipped + c.unanswered} /><Cnt k="Not visited" v={c.notvisited} /></div>
        {pending.length > 0
          ? <Notice tone="warn"><div data-testid="review-unconfirmed" role="status"><b>{pending.length === 1 ? '1 answer is' : `${pending.length} answers are`} not confirmed by the server yet.</b> They are kept on this device and retried automatically; until the server confirms them they are <b>not</b> counted as saved.{' '}
            {pendingNums.map((p, k) => <span key={p.id}>{k ? ', ' : ''}<button className="btn-link" onClick={() => onBack(p.i)}>Question {p.n}</button></span>)}. <button className="btn btn-sm" onClick={() => void engine.retryNow()} data-testid="review-retry">Retry saving now</button></div></Notice>
          : <p className="small muted" data-testid="review-all-confirmed" role="status">✓ Every answer on this screen is confirmed by the server.</p>}
        {c.marked > 0 && <Notice tone="warn">{c.marked} question(s) are marked for review.</Notice>}
        {(c.skipped + c.unanswered + c.notvisited) > 0 && <Notice tone="warn">{c.skipped + c.unanswered + c.notvisited} question(s) have no answer. Select a number to return to it.</Notice>}
        <ul className="pal pal-review" aria-label="All questions">{items.map((x) => <li key={x.id}><button type="button" className={`${x.kind} ${x.marked ? 'marked' : ''} ${x.unsynced ? 'unsynced' : ''}`} onClick={() => onBack(x.index)} aria-label={labelFor(x)}><span className="g" aria-hidden>{x.unsynced ? '!' : GLYPH[x.kind]}</span>{pad(x.number)}</button></li>)}</ul>
        {err && <Notice tone="bad">{err}</Notice>}
        <div className="row"><button className="btn btn-primary" onClick={() => { setAgree(false); setConfirm(true); }} disabled={busy}>Submit examination…</button><span className="small muted">You cannot change answers after submission.</span></div>
      </div>
      {confirm && <Modal title="Submit examination?" onClose={() => { if (waiting) { cancelled.current = true; } if (!busy || waiting) setConfirm(false); }} footer={<><button className="btn" onClick={() => { cancelled.current = true; setConfirm(false); }} disabled={busy && !waiting}>{waiting ? 'Stop waiting' : 'Cancel'}</button><button className="btn btn-primary" disabled={!agree || busy} onClick={submit} data-testid="confirm-submit">{busy ? (waiting ? 'Confirming answers…' : 'Submitting…') : 'Confirm and submit'}</button></>}>
        <p>You answered <b>{c.answered}</b> of <b>{questions.length}</b> questions. {questions.length - c.answered > 0 ? `${questions.length - c.answered} will be marked as unanswered.` : ''} Time left: <b className="mono">{left}</b>.</p>
        {pending.length > 0 && <Notice tone="bad"><div role="alert" data-testid="confirm-unconfirmed"><b>Not confirmed by the server: Question {pendingNums.map((p) => p.n).join(', ')}.</b> These answers are not stored. If you submit now they <b>will not be counted</b>. We will first try for up to 15 seconds to confirm them; you can also <button className="btn btn-sm" onClick={() => void engine.retryNow()}>retry now</button> or cancel and go back.</div></Notice>}
        {waiting && <p role="status" aria-live="polite" className="small">Confirming {engine.pendingCount()} answer(s) with the server… you can stop waiting at any time.</p>}
        <label className="row" style={{ alignItems: 'flex-start' }}><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> <span>{pending.length > 0 ? `I understand that ${pending.length === 1 ? 'this answer' : 'these answers'} will not be counted unless the server confirms ${pending.length === 1 ? 'it' : 'them'}, and that submission is final.` : 'I have reviewed my answers and understand that submission is final.'}</span></label>
        {err && <Notice tone="bad">{err}</Notice>}
      </Modal>}
    </section>
  );
}
/** Clearing a saved answer is reversible for 10 s: "Answer cleared. Undo" restores the previous choice (UI-015). */
function ClearResponse({ engine, qid, selected }: { engine: ExamEngine; qid: string; selected: string | null }) {
  const [undo, setUndo] = useState<string | null>(null);
  useEffect(() => { if (!undo) return; const t = setTimeout(() => setUndo(null), 10000); return () => clearTimeout(t); }, [undo]);
  return (
    <>
      <button className="btn" onClick={() => { if (selected) { setUndo(selected); engine.clear(qid); } }} disabled={!selected}>Clear response</button>
      {undo && !selected && <span role="status" className="small" data-testid="clear-undo">Answer cleared. <button className="btn-link" onClick={() => { engine.select(qid, undo); setUndo(null); }}>Undo</button></span>}
    </>
  );
}

const Cnt = ({ k, v }: { k: string; v: number }) => <div className="card stat"><div className="k">{k}</div><div className="v">{v}</div></div>;

function ReceiptView({ receipt, attemptId, examTitle, onDone }: { receipt: Receipt; attemptId?: string; examTitle?: string; onDone: () => void }) {
  const [full, setFull] = useState<any>(null);
  useEffect(() => { if (attemptId) get(`/attempts/${attemptId}/receipt`).then(setFull).catch(() => undefined); }, [attemptId]);
  const r = full ?? receipt;
  return (
    <Shell>
      <div className="card receipt" data-testid="receipt">
        <div className="badge b-green" style={{ marginBottom: 8 }}>{receipt.status === 'AUTO_SUBMITTED' ? 'Submitted automatically' : 'Submitted'}</div>
        <h1>Your examination has been submitted</h1>
        <p className="muted">{full?.exam?.title ?? examTitle}</p>
        <div className="code" data-testid="receipt-code">{r.receiptCode}</div>
        <p className="muted">Keep this receipt code. It proves what was stored at {fmtDT(r.submittedAt)}.</p>
        {r.total > 0 && <p><b>{r.answered}</b> of <b>{r.total}</b> questions answered.</p>}
        {receipt.status === 'AUTO_SUBMITTED' && <Notice tone="warn">Your time ended (or an invigilator ended the session), so your saved answers were submitted automatically.</Notice>}
        <div className="row no-print" style={{ justifyContent: 'center', marginTop: 16 }}><button className="btn" onClick={() => window.print()}>Print receipt</button><button className="btn btn-primary" onClick={onDone}>Back to dashboard</button></div>
      </div>
    </Shell>
  );
}
