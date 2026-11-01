import { NextResponse, type NextRequest } from 'next/server';
import { buildCsp } from './csp';

/** Issues a fresh nonce per request and sets the Content-Security-Policy on the response (Next reads the nonce from the request header). */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = buildCsp({ nonce, dev: process.env.NODE_ENV === 'development', mediaOrigins: process.env.CSP_MEDIA_ORIGIN, upgradeInsecure: process.env.CSP_UPGRADE_INSECURE === 'true' });
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set('Content-Security-Policy', csp);
  return res;
}

export const config = {
  // Documents only: not the API rewrite, Next's static/image assets, or the public icons/logo.
  matcher: [{ source: '/((?!api|_next/static|_next/image|favicon.ico|icon.png|logo.png).*)', missing: [{ type: 'header', key: 'next-router-prefetch' }, { type: 'header', key: 'purpose', value: 'prefetch' }] }],
};
