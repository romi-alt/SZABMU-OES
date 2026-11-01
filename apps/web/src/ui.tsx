'use client';
import { cloneElement, createContext, isValidElement, type ReactElement, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon, iconForRoute, type IconName } from './icons';
import { ApiError } from './api';

/* ── toasts ── */
const ToastCtx = createContext<(msg: string, bad?: boolean) => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; msg: string; bad: boolean }[]>([]);
  const push = useCallback((msg: string, bad = false) => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s, { id, msg, bad }]);
    setTimeout(() => setItems((s) => s.filter((x) => x.id !== id)), 5000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">{items.map((t) => <div key={t.id} className={`toast ${t.bad ? 'bad' : ''}`}>{t.msg}</div>)}</div>
    </ToastCtx.Provider>
  );
}
export const errMsg = (e: unknown) => (e instanceof ApiError ? (e.body?.issues?.length ? `${e.message}: ${e.body.issues.map((i: any) => `${i.path} ${i.message}`).join('; ')}` : e.message) : (e as Error)?.message ?? 'Something went wrong');

/* ── primitives ── */
/** Every page names itself in the browser tab/history and to screen readers (WCAG 2.4.2): "<page> · SZABMU OES". */
export function PageHead({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  const path = usePathname();
  useEffect(() => { document.title = `${title} · SZABMU OES`; }, [title]);
  return <div className="page-head"><div className="page-title"><span className="page-ico"><Icon name={iconForRoute(path)} size={22} /></span><div><h1>{title}</h1>{sub && <p>{sub}</p>}</div></div><div className="row wrap">{children}</div></div>;
}
export function Card({ title, actions, children, flush }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; flush?: boolean }) {
  return <section className="card">{title && <div className="card-h"><h2>{title}</h2><div className="row">{actions}</div></div>}<div className={flush ? '' : 'card-b'}>{children}</div></section>;
}
export function Stat({ k, v, s, icon }: { k: string; v: ReactNode; s?: ReactNode; icon?: IconName }) {
  return <div className="card stat">{icon && <span className="stat-ico"><Icon name={icon} size={20} /></span>}<div className="k">{k}</div><div className="v">{v}</div>{s && <div className="s">{s}</div>}</div>;
}
const TONES: Record<string, string> = {
  green: 'b-green', amber: 'b-amber', red: 'b-red', blue: 'b-blue', grey: 'b-grey',
};
export function Badge({ tone = 'grey', children }: { tone?: keyof typeof TONES | string; children: ReactNode }) { return <span className={`badge ${TONES[tone] ?? 'b-grey'}`}>{children}</span>; }
const STATUS_TONE: Record<string, string> = {
  PASS: 'green', APPROVED: 'green', PUBLISHED: 'green', LIVE: 'green', SUBMITTED: 'green', RESOLVED: 'green', ELIGIBLE: 'green', ACTIVE: 'green', ONLINE: 'green', SENT: 'green', EXAMINER_APPROVED: 'green',
  FAIL: 'red', REJECTED: 'red', CANCELLED: 'red', DISCONNECTED: 'red', INELIGIBLE: 'red', HIGH: 'red', OPEN: 'red', FAILED: 'red',
  DRAFT: 'grey', RETIRED: 'grey', NOT_STARTED: 'grey', CLOSED: 'grey', ABSENT: 'grey', DISMISSED: 'grey', FINISHED: 'grey', LOW: 'grey',
  PAPER_PENDING: 'amber', SCHEDULED: 'blue', RESULT_PENDING: 'amber', IN_PROGRESS: 'blue', INVESTIGATING: 'amber', MEDIUM: 'amber', CONDONED: 'amber', LECTURER_REVIEWED: 'blue', GRADED: 'amber', AUTO_SUBMITTED: 'amber', WITHHELD: 'amber', PENDING: 'amber',
};
export const Status = ({ s }: { s: string }) => <Badge tone={STATUS_TONE[s] ?? 'grey'}>{s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}</Badge>;
export function Notice({ tone, children }: { tone?: 'warn' | 'bad' | 'ok'; children: ReactNode }) { return <div className={`notice ${tone ?? ''}`} role={tone === 'bad' ? 'alert' : undefined}>{children}</div>; }
/** Empty list that says why: echoes the active filters and offers to clear them (UI-028). */
export function ListEmpty({ noun, filters, onClear }: { noun: string; filters: string[]; onClear: () => void }) {
  if (!filters.length) return <>No {noun} yet.</>;
  return <span data-testid="list-empty">No {noun} match {filters.join(' · ')}. <button className="btn-link" onClick={onClear}>Clear filters</button></span>;
}
export const Empty = ({ children }: { children: ReactNode }) => <div className="empty">{children}</div>;
export function Loading() { return <div className="stack" aria-busy="true" aria-label="Loading"><div className="skeleton" style={{ width: '40%' }} /><div className="skeleton" /><div className="skeleton" style={{ width: '80%' }} /></div>; }
/** What kind of failure is this? Drives the title, the wording and the recovery action; never exposes stack traces or internals. */
export function classifyError(e: unknown): { kind: 'network' | 'unavailable' | 'forbidden' | 'notfound' | 'server' | 'other'; title: string } {
  if (!(e instanceof ApiError)) return { kind: 'other', title: '' };
  if (e.status === 0) return { kind: 'network', title: 'You appear to be offline' };
  if (e.status === 403) return { kind: 'forbidden', title: 'You do not have access to this' };
  if (e.status === 404) return { kind: 'notfound', title: 'We could not find that' };
  const apiJson = e.body && typeof e.body === 'object' && 'code' in e.body;   // our API always answers JSON with a code; anything else is the proxy/gateway
  if (e.status === 502 || e.status === 503 || e.status === 504 || (e.status >= 500 && !apiJson)) return { kind: 'unavailable', title: 'The service is temporarily unavailable' };
  if (e.status >= 500) return { kind: 'server', title: 'Something went wrong on our side' };
  return { kind: 'other', title: '' };
}
export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const c = classifyError(error);
  if (c.kind === 'other') return <Notice tone="bad">{errMsg(error)}</Notice>;   // validation / conflict messages stay inline
  const body = c.kind === 'unavailable' ? 'The examination service could not be reached just now. Nothing you have already saved is lost. Please try again in a moment.'
    : c.kind === 'server' ? 'The request could not be completed. Please try again; if it keeps happening, tell the examination office.' : errMsg(error);
  return (
    <div className="card" role="alert" data-testid={`error-${c.kind}`}><div className="card-b stack">
      <h2>{c.title}</h2><p className="muted" style={{ margin: 0 }}>{body}</p>
      <div className="row">
        {onRetry && c.kind !== 'forbidden' && c.kind !== 'notfound' && <button className="btn btn-primary" onClick={onRetry}>Try again</button>}
        <Link className="btn" href="/dashboard">Go to dashboard</Link>
      </div>
    </div></div>
  );
}
/**
 * Renders `children(data)` only when there is data. It never calls `children(null)`: while a request is pending it shows the skeleton,
 * and when nothing has been requested (`idle`) or the response carried no payload it shows `idle` (default: a plain "Nothing to show yet").
 */
