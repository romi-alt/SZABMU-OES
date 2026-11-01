'use client';
import Image from 'next/image';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ApiError, fmtDT, get, openStream, post } from '@/api';
import { ExamEngine, paletteKind, type PaletteKind } from '@/exam-engine';
import { useMe } from '@/session';
import { Loading, Modal, Notice, errMsg } from '@/ui';
import type { MyExam, MyExamsDto } from '@oes/shared';

interface Q { id: string; number: number; position: number; marks: number; type: string; vignette: string | null; stem: string; options: { label: string; text: string }[] }
interface Receipt { receiptCode: string; submittedAt: string; answered: number; total: number; status: string; replayed?: boolean; late?: boolean }
type Filter = 'all' | PaletteKind | 'marked';

const pad = (n: number) => String(n).padStart(2, '0');
const clock = (ms: number) => { const s = Math.ceil(ms / 1000); const h = Math.floor(s / 3600); return `${h ? pad(h) + ':' : ''}${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`; };
const uid = () => (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/[^A-Za-z0-9_-]/g, '');

export default function ExamPage() {
  const { examId } = useParams<{ examId: string }>(); const router = useRouter(); const { me, loading } = useMe();
  const [info, setInfo] = useState<MyExam | false | null>(null); const [error, setError] = useState(''); const [starting, setStarting] = useState(false);
  const [session, setSession] = useState<{ engine: ExamEngine; questions: Q[]; exam: any; attemptId: string } | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [lobby, setLobby] = useState<{ status: string } | null>(null);
  const clientId = useRef('');
  if (!clientId.current && typeof window !== 'undefined') {
    // one id per browser tab: a second tab/device gets a different id and takes over the attempt
    clientId.current = sessionStorage.getItem('oes:client') ?? `c${uid()}`; sessionStorage.setItem('oes:client', clientId.current);
  }

  useEffect(() => { if (loading || !me) return; get<MyExamsDto>('/me/exams').then((d) => setInfo(d.items.find((x) => x.examId === examId) ?? false)).catch((e) => setError(errMsg(e))); }, [examId, me, loading]);

  const begin = useCallback(async () => {
    setStarting(true); setError('');
    try {
      const r = await post('/attempts/start', { examId, clientId: clientId.current });
      const engine = new ExamEngine(r.attempt.id, clientId.current, r.questions.map((q: Q) => q.id), r.answers, r.attempt.deadlineAt, r.serverNow);
      engine.suspended = !!r.control?.suspended; engine.examStatus = r.control?.examStatus ?? '';
      setLobby(null); setSession({ engine, questions: r.questions, exam: r.exam, attemptId: r.attempt.id });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'WAITING_FOR_START') { setLobby({ status: e.body?.status ?? 'ADMISSION_OPEN' }); }
      else if (e instanceof ApiError && e.code === 'ALREADY_SUBMITTED') { setReceipt({ receiptCode: e.body.receiptCode, submittedAt: e.body.submittedAt, answered: 0, total: 0, status: 'SUBMITTED' }); }
      else setError(errMsg(e));
    } finally { setStarting(false); }
  }, [examId]);

  useEffect(() => () => session?.engine.dispose(), [session]);

  // Synchronized exam: the candidate waits in the lobby; the server pushes EXAM_STARTED (events are hints — we re-ask the server, which decides).
  useEffect(() => {
    if (!lobby) return;
    const go = () => { void begin(); };
    const close = openStream(`/me/exams/${examId}/stream`, { event: (name) => { if (name === 'EXAM_STARTED' || name === 'resync') go(); } });
    const poll = setInterval(async () => { try { const st = await get(`/me/exams/${examId}/state`); if (st.status === 'LIVE') go(); } catch { /* keep waiting */ } }, 10_000);
    return () => { close(); clearInterval(poll); };
  }, [lobby, examId, begin]);

  if (loading || !me) return <div style={{ padding: 40 }}><Loading /></div>;
  if (receipt) return <ReceiptView receipt={receipt} attemptId={session?.attemptId} examTitle={session?.exam?.title ?? (info || undefined)?.title} onDone={() => router.push('/dashboard')} />;
  if (session) return <Player key={session.attemptId} {...session} clientId={clientId.current} onSubmitted={(r) => { session.engine.clearBuffer(); session.engine.dispose(); setReceipt(r); }} onTakeover={() => { session.engine.dispose(); setSession(null); void begin(); }} />;
  if (lobby) return <Shell><h1>{info?.title ?? 'Examination'}</h1><div className="card" role="status" data-testid="lobby"><div className="card-b stack"><h2>You are admitted — waiting for the examination to start</h2><p className="muted" style={{ margin: 0 }}>The examination office starts this paper for every candidate at the same time. Stay on this page: it will open automatically. Your clock begins when the examination starts, not before.</p></div></div></Shell>;
  if (info === false) return <Shell><Notice tone="bad">You are not registered for this examination.</Notice><Link href="/schedule">Back to schedule</Link></Shell>;
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
        {!info.canStart && !error && <Notice tone="warn">{info.attempt ? 'This examination is not available to resume.' : `Opens ${fmtDT(info.opensAt)}.`}</Notice>}
        <div className="row"><button className="btn btn-green" disabled={!info.canStart || starting} onClick={begin}>{starting ? 'Starting…' : resuming ? 'Resume examination →' : 'Begin examination →'}</button><Link className="btn" href="/schedule">Back</Link></div>
      </div></div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div style={{ maxWidth: 760, margin: '0 auto', padding: '32px 20px' }}><div style={{ background: '#fff', padding: 8, width: 260, borderRadius: 6, border: '1px solid var(--rose)', marginBottom: 24 }}><Image src="/logo.png" alt="SZABMU" width={398} height={100} /></div>{children}</div>;
}

