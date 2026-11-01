import { BrandLogo } from '@/brand';
import type { ReactNode } from 'react';

export function AuthFrame({ headline, body, children }: { headline: string; body: string; children: ReactNode }) {
  return (
    <div className="auth">
      <section className="auth-art" aria-hidden={false}>
        <BrandLogo plate priority className="auth-logo" />
        <div><h2>{headline}</h2><p>{body}</p></div>
        <div className="small" style={{ color: '#B58F8B' }}>Examination Portal · Secure, role-based access with a full audit trail.</div>
      </section>
      <main className="auth-form"><div className="auth-box">{children}</div></main>
    </div>
  );
}
