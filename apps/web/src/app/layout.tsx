import type { Metadata } from 'next';
import { connection } from 'next/server';
import './globals.css';
import { SessionProvider } from '@/session';
import { ToastProvider } from '@/ui';

export const metadata: Metadata = { title: 'SZABMU Online Examination System', description: 'Shaheed Zulfiqar Ali Bhutto Medical University — Examination Portal' };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await connection(); // render per request: the Content-Security-Policy nonce (proxy.ts) can only be applied to dynamically rendered pages
  return <html lang="en"><body><ToastProvider><SessionProvider>{children}</SessionProvider></ToastProvider></body></html>;
}
