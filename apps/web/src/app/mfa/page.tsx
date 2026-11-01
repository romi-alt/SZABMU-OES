'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { post } from '@/api';
import { useMe } from '@/session';
import { errMsg } from '@/ui';
import { AuthFrame } from '../AuthFrame';

/** Second factor: verify a code (state "pending") or enrol an authenticator app (state "enroll", or opt-in from the profile). */
export default function Mfa() {
  const { me, refresh, logout } = useMe(); const router = useRouter();
  const [code, setCode] = useState(''); const [useRecovery, setUseRecovery] = useState(false); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null); const [codes, setCodes] = useState<string[] | null>(null); const [saved, setSaved] = useState(false);
  const state = me?.mfa?.state;
  const optIn = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('setup') && !me?.mfa?.enabled; // voluntary enrolment (roles that are not required to)
  useEffect(() => { if (me && state === 'ok' && !codes && !setup && !optIn) router.replace('/dashboard'); }, [me, state, codes, setup, optIn, router]);
  const run = async (fn: () => Promise<void>) => { setBusy(true); setErr(''); try { await fn(); } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); } };

  if (!me) return null;
  if (codes) {
    return (
      <AuthFrame headline="Two-factor authentication is on." body="Your account now needs your authenticator app at every sign-in.">
        <div><h1>Save your recovery codes</h1><p className="muted" style={{ margin: '4px 0 0' }}>Each code works once if you lose your phone. They will not be shown again.</p></div>
        <pre className="code" aria-label="Recovery codes" style={{ columns: 2, padding: 12, background: '#FAF7F4', border: '1px solid #E9DDDA', borderRadius: 6 }}>{codes.join('\n')}</pre>
        <label className="row"><input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> I have stored these codes somewhere safe</label>
        <button className="btn btn-primary" disabled={!saved} onClick={async () => { await refresh(); router.replace('/dashboard'); }}>Continue</button>
      </AuthFrame>
    );
  }
  if (state === 'enroll' || setup || optIn) {
    return (
      <AuthFrame headline="Protect examination data." body="Staff who can schedule exams, approve papers or publish results must use a second factor.">
        <div><h1>Set up two-factor authentication</h1><p className="muted" style={{ margin: '4px 0 0' }}>Use an authenticator app (Google Authenticator, Microsoft Authenticator, FreeOTP, …).</p></div>
        {!setup ? (
          <button className="btn btn-primary" disabled={busy} onClick={() => run(async () => setSetup(await post('/auth/mfa/setup')))}>Begin setup</button>
        ) : (
          <form className="stack" onSubmit={(e) => { e.preventDefault(); void run(async () => { const r = await post<{ recoveryCodes: string[] }>('/auth/mfa/enable', { code }); setCodes(r.recoveryCodes); }); }}>
            <div className="notice">Add an account in your app using <b>manual entry</b>, with this key:</div>
            <div className="code" data-testid="mfa-secret" style={{ fontSize: 16, letterSpacing: 2, wordBreak: 'break-all' }}>{setup.secret}</div>
            <div className="small faint">Or open this link on the phone: <a href={setup.otpauthUrl}>otpauth link</a></div>
            <label className="f">6-digit code from the app<input className="in mono" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus /></label>
            {err && <div className="notice bad" role="alert">{err}</div>}
            <button className="btn btn-primary" disabled={busy || code.length !== 6}>Verify and turn on</button>
          </form>
        )}
        {!setup && err && <div className="notice bad" role="alert">{err}</div>}
        {state === 'enroll' ? <button className="btn-link small" onClick={logout}>Sign out</button> : <button className="btn-link small" onClick={() => router.replace('/dashboard')}>Not now</button>}
      </AuthFrame>
    );
  }
  return (
    <AuthFrame headline="One more step." body="Enter the code from your authenticator app to finish signing in.">
      <div><h1>Two-factor verification</h1><p className="muted" style={{ margin: '4px 0 0' }}>{useRecovery ? 'Enter one of your single-use recovery codes.' : 'Enter the 6-digit code from your authenticator app.'}</p></div>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void run(async () => { await post('/auth/mfa/verify', useRecovery ? { recoveryCode: code } : { code }); await refresh(); router.replace('/dashboard'); }); }}>
        <label className="f">{useRecovery ? 'Recovery code' : 'Authentication code'}<input className="in mono" inputMode={useRecovery ? 'text' : 'numeric'} autoComplete="one-time-code" maxLength={useRecovery ? 20 : 6} value={code} onChange={(e) => setCode(useRecovery ? e.target.value : e.target.value.replace(/\D/g, ''))} autoFocus /></label>
        {err && <div className="notice bad" role="alert">{err}</div>}
        <button className="btn btn-primary" disabled={busy || (useRecovery ? code.length < 8 : code.length !== 6)}>Verify</button>
      </form>
      <div className="row between"><button className="btn-link small" onClick={() => { setUseRecovery(!useRecovery); setCode(''); setErr(''); }}>{useRecovery ? 'Use authenticator app' : 'Lost your phone? Use a recovery code'}</button><button className="btn-link small" onClick={logout}>Sign out</button></div>
    </AuthFrame>
  );
}
