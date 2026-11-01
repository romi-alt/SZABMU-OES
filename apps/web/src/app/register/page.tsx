'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { checkPassword } from '@oes/shared';
import { post } from '@/api';
import { errMsg } from '@/ui';
import { AuthFrame } from '../AuthFrame';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
type Touched = Partial<Record<'regNo' | 'dob' | 'email' | 'pw' | 'pw2', boolean>>;

/** Student registration: details must match the official register, then a code sent to the email proves control of it. */
export default function Register() {
  const [step, setStep] = useState<'details' | 'code' | 'done'>('details');
  const [regNo, setRegNo] = useState(''); const [dob, setDob] = useState(''); const [email, setEmail] = useState(''); const [pw, setPw] = useState(''); const [pw2, setPw2] = useState('');
  const [touched, setTouched] = useState<Touched>({}); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [devCode, setDevCode] = useState(''); const [info, setInfo] = useState('');
  const [digits, setDigits] = useState(['', '', '', '', '', '']); const refs = useRef<(HTMLInputElement | null)[]>([]); const code = digits.join('');
  useEffect(() => { document.title = 'Student registration · SZABMU OES'; }, []);

  const today = new Date().toISOString().slice(0, 10);
  const strength = checkPassword(pw, [email.split('@')[0] ?? '']);
  const errors = {
    regNo: regNo.trim().length < 3 ? 'Enter your registration number.' : '',
    dob: !dob ? 'Enter your date of birth.' : dob >= today || dob < '1940-01-01' ? 'Enter a valid date of birth.' : '',
    email: !EMAIL_RE.test(email) ? 'Enter a valid email address.' : '',
    pw: strength.ok ? '' : strength.problems[0] ?? 'Choose a stronger password.',
    pw2: pw2 !== pw ? 'Passwords do not match.' : '',
  };
  const invalid = Object.values(errors).some(Boolean);
  const show = (k: keyof Touched) => (touched[k] ? errors[k] : '');
  const blur = (k: keyof Touched) => () => setTouched((t) => ({ ...t, [k]: true }));

  async function run(fn: () => Promise<void>) { setBusy(true); setErr(''); try { await fn(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); } }
  const submit = () => { setTouched({ regNo: true, dob: true, email: true, pw: true, pw2: true }); if (invalid) return Promise.resolve(); return run(async () => {
    const r = await post('/auth/register', { regNo: regNo.trim(), dateOfBirth: dob, email: email.trim(), password: pw }); setInfo(r.message); setDevCode(r.devCode ?? ''); setDigits(['', '', '', '', '', '']); setStep('code'); }); };
  const verify = () => run(async () => { await post('/auth/register/verify', { email: email.trim(), code }); setStep('done'); });
  function onDigit(i: number, v: string) { const d = v.replace(/\D/g, '').slice(-1); const n = [...digits]; n[i] = d; setDigits(n); if (d && i < 5) refs.current[i + 1]?.focus(); }
  function onPaste(e: React.ClipboardEvent) { const t = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6); if (t.length === 6) { e.preventDefault(); setDigits(t.split('')); } }
  const fieldErr = (id: string, msg: string) => <span className="err-text" id={id} role={msg ? 'alert' : undefined} style={{ minHeight: 18 }}>{msg}</span>;   // reserved space: a message appearing on blur must not move the button under the pointer

  return (
    <AuthFrame headline="Create your student account." body="Only students on the official register of their institution can register. Your account gives you access to your schedule, examinations and results.">
      {step === 'details' && <>
        <div><h1>Student registration</h1><p className="muted" style={{ margin: '4px 0 0' }}>Fields marked <span aria-hidden>*</span><span className="sr-only">with an asterisk</span> are required.</p></div>
        <form className="stack" noValidate onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <label className="f"><span>Registration number <span aria-hidden>*</span></span>
            <input className="in mono" value={regNo} onChange={(e) => setRegNo(e.target.value)} onBlur={blur('regNo')} required autoFocus autoComplete="off" aria-invalid={!!show('regNo')} aria-describedby="reg-hint reg-err" />
            <span className="hint" id="reg-hint">Exactly as on your admission letter, e.g. DMC-A-2024-0008</span>{fieldErr('reg-err', show('regNo'))}</label>
          <label className="f"><span>Date of birth <span aria-hidden>*</span></span>
            <input className="in" type="date" value={dob} min="1940-01-01" max={today} onChange={(e) => setDob(e.target.value)} onBlur={blur('dob')} required autoComplete="bday" aria-invalid={!!show('dob')} aria-describedby="dob-err" />{fieldErr('dob-err', show('dob'))}</label>
          <label className="f"><span>Email address <span aria-hidden>*</span></span>
            <input className="in" type="email" value={email} onChange={(e) => setEmail(e.target.value)} onBlur={blur('email')} required autoComplete="email" inputMode="email" aria-invalid={!!show('email')} aria-describedby="em-hint em-err" />
            <span className="hint" id="em-hint">We send a 6-digit code here. This will be your sign-in email.</span>{fieldErr('em-err', show('email'))}</label>
          <label className="f"><span>Password <span aria-hidden>*</span></span>
            <input className="in" type="password" value={pw} onChange={(e) => setPw(e.target.value)} onBlur={blur('pw')} required autoComplete="new-password" aria-invalid={!!show('pw')} aria-describedby="pw-hint pw-err" /></label>
          <div className="meter" aria-hidden>{[1, 2, 3, 4].map((n) => <i key={n} className={strength.score >= n ? (strength.score <= 2 ? 'weak' : 'on') : ''} />)}</div>
          <span className="small" id="pw-hint" style={{ color: strength.ok ? 'var(--green)' : 'var(--ink-3)' }}>{pw ? (strength.ok ? 'Strong password' : strength.problems[0]) : 'At least 10 characters, three of four character types.'}</span>
          {fieldErr('pw-err', touched.pw && pw ? '' : show('pw'))}
          <label className="f"><span>Confirm password <span aria-hidden>*</span></span>
            <input className="in" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} onBlur={blur('pw2')} required autoComplete="new-password" aria-invalid={!!show('pw2')} aria-describedby="pw2-err" />{fieldErr('pw2-err', show('pw2'))}</label>
          {err && <div className="notice bad" role="alert">{err}</div>}
          <button className="btn btn-primary" disabled={busy} style={{ justifyContent: 'center', padding: 10 }}>Continue →</button>
        </form>
        <div className="notice small"><b>Not on the register?</b> Ask your campus examination office to add you. Registering does not enrol you in any examination.</div>
      </>}
      {step === 'code' && <>
        <div><h1>Check your email</h1><p className="muted" style={{ margin: '4px 0 0' }} data-testid="register-info">{info}</p></div>
        <form className="stack" onSubmit={(e) => { e.preventDefault(); void verify(); }}>
          <span className="f" id="otp-label">Verification code</span>
          <div className="otp" role="group" aria-labelledby="otp-label" onPaste={onPaste}>{digits.map((d, i) => <input key={i} ref={(el) => { refs.current[i] = el; }} inputMode="numeric" autoComplete="one-time-code" aria-label={`Digit ${i + 1}`} value={d} onChange={(e) => onDigit(i, e.target.value)} onKeyDown={(e) => { if (e.key === 'Backspace' && !digits[i] && i > 0) refs.current[i - 1]?.focus(); }} autoFocus={i === 0} />)}</div>
          {devCode && <div className="notice warn small" data-testid="dev-code">Development mode — code: <b className="mono">{devCode}</b></div>}
          {err && <div className="notice bad" role="alert">{err}</div>}
          <button className="btn btn-primary" disabled={busy || code.length !== 6} style={{ justifyContent: 'center', padding: 10 }}>Create my account →</button>
          <button type="button" className="btn-link small" onClick={() => { setStep('details'); setErr(''); }}>Wrong details? Go back</button>
        </form>
      </>}
      {step === 'done' && <><h1>Account created</h1><div className="notice ok" role="status">Your student account is ready. Sign in with <b>{email.trim()}</b> and the password you chose.</div><Link className="btn btn-primary" href="/login" style={{ justifyContent: 'center' }}>Go to sign in</Link></>}
      {step !== 'done' && <div className="small muted">Already registered? <Link href="/login">Back to sign in</Link></div>}
    </AuthFrame>
  );
}
