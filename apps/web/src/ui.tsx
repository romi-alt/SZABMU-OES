'use client';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
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
export function PageHead({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return <div className="page-head"><div><h1>{title}</h1>{sub && <p>{sub}</p>}</div><div className="row wrap">{children}</div></div>;
}
export function Card({ title, actions, children, flush }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; flush?: boolean }) {
  return <section className="card">{title && <div className="card-h"><h2>{title}</h2><div className="row">{actions}</div></div>}<div className={flush ? '' : 'card-b'}>{children}</div></section>;
}
export function Stat({ k, v, s }: { k: string; v: ReactNode; s?: ReactNode }) {
  return <div className="card stat"><div className="k">{k}</div><div className="v">{v}</div>{s && <div className="s">{s}</div>}</div>;
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
export const Empty = ({ children }: { children: ReactNode }) => <div className="empty">{children}</div>;
export function Loading() { return <div className="stack" aria-busy="true" aria-label="Loading"><div className="skeleton" style={{ width: '40%' }} /><div className="skeleton" /><div className="skeleton" style={{ width: '80%' }} /></div>; }
export function ErrorBox({ error }: { error: unknown }) { return <Notice tone="bad">{errMsg(error)}</Notice>; }
export function Async({ state, children }: { state: { data: any; error: any; loading: boolean }; children: (d: any) => ReactNode }) {
  if (state.error) return <ErrorBox error={state.error} />;
  if (state.loading && !state.data) return <Loading />;
  return <>{children(state.data)}</>;
}

export interface Col<T> { h: string; cell: (r: T) => ReactNode; num?: boolean; cls?: string }
export function Table<T>({ cols, rows, empty = 'Nothing to show.', rowKey }: { cols: Col<T>[]; rows: T[]; empty?: string; rowKey: (r: T) => string }) {
  if (!rows.length) return <Empty>{empty}</Empty>;
  return (
    <div className="tbl-wrap"><table className="tbl"><thead><tr>{cols.map((c) => <th key={c.h} className={c.num ? 'num' : ''}>{c.h}</th>)}</tr></thead>
      <tbody>{rows.map((r) => <tr key={rowKey(r)}>{cols.map((c) => <td key={c.h} className={`${c.num ? 'num' : ''} ${c.cls ?? ''}`}>{c.cell(r)}</td>)}</tr>)}</tbody></table></div>
  );
}
export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return <label className="f">{label}{children}{hint && <span className="hint">{hint}</span>}{error && <span className="err-text">{error}</span>}</label>;
}
export function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => { const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-h"><h2>{title}</h2><button className="btn btn-sm" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="modal-b">{children}</div>{footer && <div className="modal-f">{footer}</div>}
      </div>
    </div>
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
