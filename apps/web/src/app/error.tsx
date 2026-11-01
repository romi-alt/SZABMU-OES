'use client';
import Link from 'next/link';
import { useEffect } from 'react';
import { AuthFrame, AuthHeading, Icon } from './AuthFrame';

/** Unexpected rendering failure outside the signed-in shell. Shows a reference (Next's digest), never the error text or a stack. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error('page error', error.digest ?? ''); }, [error]);
  return (
    <AuthFrame>
      <div role="alert"><AuthHeading icon="alert" title="This page hit a problem" lead="An unexpected error stopped the page from loading. Your saved work is not affected." /></div>
      <button className="auth-btn" onClick={reset}>Try again<Icon name="arrow" size={18} /></button>
      <Link className="auth-btn auth-btn-ghost" href="/dashboard" style={{ textDecoration: 'none' }}>Go to dashboard</Link>
      {error.digest && <p className="small faint" style={{ margin: 0, textAlign: 'center' }}>Reference for the examination office: <span className="mono">{error.digest}</span></p>}
    </AuthFrame>
  );
}
