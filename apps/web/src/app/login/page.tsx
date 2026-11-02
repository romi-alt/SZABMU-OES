'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { post } from '@/api';
import { usePortal } from '@/portal-context';
import { useMe } from '@/session';
import { errMsg } from '@/ui';
import { AuthButton, AuthField, AuthFrame, AuthHeading } from '../AuthFrame';

export default function Login() {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const staff = usePortal() === 'staff'; const router = useRouter(); const { me, refresh } = useMe(); const [expired, setExpired] = useState(false);
  useEffect(() => { try { if (sessionStorage.getItem('oes:expired') === '1') { setExpired(true); sessionStorage.removeItem('oes:expired'); } } catch { /* storage unavailable */ } }, []);
  useEffect(() => { if (me) router.replace('/dashboard'); }, [me, router]);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try { await post('/auth/login', { email, password }); await refresh(); router.replace('/dashboard'); }
    catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  }
  return (
    <AuthFrame note={<>{!staff && <p>Check your exam schedule and guidelines before attempting your examination.</p>}<small className={staff ? 'plain' : ''}>Accounts lock for 15 minutes after 5 failed attempts. Trouble signing in? Contact your campus administrator or the IT helpdesk.</small></>}>
      <AuthHeading icon="user" title="Sign in" lead="Access your SZABMU examination account" />
      {expired && <div className="notice warn" role="status" data-testid="session-expired">Your session has expired or was ended. Please sign in again — answers already saved are kept.</div>}
      <form onSubmit={submit} noValidate>
        <AuthField label="University email" icon="mail" type="email" value={email} onChange={setEmail} autoFocus autoComplete="username" placeholder="Enter your university email" />
        <AuthField label="Password" icon="lock" type="password" value={password} onChange={setPassword} autoComplete="current-password" placeholder="Enter your password" />
        {err && <div className="notice bad" role="alert">{err}</div>}
        <div className="auth-row"><Link href="/forgot" className="auth-link">Forgot password?</Link></div>
        <AuthButton busy={busy} disabled={!email || !password}>{busy ? 'Signing in…' : 'Sign in'}</AuthButton>
      </form>
      {!staff && <p className="auth-alt"><span>New student?</span><Link href="/register" className="auth-link">Create your account</Link></p>}
    </AuthFrame>
  );
}
