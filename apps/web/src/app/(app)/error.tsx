'use client';
import Link from 'next/link';
import { useEffect } from 'react';

/** Unexpected failure inside a signed-in page: the navigation shell stays, only the content area is replaced. */
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error('page error', error.digest ?? ''); }, [error]);
  return (
    <div className="card" role="alert" data-testid="error-boundary"><div className="card-b stack">
      <h2>This page hit a problem</h2>
      <p className="muted" style={{ margin: 0 }}>An unexpected error stopped this page from displaying. Your saved work is not affected. Please try again.</p>
      <div className="row"><button className="btn btn-primary" onClick={reset}>Try again</button><Link className="btn" href="/dashboard">Go to dashboard</Link></div>
      {error.digest && <div className="small faint">Reference for the examination office: <span className="mono">{error.digest}</span></div>}
    </div></div>
  );
}
