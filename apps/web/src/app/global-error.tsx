'use client';
import './globals.css';

/** Last resort: the root layout itself failed. Self-contained (replaces <html>), no data fetching, no error text shown. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en"><body>
      <main style={{ maxWidth: 560, margin: '12vh auto', padding: 24 }} role="alert">
        <h1>Examination Portal is unavailable</h1>
        <p className="muted">An unexpected error stopped the portal from loading. Your saved work is not affected.</p>
        <div className="row"><button className="btn btn-primary" onClick={reset}>Try again</button><a className="btn" href="/login">Back to sign-in</a></div>
        {error.digest && <p className="small faint">Reference for the examination office: <span className="mono">{error.digest}</span></p>}
      </main>
    </body></html>
  );
}
