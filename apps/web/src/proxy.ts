import { NextResponse, type NextRequest } from 'next/server';
import { PORTAL_HEADER, isPagePathAllowedOnPortal, portalOf } from '@oes/shared';
import { buildCsp } from './csp';

/** Issues a fresh nonce per request and sets the Content-Security-Policy on the response (Next reads the nonce from the request header). */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = buildCsp({ nonce, dev: process.env.NODE_ENV === 'development', mediaOrigins: process.env.CSP_MEDIA_ORIGIN, upgradeInsecure: process.env.CSP_UPGRADE_INSECURE === 'true' });
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', csp);
  // Two-portal deployment: one build, two processes. With PORTAL=student|staff this process serves only that portal's pages; anything
  // else is answered by the branded 404 (the API enforces the same boundary independently, so this is defence in depth and clearer UX).
  // Single-process hosting (scripts/hostinger-single-site.mjs) serves both portals and decides per request from the Host name; it
  // overwrites X-OES-Portal before Next sees the request, so the header is trusted ONLY when that launcher opted in (PORTAL_FROM_HEADER).
  const portal = portalOf(process.env.PORTAL) ?? (process.env.PORTAL_FROM_HEADER === 'true' ? portalOf(request.headers.get(PORTAL_HEADER)) : null);
  if (portal && !isPagePathAllowedOnPortal(request.nextUrl.pathname, portal)) {
    const url = request.nextUrl.clone(); url.pathname = '/__not-served-on-this-portal'; url.search = '';
    const blocked = NextResponse.rewrite(url, { request: { headers } });
    blocked.headers.set('Content-Security-Policy', csp);
    return blocked;
  }
  // Hand the RESOLVED portal (never the raw client header) to server components, e.g. so the staff sign-in page omits candidate-only wording.
  if (portal) headers.set(PORTAL_HEADER, portal); else headers.delete(PORTAL_HEADER);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set('Content-Security-Policy', csp);
  return res;
}

export const config = {
  // Documents only: not the API rewrite, Next's static/image assets, or the public icons, logos and campus photo (a document-only matcher: these must never be rewritten to the portal 404).
  matcher: [{ source: '/((?!api|_next/static|_next/image|favicon.ico|icon.png|logo.png|logo-white.png|campus.jpg).*)', missing: [{ type: 'header', key: 'next-router-prefetch' }, { type: 'header', key: 'purpose', value: 'prefetch' }] }],
};
