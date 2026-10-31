'use client';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { checkPassword } from '@oes/shared';
import { post } from '@/api';
import { errMsg } from '@/ui';
import { AuthFrame } from '../AuthFrame';

export default function Forgot() {
  const [step, setStep] = useState<'email' | 'code' | 'reset' | 'done'>('email');
  const [email, setEmail] = useState(''); const [digits, setDigits] = useState(['', '', '', '', '', '']); const [token, setToken] = useState('');
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [devCode, setDevCode] = useState('');
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const code = digits.join('');
  const strength = checkPassword(pw, [email.split('@')[0] ?? '']);

  async function run(fn: () => Promise<void>) { setBusy(true); setErr(''); try { await fn(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); } }
  const sendCode = () => run(async () => { const r = await post('/auth/forgot', { email }); if (r.devCode) setDevCode(r.devCode); setStep('code'); });
  const verify = () => run(async () => { const r = await post('/auth/verify-code', { email, code }); setToken(r.resetToken); setStep('reset'); });
  const reset = () => run(async () => { await post('/auth/reset', { resetToken: token, newPassword: pw }); setStep('done'); });
  function onDigit(i: number, v: string) {
    const d = v.replace(/\D/g, '').slice(-1); const n = [...digits]; n[i] = d; setDigits(n);
    if (d && i < 5) refs.current[i + 1]?.focus();
  }
  function onPaste(e: React.ClipboardEvent) { const t = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6); if (t.length === 6) { e.preventDefault(); setDigits(t.split('')); } }

  return (
    <AuthFrame headline="A complete examination platform — from enrolment to certification." body="Secure authentication, role-based access and a full audit trail across every role.">
      {step === 'email' && <>
        <div><h1>Forgot password?</h1><p className="muted" style={{ margin: '4px 0 0' }}>Enter your university email — we'll send a 6-digit verification code.</p></div>
        <form className="stack" onSubmit={(e) => { e.preventDefault(); void sendCode(); }}>
          <label className="f">University email<input className="in" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus autoComplete="username" /></label>
          <span className="hint">The code expires in 10 minutes.</span>
          {err && <div className="notice bad" role="alert">{err}</div>}
          <button className="btn btn-primary" disabled={busy || !email} style={{ justifyContent: 'center', padding: 10 }}>Send verification code →</button>
        </form>
        <div className="notice"><b>Trouble signing in?</b> Contact your campus administrator or the IT helpdesk.</div>
      </>}
      {step === 'code' && <>
        <div><h1>Verify it&apos;s you</h1><p className="muted" style={{ margin: '4px 0 0' }}>If that address is registered, a 6-digit code has been sent to it.</p></div>
        <form className="stack" onSubmit={(e) => { e.preventDefault(); void verify(); }}>
          <span className="f">Verification code</span>
          <div className="otp" onPaste={onPaste}>{digits.map((d, i) => <input key={i} ref={(el) => { refs.current[i] = el; }} inputMode="numeric" aria-label={`Digit ${i + 1}`} value={d} onChange={(e) => onDigit(i, e.target.value)} onKeyDown={(e) => { if (e.key === 'Backspace' && !digits[i] && i > 0) refs.current[i - 1]?.focus(); }} autoFocus={i === 0} />)}</div>
          {devCode && <div className="notice warn small" data-testid="dev-code">Development mode — code: <b className="mono">{devCode}</b></div>}
          {err && <div className="notice bad" role="alert">{err}</div>}
          <button className="btn btn-primary" disabled={busy || code.length !== 6} style={{ justifyContent: 'center', padding: 10 }}>Verify →</button>
          <button type="button" className="btn-link small" onClick={() => void sendCode()}>Resend code</button>
        </form>
      </>}
      {step === 'reset' && <>
        <div><h1>Set a new password</h1><p className="muted" style={{ margin: '4px 0 0' }}>You cannot reuse any of your last 5 passwords.</p></div>
        <form className="stack" onSubmit={(e) => { e.preventDefault(); void reset(); }}>
          <label className="f">New password<input className="in" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus /></label>
          <div className="meter" aria-hidden>{[1, 2, 3, 4].map((n) => <i key={n} className={strength.score >= n ? (strength.score <= 2 ? 'weak' : 'on') : ''} />)}</div>
          <span className="small" style={{ color: strength.ok ? 'var(--green)' : 'var(--ink-3)' }}>{pw ? (strength.ok ? 'Strong password' : strength.problems[0]) : 'At least 10 characters, three of four character types.'}</span>
          <label className="f">Confirm password<input className="in" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></label>
          {pw2 && pw !== pw2 && <span className="err-text">Passwords do not match.</span>}
          {err && <div className="notice bad" role="alert">{err}</div>}
          <button className="btn btn-primary" disabled={busy || !strength.ok || pw !== pw2} style={{ justifyContent: 'center', padding: 10 }}>Update password →</button>
          <div className="notice ok small">You&apos;ll be signed out of all other devices for security.</div>
        </form>
      </>}
      {step === 'done' && <><h1>Password updated</h1><div className="notice ok">Your password has been changed. Other devices have been signed out.</div><Link className="btn btn-primary" href="/login" style={{ justifyContent: 'center' }}>Back to sign in</Link></>}
      {step !== 'done' && <div className="small muted">Remembered it? <Link href="/login">Back to sign in</Link></div>}
    </AuthFrame>
  );
}