/** Skeleton that admits when it is taking too long (UI-033): after 8 s it says so and offers a retry instead of spinning forever. */
export function SlowLoading({ onRetry, after = 8000 }: { onRetry?: () => void; after?: number }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => { const t = setTimeout(() => setSlow(true), after); return () => clearTimeout(t); }, [after]);
  return (
    <>
      <Loading />
      {slow && <div className="notice warn" role="status" data-testid="slow-loading" style={{ marginTop: 12 }}>This is taking longer than usual. Your connection or the server may be slow. {onRetry && <button className="btn btn-sm" onClick={onRetry} style={{ marginLeft: 8 }}>Try again</button>}</div>}
    </>
  );
}
export function Async({ state, children, idle }: { state: { data: any; error: any; loading: boolean; idle?: boolean; reload?: () => void }; children: (d: any) => ReactNode; idle?: ReactNode }) {
  if (state.error) return <ErrorBox error={state.error} onRetry={state.reload} />;
  if (state.loading && state.data == null) return <SlowLoading onRetry={state.reload} />;
  if (state.data == null) return <>{idle ?? <Empty>Nothing to show yet.</Empty>}</>;
  return <>{children(state.data)}</>;
}

export interface Col<T> { h: string; cell: (r: T) => ReactNode; num?: boolean; cls?: string }
export function Table<T>({ cols, rows, empty = 'Nothing to show.', rowKey }: { cols: Col<T>[]; rows: T[]; empty?: ReactNode; rowKey: (r: T) => string }) {
  if (!Array.isArray(rows)) return <Notice tone="bad">The server returned this list in an unexpected format, so it cannot be shown. Try again; if it keeps happening, tell the examination office.</Notice>;
  if (!rows.length) return <Empty>{empty}</Empty>;
  return (
    <div className="tbl-wrap"><table className="tbl"><thead><tr>{cols.map((c) => <th key={c.h || 'actions'} scope="col" className={c.num ? 'num' : ''}>{c.h || <span className="sr-only">Actions</span>}</th>)}</tr></thead>
      <tbody>{rows.map((r) => <tr key={rowKey(r)}>{cols.map((c) => <td key={c.h} data-label={c.h} className={`${c.num ? 'num' : ''} ${c.cls ?? ''}`}>{c.cell(r)}</td>)}</tr>)}</tbody></table></div>
  );
}
/**
 * Labelled form field. `required` adds a visible asterisk + aria-required, and reports "<label> is required." when the control is left empty.
 * The message slot is reserved for required fields so it appearing never moves the buttons below it (a click would otherwise be lost).
 */
