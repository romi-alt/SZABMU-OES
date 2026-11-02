'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { checkPassword } from '@oes/shared';
import { useRouter } from 'next/navigation';
import { post } from '@/api';
import { useMe } from '@/session';
import { errMsg } from '@/ui';
import { AuthButton, AuthField, AuthFrame, AuthHeading } from '../AuthFrame';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
type Touched = Partial<Record<'regNo' | 'email' | 'pw' | 'pw2', boolean>>;

/** Student sign-up: registration number, email and password; a code sent to the email proves control of it, then the student continues to the one-time profile. */
export default function Register() {
  const [step, setStep] = useState<'details' | 'code'>('details'); const router = useRouter(); const { refresh } = useMe();
  const [regNo, setRegNo] = useState(''); const [email, setEmail] = useState(''); const [pw, setPw] = useState(''); const [pw2, setPw2] = useState('');
  const [touched, setTouched] = useState<Touched>({}); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [devCode, setDevCode] = useState(''); const [info, setInfo] = useState('');
  const [digits, setDigits] = useState(['', '', '', '', '', '']); const refs = useRef<(HTMLInputElement | null)[]>([]); const code = digits.join('');
  useEffect(() => { document.title = 'Student registration · SZABMU OES'; }, []);

  const strength = checkPassword(pw, [email.split('@')[0] ?? '']);
  const errors = {
    regNo: !/^[A-Za-z0-9][A-Za-z0-9._/-]{2,39}$/.test(regNo.trim()) ? 'Enter your registration number (letters, digits . _ / - only).' : '',
    email: !EMAIL_RE.test(email) ? 'Enter a valid email address.' : '',
    pw: strength.ok ? '' : strength.problems[0] ?? 'Choose a stronger password.',
    pw2: pw2 !== pw ? 'Passwords do not match.' : '',
  };
  const invalid = Object.values(errors).some(Boolean);
  const show = (k: keyof Touched) => (touched[k] ? errors[k] : '');
  const blur = (k: keyof Touched) => () => setTouched((t) => ({ ...t, [k]: true }));

  async function run(fn: () => Promise<void>) { setBusy(true); setErr(''); try { await fn(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); } }
  const submit = () => { setTouched({ regNo: true, email: true, pw: true, pw2: true }); if (invalid) return Promise.resolve(); return run(async () => {
    const r = await post('/auth/register', { regNo: regNo.trim(), email: email.trim(), password: pw }); setInfo(r.message); setDevCode(r.devCode ?? ''); setDigits(['', '', '', '', '', '']); setStep('code'); }); };
  const verify = () => run(async () => { await post('/auth/register/verify', { email: email.trim(), code }); await refresh(); router.replace('/complete-profile'); });
  function onDigit(i: number, v: string) { const d = v.replace(/\D/g, '').slice(-1); const n = [...digits]; n[i] = d; setDigits(n); if (d && i < 5) refs.current[i + 1]?.focus(); }
  function onPaste(e: React.ClipboardEvent) { const t = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6); if (t.length === 6) { e.preventDefault(); setDigits(t.split('')); } }

  return (
    <AuthFrame>
      {step === 'details' && <>
        <AuthHeading icon="userPlus" title="Student Registration" lead={<>Fields marked <span aria-hidden>*</span><span className="sr-only">with an asterisk</span> are required.</>} />
        <form noValidate onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <AuthField label="Registration number" icon="id" mono value={regNo} onChange={setRegNo} onBlur={blur('regNo')} required autoFocus autoComplete="off" placeholder="e.g. DMC-A-2024-0008" error={show('regNo')} hint="The number printed on your admission letter or student card." />
          <AuthField label="Email address" icon="mail" type="email" value={email} onChange={setEmail} onBlur={blur('email')} required autoComplete="email" inputMode="email" placeholder="Enter your email" error={show('email')} hint="We send a 6-digit code here. It becomes your sign-in email." />
          <AuthField label="Password" icon="lock" type="password" value={pw} onChange={setPw} onBlur={blur('pw')} required autoComplete="new-password" placeholder="Create a password" error={touched.pw && pw ? '' : show('pw')} />
          <div className="meter" aria-hidden>{[1, 2, 3, 4].map((n) => <i key={n} className={strength.score >= n ? (strength.score <= 2 ? 'weak' : 'on') : ''} />)}</div>
          <span className="small" style={{ color: strength.ok ? 'var(--green)' : 'var(--ink-3)', minHeight: 20 }}>{pw ? (strength.ok ? 'Strong password' : strength.problems[0]) : 'At least 10 characters, three of four character types.'}</span>
          <AuthField label="Confirm password" icon="lock" type="password" value={pw2} onChange={setPw2} onBlur={blur('pw2')} required autoComplete="new-password" placeholder="Re-enter your password" error={show('pw2')} />
          {err && <div className="notice bad" role="alert">{err}</div>}
          <AuthButton busy={busy}>Create Account</AuthButton>
        </form>
        <p className="auth-alt">Already registered? <Link href="/login" className="auth-link">Sign in</Link></p>
        <p className="auth-alt" style={{ borderTop: 0, paddingTop: 0, marginTop: 0 }}><span>Teaching staff?</span><Link href="/register/teacher" className="auth-link">Register as a teacher</Link></p>
        <p className="small faint" style={{ margin: 0, textAlign: 'center' }}>Signing up does not enrol you in any examination. After this you complete a short profile once.</p>
      </>}
      {step === 'code' && <>
        <AuthHeading icon="mail" title="Check your email" lead={<span data-testid="register-info">{info}</span>} />
        <form onSubmit={(e) => { e.preventDefault(); void verify(); }}>
          <span className="f" id="otp-label" style={{ fontWeight: 600, fontSize: 13.5 }}>Verification code</span>
          <div className="otp" role="group" aria-labelledby="otp-label" onPaste={onPaste}>{digits.map((d, i) => <input key={i} ref={(el) => { refs.current[i] = el; }} inputMode="numeric" autoComplete="one-time-code" aria-label={`Digit ${i + 1}`} value={d} onChange={(e) => onDigit(i, e.target.value)} onKeyDown={(e) => { if (e.key === 'Backspace' && !digits[i] && i > 0) refs.current[i - 1]?.focus(); }} autoFocus={i === 0} />)}</div>
          {devCode && <div className="notice warn small" data-testid="dev-code">Development mode — code: <b className="mono">{devCode}</b></div>}
          {err && <div className="notice bad" role="alert">{err}</div>}
          <AuthButton busy={busy} disabled={code.length !== 6}>Create Account</AuthButton>
        </form>
        <p className="auth-alt">Wrong details? <button type="button" className="btn-link auth-link" onClick={() => { setStep('details'); setErr(''); }}>Go back</button></p>
      </>}
    </AuthFrame>
  );
}
