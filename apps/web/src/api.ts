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

/** Minimal data hook: fetches on mount / key change, exposes reload(). In-flight requests are aborted when the path changes or the page unmounts. */
export function useGet<T = unknown>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(!!path);
  const seq = useRef(0); const ctl = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    if (!path) return;
    ctl.current?.abort(); const c = new AbortController(); ctl.current = c;
    const n = ++seq.current; setLoading(true);
    try { const d = await api<T>('GET', path, undefined, c.signal); if (n === seq.current) { setData(d); setError(null); } }
    catch (e) { if (n === seq.current && (e as Error)?.name !== 'AbortError') setError(e as ApiError); }
    finally { if (n === seq.current) setLoading(false); }
  }, [path]);
  useEffect(() => { void load(); return () => { seq.current++; ctl.current?.abort(); }; }, [load]);
  return { data, error, loading, reload: load, setData };
}

const fmtTz = 'Asia/Karachi';
export const fmtDate = (d?: string | Date | null) => d ? new Intl.DateTimeFormat('en-GB', { timeZone: fmtTz, day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(d)) : '—';
export const fmtTime = (d?: string | Date | null) => d ? new Intl.DateTimeFormat('en-GB', { timeZone: fmtTz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(d)) : '—';
export const fmtDT = (d?: string | Date | null) => d ? `${fmtDate(d)} ${fmtTime(d)}` : '—';
export const toLocalInput = (d: Date) => { const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
