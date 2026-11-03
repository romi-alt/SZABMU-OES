import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { connection } from 'next/server';
import { PORTAL_HEADER, portalOf } from '@oes/shared';
import { PortalProvider } from '@/portal-context';
import './globals.css';
import { SessionProvider } from '@/session';
import { ToastProvider } from '@/ui';

export const metadata: Metadata = { title: 'SZABMU Online Examination Center', description: 'Shaheed Zulfiqar Ali Bhutto Medical University — Examination Portal' };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await connection(); // render per request: the Content-Security-Policy nonce (proxy.ts) can only be applied to dynamically rendered pages
  const portal = portalOf((await headers()).get(PORTAL_HEADER)); // set by proxy.ts from the trusted host mapping, never from the client
  return <html lang="en"><body><PortalProvider portal={portal}><ToastProvider><SessionProvider>{children}</SessionProvider></ToastProvider></PortalProvider></body></html>;
}
