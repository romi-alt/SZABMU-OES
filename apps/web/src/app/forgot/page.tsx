'use client';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { checkPassword } from '@oes/shared';
import { post } from '@/api';
import { errMsg } from '@/ui';
import { AuthButton, AuthField, AuthFrame, AuthHeading, Icon } from '../AuthFrame';

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
    <AuthFrame>
      {step === 'email' && <>
        <AuthHeading icon="mail" title="Forgot Password" lead="Enter your university email — we'll send a 6-digit verification code." />
        <form onSubmit={(e) => { e.preventDefault(); void sendCode(); }}>
          <AuthField label="University email" icon="mail" type="email" value={email} onChange={setEmail} autoFocus autoComplete="username" placeholder="Enter your email" hint="The code expires in 10 minutes." />
          {err && <div className="notice bad" role="alert">{err}</div>}
          <AuthButton busy={busy} disabled={!email}>Send verification code</AuthButton>
        </form>
        <p className="small faint" style={{ margin: 0, textAlign: 'center' }}>Trouble signing in? Contact your campus administrator or the IT helpdesk.</p>
      </>}
      {step === 'code' && <>
        <AuthHeading icon="mail" title="Verify it's you" lead="If that address is registered, a 6-digit code has been sent to it." />
        <form onSubmit={(e) => { e.preventDefault(); void verify(); }}>
          <span className="f" id="otp-label" style={{ fontWeight: 600, fontSize: 13.5 }}>Verification code</span>
          <div className="otp" role="group" aria-labelledby="otp-label" onPaste={onPaste}>{digits.map((d, i) => <input key={i} ref={(el) => { refs.current[i] = el; }} inputMode="numeric" aria-label={`Digit ${i + 1}`} value={d} onChange={(e) => onDigit(i, e.target.value)} onKeyDown={(e) => { if (e.key === 'Backspace' && !digits[i] && i > 0) refs.current[i - 1]?.focus(); }} autoFocus={i === 0} />)}</div>
          {devCode && <div className="notice warn small" data-testid="dev-code">Development mode — code: <b className="mono">{devCode}</b></div>}
          {err && <div className="notice bad" role="alert">{err}</div>}
          <AuthButton busy={busy} disabled={code.length !== 6}>Verify</AuthButton>
          <button type="button" className="btn-link small" onClick={() => void sendCode()}>Resend code</button>
        </form>
      </>}
      {step === 'reset' && <>
        <AuthHeading icon="lock" title="Set a new password" lead="You cannot reuse any of your last 5 passwords." />
        <form onSubmit={(e) => { e.preventDefault(); void reset(); }}>
          <AuthField label="New password" icon="lock" type="password" value={pw} onChange={setPw} autoFocus autoComplete="new-password" placeholder="Create a password" />
          <div className="meter" aria-hidden>{[1, 2, 3, 4].map((n) => <i key={n} className={strength.score >= n ? (strength.score <= 2 ? 'weak' : 'on') : ''} />)}</div>
          <span className="small" style={{ color: strength.ok ? 'var(--green)' : 'var(--ink-3)', minHeight: 20 }}>{pw ? (strength.ok ? 'Strong password' : strength.problems[0]) : 'At least 10 characters, three of four character types.'}</span>
          <AuthField label="Confirm password" icon="lock" type="password" value={pw2} onChange={setPw2} autoComplete="new-password" placeholder="Re-enter your password" error={pw2 && pw !== pw2 ? 'Passwords do not match.' : ''} />
          {err && <div className="notice bad" role="alert">{err}</div>}
          <AuthButton busy={busy} disabled={!strength.ok || pw !== pw2}>Update password</AuthButton>
          <div className="notice ok small">You&apos;ll be signed out of all other devices for security.</div>
        </form>
      </>}
      {step === 'done' && <>
        <AuthHeading icon="lock" title="Password updated" />
        <div className="notice ok">Your password has been changed. Other devices have been signed out.</div>
        <Link className="auth-btn" href="/login" style={{ textDecoration: 'none' }}>Back to sign in<Icon name="arrow" size={18} /></Link>
      </>}
      {step !== 'done' && <p className="auth-alt">Remembered it? <Link href="/login" className="auth-link">Back to sign in</Link></p>}
    </AuthFrame>
  );
}
