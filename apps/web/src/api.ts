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

/** Minimal data hook: fetches on mount / key change, exposes reload(). */
export function useGet<T = any>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(!!path);
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!path) return;
    const n = ++seq.current; setLoading(true);
    try { const d = await get<T>(path); if (n === seq.current) { setData(d); setError(null); } }
    catch (e) { if (n === seq.current) setError(e as ApiError); }
    finally { if (n === seq.current) setLoading(false); }
  }, [path]);
  useEffect(() => { void load(); }, [load]);
  return { data, error, loading, reload: load, setData };
}

const fmtTz = 'Asia/Karachi';
export const fmtDate = (d?: string | Date | null) => d ? new Intl.DateTimeFormat('en-GB', { timeZone: fmtTz, day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(d)) : '—';
export const fmtTime = (d?: string | Date | null) => d ? new Intl.DateTimeFormat('en-GB', { timeZone: fmtTz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(d)) : '—';
export const fmtDT = (d?: string | Date | null) => d ? `${fmtDate(d)} ${fmtTime(d)}` : '—';
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
