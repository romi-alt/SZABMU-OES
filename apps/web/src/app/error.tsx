'use client';
import Link from 'next/link';
import { useEffect } from 'react';
import { AuthFrame } from './AuthFrame';

/** Unexpected rendering failure outside the signed-in shell. Shows a reference (Next's digest), never the error text or a stack. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error('page error', error.digest ?? ''); }, [error]);
  return (
    <AuthFrame headline="Something went wrong." body="The page could not be displayed. Your saved work is not affected.">
      <div role="alert"><h1>This page hit a problem</h1><p className="muted" style={{ margin: '4px 0 0' }}>An unexpected error stopped the page from loading. Please try again.</p></div>
      <div className="row"><button className="btn btn-primary" onClick={reset}>Try again</button><Link className="btn" href="/dashboard">Go to dashboard</Link></div>
      {error.digest && <div className="small faint">Reference for the examination office: <span className="mono">{error.digest}</span></div>}
    </AuthFrame>
  );
}
