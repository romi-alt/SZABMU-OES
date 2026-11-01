'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { post } from '@/api';
import { useMe } from '@/session';
import { errMsg } from '@/ui';
import { AuthButton, AuthField, AuthFrame, AuthHeading } from '../AuthFrame';

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
      <AuthFrame>
        <AuthHeading icon="key" title="Save your recovery codes" lead="Each code works once if you lose your phone. They will not be shown again." />
        <pre className="code" aria-label="Recovery codes" style={{ columns: 2, padding: 14, margin: 0, background: 'var(--ivory)', border: '1px solid var(--rose)', borderRadius: 12 }}>{codes.join('\n')}</pre>
        <label className="row"><input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> I have stored these codes somewhere safe</label>
        <button className="auth-btn" disabled={!saved} onClick={async () => { await refresh(); router.replace('/dashboard'); }}>Continue</button>
      </AuthFrame>
    );
  }
  if (state === 'enroll' || setup || optIn) {
    return (
      <AuthFrame>
        <AuthHeading icon="shield" title="Set up two-factor authentication" lead="Use an authenticator app (Google Authenticator, Microsoft Authenticator, FreeOTP, …). Staff who can schedule exams, approve papers or publish results must use a second factor." />
        {!setup ? (
          <button className="auth-btn" disabled={busy} onClick={() => run(async () => setSetup(await post('/auth/mfa/setup')))}>Begin setup</button>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); void run(async () => { const r = await post<{ recoveryCodes: string[] }>('/auth/mfa/enable', { code }); setCodes(r.recoveryCodes); }); }}>
            <div className="notice">Add an account in your app using <b>manual entry</b>, with this key:</div>
            <div className="code" data-testid="mfa-secret" style={{ fontSize: 16, letterSpacing: 2, wordBreak: 'break-all', padding: '8px 0' }}>{setup.secret}</div>
            <div className="small faint">Or open this link on the phone: <a href={setup.otpauthUrl}>otpauth link</a></div>
            <AuthField label="6-digit code from the app" icon="key" mono inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(v) => setCode(v.replace(/\D/g, ''))} autoFocus />
            {err && <div className="notice bad" role="alert">{err}</div>}
            <AuthButton busy={busy} disabled={code.length !== 6}>Verify and turn on</AuthButton>
          </form>
        )}
        {!setup && err && <div className="notice bad" role="alert">{err}</div>}
        {state === 'enroll' ? <button className="btn-link small" onClick={logout}>Sign out</button> : <button className="btn-link small" onClick={() => router.replace('/dashboard')}>Not now</button>}
      </AuthFrame>
    );
  }
  return (
    <AuthFrame>
      <AuthHeading icon="shield" title="Two-factor verification" lead={useRecovery ? 'Enter one of your single-use recovery codes.' : 'Enter the 6-digit code from your authenticator app.'} />
      <form onSubmit={(e) => { e.preventDefault(); void run(async () => { await post('/auth/mfa/verify', useRecovery ? { recoveryCode: code } : { code }); await refresh(); router.replace('/dashboard'); }); }}>
        <AuthField label={useRecovery ? 'Recovery code' : 'Authentication code'} icon="key" mono inputMode={useRecovery ? 'text' : 'numeric'} autoComplete="one-time-code" maxLength={useRecovery ? 20 : 6} value={code} onChange={(v) => setCode(useRecovery ? v : v.replace(/\D/g, ''))} autoFocus />
        {err && <div className="notice bad" role="alert">{err}</div>}
        <AuthButton busy={busy} disabled={useRecovery ? code.length < 8 : code.length !== 6}>Verify</AuthButton>
      </form>
      <div className="row between"><button className="btn-link small" onClick={() => { setUseRecovery(!useRecovery); setCode(''); setErr(''); }}>{useRecovery ? 'Use authenticator app' : 'Lost your phone? Use a recovery code'}</button><button className="btn-link small" onClick={logout}>Sign out</button></div>
    </AuthFrame>
  );
}