function Player({ engine, questions, exam, attemptId, clientId, onSubmitted, onTakeover }: { engine: ExamEngine; questions: Q[]; exam: any; attemptId: string; clientId: string; onSubmitted: (r: Receipt) => void; onTakeover: () => void }) {
  useSyncExternalStore(engine.subscribe, engine.getVersion, engine.getVersion);
  const [idx, setIdx] = useState(0); const [filter, setFilter] = useState<Filter>('all'); const [view, setView] = useState<'q' | 'review'>('q');
  const [layout, setLayout] = useState<'single' | 'all'>(() => (typeof window !== 'undefined' && sessionStorage.getItem('oes:layout') === 'all' ? 'all' : 'single'));
  const chooseLayout = (l: 'single' | 'all') => { setLayout(l); setView('q'); sessionStorage.setItem('oes:layout', l); };
  const [remaining, setRemaining] = useState(engine.remainingMs()); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState('');
  const submitKey = useRef(''); if (!submitKey.current) { submitKey.current = sessionStorage.getItem(`oes:sk:${attemptId}`) ?? `sk${uid()}`; sessionStorage.setItem(`oes:sk:${attemptId}`, submitKey.current); }
  const q = questions[idx]!; const st = engine.get(q.id); const counts = engine.counts();
  const timeUp = useRef(false);
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
      else if (/^[a-e]$/i.test(e.key) && q.options.some((o) => o.label === e.key.toUpperCase())) engine.select(q.id, e.key.toUpperCase());
    };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, [engine, go, idx, q, view, layout]);

  const visible = useMemo(() => questions.map((x, i) => ({ x, i, k: paletteKind(engine.get(x.id)), m: engine.get(x.id).marked })).filter(({ k, m }) => filter === 'all' || (filter === 'marked' ? m : k === filter)),
    [questions, filter, engine.getVersion()]);

  async function saveAndNext() { setBusy(true); await engine.flushAll(8000); setBusy(false); go(idx + 1); }
  async function openReview() {
    setBusy(true); setMsg('Checking that every answer is stored…');
    const ok = await engine.flushAll(20000);
    if (!ok) { setBusy(false); setMsg(`${engine.pendingCount()} answer(s) could not be stored yet. Check your connection — they will keep retrying. Do not close this window.`); return; }
    const bad = await engine.reconcile().catch(() => null);
    setBusy(false); setMsg(bad && bad.length ? `${bad.length} answer(s) differed from what the server holds and were refreshed. Please review.` : '');
    setView('review');
  }

  const sync = st.sync; const saved = sync === 'saved' && st.savedRev > 0;
  const indicator = engine.phase !== 'running' ? { c: 'bad', t: 'Not saving' } : sync === 'error' ? { c: 'bad', t: 'Could not save — contact the invigilator' } : saved ? { c: 'ok', t: '✓ Saved' } : sync === 'saving' ? { c: 'wait', t: 'Saving…' } : st.rev === 0 ? { c: '', t: '' } : { c: 'wait', t: engine.online ? 'Not yet saved — retrying' : 'Not saved — offline, will retry' };

  if (engine.phase === 'superseded') return (
    <Modal title="Examination open in another window" onClose={() => undefined} footer={<button className="btn btn-primary" onClick={onTakeover}>Use this window instead</button>}>
      <p>This attempt was opened in another browser window or device, which now controls it. This window has stopped saving to protect your answers.</p>
      <p className="muted">If you want to continue here, choose <b>Use this window</b>. The other window will then stop saving.</p>
    </Modal>);

  const low = remaining < 5 * 60_000;
  return (
    <div className="exam">
      <header className="exam-bar">
        <div style={{ width: 168, flex: "none" }}><Image src="/logo.png" alt="SZABMU" width={398} height={100} style={{ width: '100%', height: 'auto' }} /></div>
        <div className="grow"><div className="title">{exam.title}</div><div className="small muted">{questions.length} questions · {exam.totalMarks} marks</div></div>
        <div className="small muted" aria-live="polite">Answered <b className="mono" style={{ color: 'var(--ink)' }}>{counts.answered}</b> / {questions.length}</div>
        <div className={`exam-clock ${low ? 'low' : ''}`} role="timer" aria-label="Time remaining"><div className="k">Remaining</div><div className="v" data-testid="remaining">{clock(remaining)}</div></div>
        <button className="btn btn-primary" onClick={openReview} disabled={busy || engine.suspended}>Review &amp; submit</button>
      </header>
      {!engine.online && <div className="conn off" role="alert">Connection lost. Keep working — your answers are held on this device and are saved automatically once the connection returns. {engine.pendingCount()} not yet saved.</div>}
      {msg && <div className="conn" style={{ background: '#FFFBEF', borderBottom: '1px solid #EBD9A8' }} role="status">{msg}</div>}
      {ctlMsg && <div className="conn" style={{ background: '#EEF6F1', borderBottom: '1px solid #BBD9C8' }} role="status" data-testid="control-message">{ctlMsg} <button className="btn-link small" onClick={() => setCtlMsg('')}>Dismiss</button></div>}
      {engine.suspended && <div className="conn off" role="alert" data-testid="suspended-banner"><b>Examination suspended.</b> You cannot answer or submit until it resumes. Do not close this window — your saved answers are safe and it resumes automatically.</div>}
      <div className="exam-body" style={engine.suspended ? { opacity: 0.5, pointerEvents: 'none' } : undefined} aria-disabled={engine.suspended}>
        <div className="stack" style={{ minWidth: 0 }}>
        <div className="row layout-toggle no-print" role="group" aria-label="Question layout">
          <span className="small muted">View</span>
          <button className={`btn btn-sm ${layout === 'single' ? 'btn-primary' : ''}`} aria-pressed={layout === 'single'} onClick={() => chooseLayout('single')} data-testid="layout-single">One question at a time</button>
          <button className={`btn btn-sm ${layout === 'all' ? 'btn-primary' : ''}`} aria-pressed={layout === 'all'} onClick={() => chooseLayout('all')} data-testid="layout-all">All questions on one page</button>
        </div>
        {view === 'q' && layout === 'all' ? (
          <div className="stack" data-testid="all-questions" style={{ gap: 16 }}>
            {questions.map((x, i) => <QuestionBlock key={x.id} engine={engine} q={x} total={questions.length} current={i === idx} onFocus={() => setIdx(i)} />)}
            <div className="card"><div className="card-b row"><span className="small muted">{counts.answered} of {questions.length} answered. Answers save automatically as you choose them.</span><span className="grow" /><button className="btn btn-primary" onClick={openReview} disabled={busy}>Review &amp; submit</button></div></div>
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
              <button className="btn" onClick={() => { engine.skip(q.id); go(idx + 1); }} disabled={idx === questions.length - 1 && st.state === 'ANSWERED'}>Skip question</button>
              <button className="btn" onClick={() => engine.toggleMark(q.id)} aria-pressed={st.marked}>{st.marked ? 'Unmark review' : 'Mark for review'}</button>
              <button className="btn" onClick={() => engine.clear(q.id)} disabled={!st.selectedLabel}>Clear response</button>
              <span className="grow" />
              <span className={`save-state ${indicator.c}`} role="status" aria-live="polite" data-testid="save-state">{indicator.t}</span>
              <button className="btn btn-green" onClick={saveAndNext} disabled={busy}>{idx === questions.length - 1 ? 'Save' : 'Save & next →'}</button>
              <button className="btn" onClick={() => go(idx + 1)} disabled={idx === questions.length - 1}>Next →</button>
            </div>
          </section>
        ) : <ReviewView engine={engine} questions={questions} attemptId={attemptId} clientId={clientId} submitKey={submitKey.current} onBack={(n) => go(n ?? idx)} onSubmitted={onSubmitted} />}
        </div>

        <aside className="stack" aria-label="Question navigator">
          <div className="card"><div className="card-h"><h2>Question palette</h2><span className="small muted mono">{counts.answered}/{questions.length}</span></div><div className="card-b stack">
            <div className="bar" aria-hidden><i style={{ width: `${(counts.answered / questions.length) * 100}%` }} /></div>
            <div className="row wrap" role="group" aria-label="Filter questions">{([['all', 'All'], ['answered', 'Answered'], ['skipped', 'Skipped'], ['unanswered', 'Unanswered'], ['notvisited', 'Not visited'], ['marked', 'Marked']] as [Filter, string][]).map(([k, l]) => <button key={k} className="chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}{k !== 'all' ? ` ${k === 'marked' ? counts.marked : counts[k]}` : ''}</button>)}</div>
            <div className="pal" role="list">{visible.map(({ x, i, k, m }) => <button key={x.id} role="listitem" className={`${k} ${i === idx && view === 'q' ? 'current' : ''} ${m ? 'marked' : ''}`} onClick={() => go(i)} aria-label={`Question ${x.number}, ${k === 'notvisited' ? 'not visited' : k}${m ? ', marked for review' : ''}`} aria-current={i === idx ? 'true' : undefined}>{pad(x.number)}</button>)}</div>
            {!visible.length && <div className="small faint">No questions match this filter.</div>}
            <div className="legend"><span><i style={{ background: 'var(--green)' }} />Answered</span><span><i style={{ background: 'var(--amber-bg)', borderColor: '#E2B93B' }} />Skipped</span><span><i style={{ borderColor: 'var(--maroon)' }} />Unanswered</span><span><i />Not visited</span><span><i style={{ background: 'var(--crimson)' }} />Marked</span></div>
          </div></div>
          <div className="notice small">Press <b className="mono">A–E</b> to choose an option and <b className="mono">←</b> <b className="mono">→</b> to move. Answers save automatically.</div>
        </aside>
      </div>
      {view === 'q' && <MiniPalette engine={engine} questions={questions} idx={idx} answered={counts.answered} onGo={go} />}
    </div>
  );
}

/** Phone/tablet only (CSS hides it above 960 px, where the full palette is beside the question): progress and jump-to-question stay on screen. */
function MiniPalette({ engine, questions, idx, answered, onGo }: { engine: ExamEngine; questions: Q[]; idx: number; answered: number; onGo: (i: number) => void }) {
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => { // keep the current question visible inside the strip without scrolling the page itself
    const el = strip.current?.querySelector<HTMLElement>('[aria-current="true"]'); const box = strip.current;
    if (el && box) box.scrollTo({ left: el.offsetLeft - box.clientWidth / 2 + el.clientWidth / 2, behavior: 'smooth' });
  }, [idx]);
  return (
    <nav className="mini-pal no-print" aria-label="Question progress">
      <div className="mini-pal-head"><span className="small mono" aria-live="polite">Q{pad(questions[idx]!.number)} / {questions.length}</span><span className="small muted mono">{answered} answered</span></div>
      <div className="mini-pal-strip" ref={strip}>
        {questions.map((x, i) => { const s = engine.get(x.id); const k = paletteKind(s); return (
          <button key={x.id} className={`${k} ${i === idx ? 'current' : ''} ${s.marked ? 'marked' : ''}`} onClick={() => onGo(i)} aria-current={i === idx ? 'true' : undefined}
            aria-label={`Question ${x.number}, ${k === 'notvisited' ? 'not visited' : k}${s.marked ? ', marked for review' : ''}`}>{pad(x.number)}</button>); })}
      </div>
    </nav>
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
        <button className="btn" onClick={() => engine.skip(q.id)} disabled={st.state === 'ANSWERED'}>Skip question</button>
        <button className="btn" onClick={() => engine.toggleMark(q.id)} aria-pressed={st.marked}>{st.marked ? 'Unmark review' : 'Mark for review'}</button>
        <button className="btn" onClick={() => engine.clear(q.id)} disabled={!st.selectedLabel}>Clear response</button>
        <span className="grow" />
        <span className={`save-state ${ind.c}`} role="status" aria-live="polite">{ind.t}</span>
      </div>
    </section>
  );
}

