'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { post } from '@/api';
import { useMe } from '@/session';
import { errMsg } from '@/ui';
import { AuthFrame } from '../AuthFrame';

export default function Login() {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const router = useRouter(); const { me, refresh } = useMe();
  useEffect(() => { if (me) router.replace('/dashboard'); }, [me, router]);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try { await post('/auth/login', { email, password }); await refresh(); router.replace('/dashboard'); }
    catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  }
  return (
    <AuthFrame headline="Examination portal for the next generation of medical professionals." body="Schedule, conduct and approve examinations across the university's constituent and affiliated institutions — with role-based control and a full audit trail.">
      <div><h1>Sign in</h1><p className="muted" style={{ margin: '4px 0 0' }}>Use your university account. Students, lecturers, examiners, invigilators and administrators sign in here.</p></div>
      <form className="stack" onSubmit={submit} noValidate>
        <label className="f">University email<input className="in" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></label>
        <label className="f">Password<input className="in" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        {err && <div className="notice bad" role="alert">{err}</div>}
        <div className="row between"><span className="small faint">Accounts lock for 15 minutes after 5 failed attempts.</span><Link href="/forgot" className="small" style={{ whiteSpace: "nowrap" }}>Forgot password?</Link></div>
        <button className="btn btn-primary" disabled={busy || !email || !password} style={{ justifyContent: 'center', padding: '10px' }}>{busy ? 'Signing in…' : 'Sign in →'}</button>
      </form>
      <div className="small faint">Trouble signing in? Contact your campus administrator or the university IT helpdesk.</div>
    </AuthFrame>
  );
}