export function Field({ label, hint, error, required, children }: { label: string; hint?: string; error?: string; required?: boolean; children: ReactNode }) {
  const [left, setLeft] = useState(false); const [empty, setEmpty] = useState(false);
  const own = required && left && empty ? `${label} is required.` : '';
  const msg = error || own;
  const child = isValidElement(children) && typeof children.type === 'string' && ['input', 'select', 'textarea'].includes(children.type)
    ? cloneElement(children as ReactElement<Record<string, any>>, {
      ...(required ? { 'aria-required': true, onBlur: (e: any) => { (children.props as any).onBlur?.(e); setLeft(true); setEmpty(!String(e.target.value ?? '').trim()); }, onInput: (e: any) => { (children.props as any).onInput?.(e); if (left) setEmpty(!String(e.target.value ?? '').trim()); } } : {}),
      ...(msg ? { 'aria-invalid': true } : {}),
    })
    : children;
  return <label className="f"><span>{label}{required && <span aria-hidden className="req"> *</span>}</span>{child}{hint && <span className="hint">{hint}</span>}{(msg || required) && <span className="err-text" role={msg ? 'alert' : undefined} style={{ minHeight: 16 }}>{msg}</span>}</label>;
}
const ModalClose = createContext<() => void>(() => undefined);
/** Cancel button for dialogs: goes through the same unsaved-changes check as Escape, the backdrop and ✕. */
export function CancelButton({ children = 'Cancel' }: { children?: ReactNode }) { const close = useContext(ModalClose); return <button className="btn" onClick={close}>{children}</button>; }
/**
 * Shared dialog. Focus moves into the dialog when it opens, Tab/Shift+Tab stay inside it, Escape and the backdrop close it, and focus returns to
 * the control that opened it (WCAG 2.4.3). The visible heading names the dialog for assistive technology.
 * Unsaved changes: once the person types or chooses anything, every way of dismissing the dialog first asks "Discard what you entered?"
 * (UI-026). `missing` lists what still blocks the primary button, so a disabled button is never a mystery.
 */
export function Modal({ title, onClose, children, footer, missing }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; missing?: string[] }) {
  const ref = useRef<HTMLDivElement>(null); const [dirty, setDirty] = useState(false); const [asking, setAsking] = useState(false); const keepRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (asking) keepRef.current?.focus(); }, [asking]);
  const request = useCallback(() => { if (dirty) setAsking(true); else onClose(); }, [dirty, onClose]);
  useEffect(() => { const opener = document.activeElement as HTMLElement | null; ref.current?.focus(); return () => { if (opener && document.contains(opener)) opener.focus(); }; }, []);
  useEffect(() => { const h = (e: KeyboardEvent) => e.key === 'Escape' && request(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [request]);
  const trap = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab' || !ref.current) return;
    const f = [...ref.current.querySelectorAll<HTMLElement>('button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter((x) => x.offsetParent !== null);
    if (!f.length) { e.preventDefault(); return; }
    const first = f[0]!, last = f[f.length - 1]!;
    if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  return (
    <ModalClose.Provider value={request}>
      <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); request(); } }}>
        <div className="modal" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref} onKeyDown={trap} onInput={() => setDirty(true)} onChange={() => setDirty(true)}>
          <div className="modal-h"><h2>{title}</h2><button className="btn btn-sm" onClick={request} aria-label="Dismiss dialog">✕</button></div>
          <div className="modal-b">{children}</div>
          {asking && <div className="modal-discard notice warn" role="alertdialog" aria-label="Discard changes?"><b>Discard what you entered?</b> <span>Your changes in this dialog will be lost.</span>
            <span className="row"><button ref={keepRef} className="btn btn-sm btn-green" onClick={() => setAsking(false)} data-testid="keep-editing">Keep editing</button><button className="btn btn-sm btn-danger" onClick={onClose} data-testid="discard-changes">Discard</button></span></div>}
          {(footer || !!missing?.length) && <div className="modal-f">{!!missing?.length && <span className="small muted modal-missing" data-testid="modal-missing">Still needed: {missing.join(', ')}.</span>}{footer}</div>}
        </div>
      </div>
    </ModalClose.Provider>
  );
}
/** Runs an async action with busy state + toast feedback. */
export function useAction() {
  const toast = useToast(); const [busy, setBusy] = useState(false);
  const run = useCallback(async <T,>(fn: () => Promise<T>, ok?: string): Promise<T | undefined> => {
    setBusy(true);
    try { const r = await fn(); if (ok) toast(ok); return r; } catch (e) { toast(errMsg(e), true); return undefined; } finally { setBusy(false); }
  }, [toast]);
  return { run, busy };
}
export function Confirm({ title, body, onYes, onNo, yes = 'Confirm', danger }: { title: string; body: ReactNode; onYes: () => void; onNo: () => void; yes?: string; danger?: boolean }) {
  return <Modal title={title} onClose={onNo} footer={<><button className="btn" onClick={onNo}>Cancel</button><button className={`btn ${danger ? 'btn-primary' : 'btn-green'}`} onClick={onYes}>{yes}</button></>}>{body}</Modal>;
}
export function Pager({ page, total, size, onPage }: { page: number; total: number; size: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / size));
  return <div className="row between small muted" style={{ padding: '10px 16px' }}><span>{total} record{total === 1 ? '' : 's'}</span><span className="row"><button className="btn btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>Page {page} of {pages}<button className="btn btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button></span></div>;
}
