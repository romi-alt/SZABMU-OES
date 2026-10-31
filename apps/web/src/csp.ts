/**
 * Content-Security-Policy for the SZABMU web app (built per request in `proxy.ts`).
 *
 * Production policy:
 *   script-src  'self' 'nonce-…' 'strict-dynamic'     no 'unsafe-inline', no 'unsafe-eval'
 *   style-src   'self' 'nonce-…'                      <style>/<link> elements need the per-request nonce
 *   style-src-attr 'unsafe-inline'                    INTENTIONALLY RELAXED (see docs/audit/stabilization/05-csp-review.md):
 *                                                     the UI uses inline `style="…"` attributes (progress bars, palette), which a
 *                                                     nonce cannot cover. Attribute styles cannot execute script.
 *   connect-src 'self'                                the browser only talks to same-origin /api (Next rewrites to the API); the
 *                                                     same applies to a future same-origin SSE stream
 *   img-src/media-src 'self' data: blob: + CSP_MEDIA_ORIGIN   object storage origin(s) for question media, when configured
 *   frame-ancestors 'none', object-src 'none', base-uri 'self', form-action 'self'
 * Development additionally allows 'unsafe-eval' (React debugging) and 'unsafe-inline' styles/ws: for HMR. Never in production.
 */
export interface CspOptions { nonce: string; dev: boolean; mediaOrigins?: string; upgradeInsecure?: boolean }

/** Only https origins of the form https://host[:port] are accepted; anything else is ignored rather than trusted. */
export function parseOrigins(list: string | undefined): string[] {
  return (list ?? '').split(',').map((s) => s.trim()).filter((o) => /^https:\/\/[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/i.test(o));
}

export function buildCsp({ nonce, dev, mediaOrigins, upgradeInsecure }: CspOptions): string {
  const media = parseOrigins(mediaOrigins);
  const d: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(dev ? ["'unsafe-eval'"] : [])],
    'style-src': dev ? ["'self'", "'unsafe-inline'"] : ["'self'", `'nonce-${nonce}'`],
    'style-src-attr': ["'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:', ...media],
    'media-src': ["'self'", ...media],
    'font-src': ["'self'"],
    'connect-src': ["'self'", ...(dev ? ['ws://localhost:*', 'ws://127.0.0.1:*'] : [])],
    'manifest-src': ["'self'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
  };
  const parts = Object.entries(d).map(([k, v]) => `${k} ${v.join(' ')}`);
  if (upgradeInsecure) parts.push('upgrade-insecure-requests');   // only behind HTTPS; it would break plain-http localhost runs
  return parts.join('; ');
}
