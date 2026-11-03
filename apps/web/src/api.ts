'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public body: any) { super(message); }
}

export const SESSION_EXPIRED_EVENT = 'oes:session-expired';

export async function api<T = any>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method, credentials: 'same-origin', headers: body !== undefined ? { 'content-type': 'application/json' } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined, signal });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e;                       // caller cancelled: not an error to show
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your internet connection and try again.', null);
  }
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    // A signed-in user whose session ended (expiry, sign-out elsewhere, deactivation) is told so and returned to sign-in.
    if (res.status === 401 && data?.code === 'UNAUTHENTICATED' && path !== '/auth/me' && typeof window !== 'undefined') window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    throw new ApiError(res.status, data?.code ?? 'ERROR', data?.message ?? `Request failed (${res.status})`, data);
  }
  return data as T;
}
export const get = <T = any>(p: string) => api<T>('GET', p);
export const post = <T = any>(p: string, b: unknown = {}) => api<T>('POST', p, b);
export const put = <T = any>(p: string, b: unknown = {}) => api<T>('PUT', p, b);
export const patch = <T = any>(p: string, b: unknown = {}) => api<T>('PATCH', p, b);
export const del = <T = any>(p: string) => api<T>('DELETE', p);

/**
 * Minimal data hook: fetches when `path` changes, exposes reload().
 * Contract (UI-001): a `null` path means "not requested yet" → `idle: true`, `loading: false`, `data: null`, never an error.
 * A result is only reported (`error`, "settled") for the path it was fetched for, so on a path change `loading` is true until the new
 * request answers — consumers never see `loading=false` with no data for a path that has been requested.
 */
export function useGet<T = any>(path: string | null) {
  const [res, setRes] = useState<{ key: string | null; data: T | null; error: ApiError | null }>({ key: null, data: null, error: null });
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!path) return;
    const n = ++seq.current; setBusy(true);
    try { const d = await get<T>(path); if (n === seq.current) setRes({ key: path, data: d, error: null }); }
    catch (e) { if (n === seq.current) setRes((r) => ({ key: path, data: r.data, error: e as ApiError })); }
    finally { if (n === seq.current) setBusy(false); }
  }, [path]);
  useEffect(() => { void load(); }, [load]);
  const settled = !!path && res.key === path;
  const setData = useCallback((v: T | null | ((prev: T | null) => T | null)) => setRes((r) => ({ ...r, data: typeof v === 'function' ? (v as (p: T | null) => T | null)(r.data) : v })), []);
  return { data: path ? res.data : null, error: settled ? res.error : null, loading: !!path && (busy || !settled), idle: !path, reload: load, setData };
}

const fmtTz = 'Asia/Karachi';
export const fmtDate = (d?: string | Date | null) => d ? new Intl.DateTimeFormat('en-GB', { timeZone: fmtTz, day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(d)) : '—';
export const fmtTime = (d?: string | Date | null) => d ? new Intl.DateTimeFormat('en-GB', { timeZone: fmtTz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(d)) : '—';
export const fmtDT = (d?: string | Date | null) => d ? `${fmtDate(d)} ${fmtTime(d)}` : '—';
/** Server-built text (notifications) may carry raw ISO timestamps such as "2026-11-02T13:05:31.173Z"; show them in the same format and zone as every other time in the app. */
export const humanizeTimes = (text?: string | null) => (text ?? '').replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, (m) => fmtDT(m));
export const toLocalInput = (d: Date) => { const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

/** Live event names the server pushes (outbox type names plus the stream's own `stats`, `state`, `resync`). */
export const STREAM_EVENTS = ['stats', 'state', 'resync', 'ADMISSION_OPENED', 'ADMISSION_CLOSED', 'EXAM_STARTED', 'EXAM_SUSPENDED', 'EXAM_RESUMED', 'DEADLINE_EXTENDED', 'EXAM_CLOSING', 'EXAM_CLOSED', 'SCORING_STARTED', 'RESULTS_PENDING', 'POLICY_CHANGED'] as const;

/**
 * Server-Sent Events with the browser's built-in reconnect (it resends Last-Event-ID, so the server replays what was missed).
 * Events are hints: callers must re-read authoritative state from the API rather than trust a payload. Returns a closer.
 */
export function openStream(path: string, on: { event: (name: string, data: any, id?: string) => void; status?: (connected: boolean) => void }): () => void {
  if (typeof window === 'undefined' || typeof EventSource === 'undefined') return () => undefined;
  const es = new EventSource(`/api${path}`, { withCredentials: true });
  es.onopen = () => on.status?.(true); es.onerror = () => on.status?.(false);
  for (const name of STREAM_EVENTS) es.addEventListener(name, (e) => { const m = e as MessageEvent; let d: any = null; try { d = JSON.parse(m.data); } catch { /* ignore */ } on.event(name, d, m.lastEventId || undefined); });
  return () => es.close();
}
