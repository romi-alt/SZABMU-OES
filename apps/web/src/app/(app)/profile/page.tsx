'use client';
import { useState } from 'react';
import { checkPassword, isValidPhone, PHONE_HINT } from '@oes/shared';
import { patch, post, fmtDT, fmtDate } from '@/api';
import { useMe } from '@/session';
import { CancelButton, Card, Field, Modal, Notice, PageHead, useAction, useToast } from '@/ui';
import { TeacherDetails } from './TeacherDetails';

export default function Profile() {
  const { me, refresh, logout } = useMe(); const { run, busy } = useAction(); const toast = useToast();
  const [phone, setPhone] = useState(me?.phone ?? ''); const [address, setAddress] = useState(me?.student?.address ?? ''); const [guardian, setGuardian] = useState(me?.student?.guardianPhone ?? '');
  const [father, setFather] = useState(me?.student?.fatherName ?? ''); const [gender, setGender] = useState(me?.student?.gender ?? ''); const [change, setChange] = useState(false);
  const [cur, setCur] = useState(''); const [pw, setPw] = useState(''); const [pw2, setPw2] = useState(''); const [pwTried, setPwTried] = useState(false);
  if (!me) return null;
  const phoneErr = isValidPhone(phone) ? '' : PHONE_HINT; const guardianErr = me.student && !isValidPhone(guardian) ? PHONE_HINT : ''; const detailsInvalid = !!(phoneErr || guardianErr);
  const strength = checkPassword(pw, [me.fullName.split(' ')[0] ?? '']);
  return (
    <>
      <PageHead title="My profile" sub="Personal details and account security." />
      {me.mustChangePw && <Notice tone="warn"><b>You are using a temporary password.</b> Choose a new one below to continue.</Notice>}
      <div className="grid g2" style={{ marginTop: 14, alignItems: 'start' }}>
        {me.role === 'TEACHER' ? <TeacherDetails /> : (
        <Card title="Account details" actions={<button className="btn btn-green btn-sm" disabled={busy || detailsInvalid} onClick={() => run(async () => { await patch('/auth/profile', { phone, ...(me.student ? { address, guardianPhone: guardian, ...(father.trim().length >= 3 ? { fatherName: father.trim() } : {}), ...(gender ? { gender } : {}) } : {}) }); await refresh(); }, 'Profile saved')}>Save changes</button>}>
          <div className="stack">
            <dl className="facts" aria-label="Managed by your institution"><div><dt>Full name</dt><dd>{me.fullName}</dd></div><div><dt>Email</dt><dd style={{ overflowWrap: 'anywhere' }}>{me.email}</dd></div></dl>
            {me.student && <section aria-label="Academic details" className="acad">
              <dl className="facts"><div><dt>Registration no.</dt><dd className="mono">{me.student.regNo}</dd></div><div><dt>College</dt><dd>{me.student.institution.name}</dd></div><div><dt>Programme</dt><dd>{me.student.programName} · Semester {me.student.semester}</dd></div><div><dt>Date of birth</dt><dd>{me.student.dateOfBirth ? fmtDate(me.student.dateOfBirth) : '—'}</dd></div></dl>
              {me.student.selfDeclared && <p className="notice warn small" style={{ margin: '10px 0 0' }} data-testid="unverified-note">Your college, programme and semester are waiting for verification by your campus examination office. You can sit an examination once they are verified and you are assigned to it.</p>}
              <p className="small faint" style={{ margin: '10px 0 0' }}>These details decide which examinations you are assigned to, so only your campus examination office can change them. <button type="button" className="btn-link" onClick={() => setChange(true)}>Request a change</button></p>
            </section>}
            {me.student && <div className="grid g2"><Field label="Father's name"><input className="in" value={father} onChange={(e) => setFather(e.target.value)} maxLength={120} /></Field><Field label="Gender"><select className="in" value={gender} onChange={(e) => setGender(e.target.value)}><option value="">Not set</option><option value="MALE">Male</option><option value="FEMALE">Female</option><option value="OTHER">Other</option></select></Field></div>}
            <Field label="Phone" error={phoneErr}><input className="in" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={30} aria-invalid={!!phoneErr} /></Field>
            {me.student && <><Field label="Address"><input className="in" value={address} onChange={(e) => setAddress(e.target.value)} maxLength={300} /></Field><Field label="Emergency contact" error={guardianErr}><input className="in" inputMode="tel" value={guardian} onChange={(e) => setGuardian(e.target.value)} maxLength={30} aria-invalid={!!guardianErr} /></Field></>}
            <div className="small faint">Last sign-in: {fmtDT(me.lastLoginAt)}</div>
          </div>
        </Card>
        )}
        {me.role !== 'STUDENT' && (
          <Card title="Two-factor authentication">
            <div className="stack">
              {me.mfa?.enabled ? <Notice tone="ok">Two-factor authentication is on for your account.{me.mfa.required ? ' Your role requires it; to replace a lost device ask a Super Administrator to reset it.' : ''}</Notice>
                : <><div className="muted">Add an authenticator app as a second step when you sign in.{me.mfa?.required ? ' Your role requires this.' : ' Recommended for anyone who can see question papers or results.'}</div><a className="btn btn-sm" href="/mfa?setup=1" style={{ alignSelf: 'start' }}>Set up two-factor authentication</a></>}
            </div>
          </Card>
        )}
        <Card title="Change password">
          <form className="stack" onSubmit={(e) => { e.preventDefault(); setPwTried(true); if (!cur || !strength.ok || pw !== pw2) return; void run(async () => { await post('/auth/change-password', { currentPassword: cur, newPassword: pw }); toast('Password updated. Other devices were signed out.'); setCur(''); setPw(''); setPw2(''); setPwTried(false); await refresh(); }); }}>
            <Field label="Current password" error={pwTried && !cur ? 'Enter your current password.' : undefined}><input className="in" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></Field>
            <Field label="New password" hint="At least 10 characters; three of lower / upper / digit / symbol."><input className="in" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
            <div className="meter" aria-hidden>{[1, 2, 3, 4].map((n) => <i key={n} className={strength.score >= n ? (strength.score <= 2 ? 'weak' : 'on') : ''} />)}</div>
            {(pw || pwTried) && !strength.ok && <span className="err-text">{pw ? strength.problems[0] : 'Enter a new password.'}</span>}
            <Field label="Confirm new password" error={pwTried && pw2 !== pw ? 'The two new passwords do not match.' : undefined}><input className="in" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>
            <div className="row"><button className="btn btn-primary" disabled={busy}>Update password</button><button type="button" className="btn" onClick={logout}>Sign out</button></div>
          </form>
        </Card>
      </div>
      {change && <ChangeRequest onClose={() => setChange(false)} />}
    </>
  );
}

function ChangeRequest({ onClose }: { onClose: () => void }) {
  const [note, setNote] = useState(''); const { run, busy } = useAction(); const toast = useToast();
  return (
    <Modal title="Request a change to academic details" onClose={onClose} missing={note.trim().length >= 10 ? [] : ['What should change (at least 10 characters)']} footer={<><CancelButton /><button className="btn btn-primary" disabled={busy || note.trim().length < 10} onClick={() => run(async () => { await post('/student/change-request', { note }); toast('Request sent to your campus examination office'); onClose(); })}>Send request</button></>}>
      <Field label="What should change?" required hint="Your campus examination office reviews the request. Nothing changes until they act on it."><textarea className="in" rows={4} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} /></Field>
    </Modal>
  );
}
