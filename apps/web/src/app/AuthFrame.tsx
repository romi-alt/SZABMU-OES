'use client';
import { useId, useState, type ReactNode } from 'react';
import { BrandLogo } from '@/brand';
import { Icon, type IconName } from '@/icons';
import { usePortal } from '@/portal-context';

export { Icon };

/** Split layout: burgundy brand panel with the campus photo in a curved window on the left, one calm card (and an optional note) on the right. Phones get a slim brand header. */
export function AuthFrame({ children, note, wide }: { children: ReactNode; note?: ReactNode; wide?: boolean }) {
  const staff = usePortal() === 'staff'; // the staff dashboard never mentions candidate-only things such as the exam schedule
  return (
    <div className={`auth${wide ? ' auth-wide' : ''}`}>
      <section className="auth-art">
        <div className="auth-photo" aria-hidden />
        <div className="auth-art-text">
          <BrandLogo white priority className="auth-logo" />
          <div className="auth-title"><i className="auth-bar" aria-hidden /><p className="auth-brand">OES Portal<br />SZABMU</p></div>
          <p className="auth-sub">Online Examination System</p>
          <p className="auth-desc">A secure and role-based platform for managing and taking online examinations at SZABMU.</p>
          <ul className="auth-feats">
            <li><Icon name="laptop" size={30} /><span>Take Exams<br />Online</span></li>
            {!staff && <li><Icon name="calendar" size={30} /><span>Exam<br />Schedule</span></li>}
            <li><Icon name="shieldCheck" size={30} /><span>Secure &amp;<br />Monitored</span></li>
          </ul>
        </div>
      </section>
      <main className="auth-form">
        <div className="auth-card">{children}</div>
        {note && <aside className="auth-note"><Icon name="info" size={26} /><b>Important</b><div>{note}</div></aside>}
      </main>
    </div>
  );
}

/** Card heading: icon tile + title (+ optional lead line). */
export function AuthHeading({ icon, title, lead }: { icon: IconName; title: string; lead?: ReactNode }) {
  return <div className="auth-head"><span className="auth-tile"><Icon name={icon} size={22} /></span><div><h1>{title}</h1>{lead && <p className="muted">{lead}</p>}</div></div>;
}

interface FieldProps { label: string; icon: IconName; value: string; onChange: (v: string) => void; onBlur?: () => void; type?: 'text' | 'email' | 'password' | 'date'; required?: boolean; error?: string; hint?: string; placeholder?: string; autoComplete?: string; autoFocus?: boolean; inputMode?: 'email' | 'tel' | 'numeric' | 'text'; min?: string; max?: string; mono?: boolean; maxLength?: number }
/** Label above a bordered control with a leading icon; passwords get a show/hide switch. The error line is reserved so it never shifts the button. */
export function AuthField({ label, icon, value, onChange, onBlur, type = 'text', required, error, hint, placeholder, autoComplete, autoFocus, inputMode, min, max, mono, maxLength }: FieldProps) {
  const id = useId(); const [shown, setShown] = useState(false); const isPw = type === 'password';
  return (
    <div className="af">
      <label htmlFor={id}>{label}{required && <> <span aria-hidden className="req">*</span></>}</label>
      <div className={`af-wrap${error ? ' bad' : ''}`}>
        <Icon name={icon} />
        <input id={id} className={mono ? 'mono' : ''} type={isPw && shown ? 'text' : type} value={value} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} required={required} placeholder={placeholder}
          autoComplete={autoComplete} autoFocus={autoFocus} inputMode={inputMode} min={min} max={max} maxLength={maxLength} aria-invalid={error ? true : undefined} aria-describedby={`${id}-m`} />
        {isPw && <button type="button" className="af-eye" onClick={() => setShown(!shown)} aria-pressed={shown} aria-label={shown ? 'Hide characters' : 'Show characters'}><Icon name={shown ? 'eye' : 'eyeOff'} /></button>}
      </div>
      <span className={error ? 'err-text' : 'hint'} id={`${id}-m`} role={error ? 'alert' : undefined}>{error || hint}</span>
    </div>
  );
}

export function AuthButton({ children, busy, disabled }: { children: ReactNode; busy?: boolean; disabled?: boolean }) {
  return <button className="auth-btn" disabled={busy || disabled}>{children}<Icon name="arrow" size={18} /></button>;
}
