'use client';
import { useCallback, useEffect, useState } from 'react';

/**
 * List state (search text, filters, page) that lives in the address bar. It is written with history.replaceState — no navigation and no refetch —
 * so Back from a detail page, a reload or a pasted link lands on the same filtered list (UI-028). Defaults are omitted from the URL.
 * Only call it from components that render after sign-in (they mount on the client), so `window` is always present.
 */
export function useUrlState<K extends string>(defaults: Record<K, string>) {
  const [vals, setVals] = useState<Record<K, string>>(() => {
    const sp = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search);
    return Object.fromEntries((Object.keys(defaults) as K[]).map((k) => [k, sp.get(k) ?? defaults[k]])) as Record<K, string>;
  });
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    for (const k of Object.keys(defaults) as K[]) { if (vals[k] === defaults[k]) sp.delete(k); else sp.set(k, vals[k]); }
    const qs = sp.toString(); const next = window.location.pathname + (qs ? `?${qs}` : '');
    if (next !== window.location.pathname + window.location.search) window.history.replaceState(window.history.state, '', next);
  }, [vals]);
  const set = useCallback((k: K, v: string) => setVals((p) => (p[k] === v ? p : { ...p, [k]: v })), []);
  const reset = useCallback(() => setVals((p) => ({ ...p, ...defaults, page: '1' as never })), []);
  return { vals, set, reset };
}