function ReviewView({ engine, questions, attemptId, clientId, submitKey, onBack, onSubmitted }: { engine: ExamEngine; questions: Q[]; attemptId: string; clientId: string; submitKey: string; onBack: (n?: number) => void; onSubmitted: (r: Receipt) => void }) {
  const [agree, setAgree] = useState(false); const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [confirm, setConfirm] = useState(false);
  const c = engine.counts();
  async function submit() {
    setBusy(true); setErr('');
    const ok = await engine.flushAll(20000);
    if (!ok) { setBusy(false); setErr(`${engine.pendingCount()} answer(s) are not stored yet. Wait for the connection and try again.`); return; }
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
    setBusy(false); setErr('Could not reach the server. Your answers are safe; press Submit again when the connection returns.');
  }
  return (
    <section className="card" aria-label="Review answers">
      <div className="card-h"><h2>Review your answers</h2><button className="btn btn-sm" onClick={() => onBack()}>← Back to questions</button></div>
      <div className="card-b stack">
        <div className="grid g4"><Cnt k="Answered" v={c.answered} /><Cnt k="Skipped" v={c.skipped} /><Cnt k="Unanswered" v={c.unanswered} /><Cnt k="Not visited" v={c.notvisited} /></div>
        {c.marked > 0 && <Notice tone="warn">{c.marked} question(s) are marked for review.</Notice>}
        {(c.skipped + c.unanswered + c.notvisited) > 0 && <Notice tone="warn">{c.skipped + c.unanswered + c.notvisited} question(s) have no answer. Select a number to return to it.</Notice>}
        <div className="pal" style={{ gridTemplateColumns: 'repeat(10, 1fr)' }}>{questions.map((x, i) => { const s = engine.get(x.id); return <button key={x.id} className={`${paletteKind(s)} ${s.marked ? 'marked' : ''}`} onClick={() => onBack(i)} aria-label={`Question ${x.number}: ${paletteKind(s)}`}>{pad(x.number)}</button>; })}</div>
        {err && <Notice tone="bad">{err}</Notice>}
        <div className="row"><button className="btn btn-primary" onClick={() => setConfirm(true)} disabled={busy}>Submit examination…</button><span className="small muted">You cannot change answers after submission.</span></div>
      </div>
      {confirm && <Modal title="Submit examination?" onClose={() => !busy && setConfirm(false)} footer={<><button className="btn" onClick={() => setConfirm(false)} disabled={busy}>Cancel</button><button className="btn btn-primary" disabled={!agree || busy} onClick={submit} data-testid="confirm-submit">{busy ? 'Submitting…' : 'Confirm and submit'}</button></>}>
        <p>You answered <b>{c.answered}</b> of <b>{questions.length}</b> questions. {questions.length - c.answered > 0 ? `${questions.length - c.answered} will be marked as unanswered.` : ''}</p>
        <label className="row" style={{ alignItems: 'flex-start' }}><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> <span>I have reviewed my answers and understand that submission is final.</span></label>
        {err && <Notice tone="bad">{err}</Notice>}
      </Modal>}
    </section>
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
