'use client';
import { useId, useState, type ReactNode } from 'react';
import { BrandLogo } from '@/brand';

/** Minimal line icons (24×24, 1.6 stroke) used by the sign-in and registration pages. */
const P: Record<string, ReactNode> = {
  user: <><circle cx="12" cy="8" r="3.6" /><path d="M5 20c.8-3.6 3.6-5.4 7-5.4s6.2 1.8 7 5.4" /></>,
  userPlus: <><circle cx="10" cy="8" r="3.6" /><path d="M3.5 20c.7-3.4 3.2-5.2 6.5-5.2 1.3 0 2.4.3 3.4.8M18 14v6M15 17h6" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="m4 7.5 8 6 8-6" /></>,
  lock: <><rect x="5" y="10.5" width="14" height="9.5" rx="2.2" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></>,
  id: <><rect x="3" y="5" width="18" height="14" rx="2.5" /><circle cx="9" cy="11" r="2" /><path d="M5.8 16c.4-1.5 1.6-2.2 3.2-2.2s2.8.7 3.2 2.2M14.5 10h4M14.5 13.5h3" /></>,
  calendar: <><rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="2.8" /></>,
  eyeOff: <><path d="M3 3l18 18M10.6 5.7c.4-.1.9-.2 1.4-.2 6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-3 3.8M6.4 7.6A16 16 0 0 0 2.5 12S6 18.5 12 18.5c1.5 0 2.8-.4 4-.9" /><path d="M9.9 9.9a2.8 2.8 0 0 0 4.2 3.7" /></>,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
};
export function Icon({ name, size = 20 }: { name: keyof typeof P; size?: number }) {
  return <svg className="ico" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">{P[name]}</svg>;
}

/** Minimal split layout: brand panel with a curved edge on the left, one calm card on the right. Phones get a slim brand header. */
export function AuthFrame({ children }: { children: ReactNode; headline?: string; body?: string }) {
  return (
    <div className="auth">
      <section className="auth-art">
        <BrandLogo plate priority className="auth-logo" />
        <div className="auth-title"><i className="auth-bar" aria-hidden /><p className="auth-brand">OES Portal<br />SZABMU</p></div>
        <small className="auth-foot">Secure, role-based access with a full audit trail.</small>
      </section>
      <main className="auth-form"><div className="auth-card">{children}</div></main>
    </div>
  );
}

/** Card heading: icon tile + title (+ optional lead line). */
export function AuthHeading({ icon, title, lead }: { icon: keyof typeof P; title: string; lead?: ReactNode }) {
  return <div className="auth-head"><span className="auth-tile"><Icon name={icon} size={22} /></span><div><h1>{title}</h1>{lead && <p className="muted">{lead}</p>}</div></div>;
}

interface FieldProps { label: string; icon: keyof typeof P; value: string; onChange: (v: string) => void; onBlur?: () => void; type?: 'text' | 'email' | 'password' | 'date'; required?: boolean; error?: string; hint?: string; placeholder?: string; autoComplete?: string; autoFocus?: boolean; inputMode?: 'email' | 'tel' | 'numeric' | 'text'; min?: string; max?: string; mono?: boolean }
/** Label above a bordered control with a leading icon; passwords get a show/hide switch. The error line is reserved so it never shifts the button. */
export function AuthField({ label, icon, value, onChange, onBlur, type = 'text', required, error, hint, placeholder, autoComplete, autoFocus, inputMode, min, max, mono }: FieldProps) {
  const id = useId(); const [shown, setShown] = useState(false); const isPw = type === 'password';
  return (
    <div className="af">
      <label htmlFor={id}>{label}{required && <> <span aria-hidden className="req">*</span></>}</label>
      <div className={`af-wrap${error ? ' bad' : ''}`}>
        <Icon name={icon} />
        <input id={id} className={mono ? 'mono' : ''} type={isPw && shown ? 'text' : type} value={value} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} required={required} placeholder={placeholder}
          autoComplete={autoComplete} autoFocus={autoFocus} inputMode={inputMode} min={min} max={max} aria-invalid={error ? true : undefined} aria-describedby={`${id}-m`} />
        {isPw && <button type="button" className="af-eye" onClick={() => setShown(!shown)} aria-pressed={shown} aria-label={shown ? 'Hide characters' : 'Show characters'}><Icon name={shown ? 'eye' : 'eyeOff'} /></button>}
      </div>
      <span className={error ? 'err-text' : 'hint'} id={`${id}-m`} role={error ? 'alert' : undefined}>{error || hint}</span>
    </div>
  );
}

export function AuthButton({ children, busy, disabled }: { children: ReactNode; busy?: boolean; disabled?: boolean }) {
  return <button className="auth-btn" disabled={busy || disabled}>{children}<Icon name="arrow" size={18} /></button>;
}
