import type { Metadata } from 'next';
import './globals.css';
import { SessionProvider } from '@/session';
import { ToastProvider } from '@/ui';

export const metadata: Metadata = { title: 'SZABMU Online Examination System', description: 'Shaheed Zulfiqar Ali Bhutto Medical University — Examination Portal' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body><ToastProvider><SessionProvider>{children}</SessionProvider></ToastProvider></body></html>;
}
