'use client';
import { useState } from 'react';
import { checkPassword, isValidPhone, PHONE_HINT } from '@oes/shared';
import { patch, post, fmtDT, fmtDate } from '@/api';
import { useMe } from '@/session';
import { Card, Field, Notice, PageHead, useAction, useToast } from '@/ui';

export default function Profile() {
  const { me, refresh, logout } = useMe(); const { run, busy } = useAction(); const toast = useToast();
  const [phone, setPhone] = useState(me?.phone ?? ''); const [address, setAddress] = useState(me?.student?.address ?? ''); const [guardian, setGuardian] = useState(me?.student?.guardianPhone ?? '');
  const [cur, setCur] = useState(''); const [pw, setPw] = useState(''); const [pw2, setPw2] = useState('');
  if (!me) return null;
  const phoneErr = isValidPhone(phone) ? '' : PHONE_HINT; const guardianErr = me.student && !isValidPhone(guardian) ? PHONE_HINT : ''; const detailsInvalid = !!(phoneErr || guardianErr);
  const strength = checkPassword(pw, [me.fullName.split(' ')[0] ?? '']);
  return (
    <>
      <PageHead title="My profile" sub="Personal details and account security." />
      {me.mustChangePw && <Notice tone="warn"><b>You are using a temporary password.</b> Choose a new one below to continue.</Notice>}
      <div className="grid g2" style={{ marginTop: 14, alignItems: 'start' }}>
        <Card title="Account details" actions={<button className="btn btn-green btn-sm" disabled={busy || detailsInvalid} onClick={() => run(async () => { await patch('/auth/profile', { phone, ...(me.student ? { address, guardianPhone: guardian } : {}) }); await refresh(); }, 'Profile saved')}>Save changes</button>}>
          <div className="stack">
            <div className="grid g2"><Field label="Full name" hint="Managed by your institution"><input className="in" value={me.fullName} readOnly /></Field><Field label="Email"><input className="in" value={me.email} readOnly /></Field></div>
            {me.student && <div className="grid g2"><Field label="Registration no."><input className="in mono" value={me.student.regNo} readOnly /></Field><Field label="Programme"><input className="in" value={`${me.student.program} · Semester ${me.student.semester}`} readOnly /></Field><Field label="Institution"><input className="in" value={me.student.institution.name} readOnly /></Field><Field label="Date of birth"><input className="in" value={me.student.dateOfBirth ? fmtDate(me.student.dateOfBirth) : '—'} readOnly /></Field></div>}
            <Field label="Phone" error={phoneErr}><input className="in" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={30} aria-invalid={!!phoneErr} /></Field>
            {me.student && <><Field label="Address"><input className="in" value={address} onChange={(e) => setAddress(e.target.value)} maxLength={300} /></Field><Field label="Emergency contact" error={guardianErr}><input className="in" inputMode="tel" value={guardian} onChange={(e) => setGuardian(e.target.value)} maxLength={30} aria-invalid={!!guardianErr} /></Field></>}
            <div className="small faint">Last sign-in: {fmtDT(me.lastLoginAt)}</div>
          </div>
        </Card>
        {me.role !== 'STUDENT' && (
          <Card title="Two-factor authentication">
            <div className="stack">
              {me.mfa?.enabled ? <Notice tone="ok">Two-factor authentication is on for your account.{me.mfa.required ? ' Your role requires it; to replace a lost device ask a Super Administrator to reset it.' : ''}</Notice>
                : <><div className="muted">Add an authenticator app as a second step when you sign in.{me.mfa?.required ? ' Your role requires this.' : ' Recommended for anyone who can see question papers or results.'}</div><a className="btn btn-sm" href="/mfa?setup=1" style={{ alignSelf: 'start' }}>Set up two-factor authentication</a></>}
            </div>
          </Card>
        )}
        <Card title="Change password">
          <form className="stack" onSubmit={(e) => { e.preventDefault(); void run(async () => { await post('/auth/change-password', { currentPassword: cur, newPassword: pw }); toast('Password updated. Other devices were signed out.'); setCur(''); setPw(''); setPw2(''); await refresh(); }); }}>
            <Field label="Current password"><input className="in" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></Field>
            <Field label="New password" hint="At least 10 characters; three of lower / upper / digit / symbol."><input className="in" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
            <div className="meter" aria-hidden>{[1, 2, 3, 4].map((n) => <i key={n} className={strength.score >= n ? (strength.score <= 2 ? 'weak' : 'on') : ''} />)}</div>
            {pw && !strength.ok && <span className="err-text">{strength.problems[0]}</span>}
            <Field label="Confirm new password"><input className="in" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>
            <div className="row"><button className="btn btn-primary" disabled={busy || !cur || !strength.ok || pw !== pw2}>Update password</button><button type="button" className="btn" onClick={logout}>Sign out</button></div>
          </form>
        </Card>
      </div>
    </>
  );
}
