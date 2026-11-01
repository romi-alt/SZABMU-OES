'use client';
import Link from 'next/link';
import { useState } from 'react';
import { get, fmtDate } from '@/api';
import { errMsg } from '@/ui';
import { AuthButton, AuthField, AuthFrame, AuthHeading } from '../AuthFrame';

export default function Verify() {
  const [serial, setSerial] = useState(''); const [code, setCode] = useState(''); const [res, setRes] = useState<any>(null); const [err, setErr] = useState('');
  return (
    <AuthFrame>
      <AuthHeading icon="certificate" title="Certificate verification" lead="Enter both values exactly as printed on the certificate." />
      <form onSubmit={async (e) => { e.preventDefault(); setErr(''); setRes(null); try { setRes(await get(`/public/verify?serial=${encodeURIComponent(serial)}&code=${encodeURIComponent(code)}`)); } catch (x) { setErr(errMsg(x)); } }}>
        <AuthField label="Serial" icon="id" mono value={serial} onChange={setSerial} placeholder="SZABMU/2026/1000" />
        <AuthField label="Verify code" icon="key" mono value={code} onChange={(v) => setCode(v.toUpperCase())} placeholder="e.g. 7K2QX9" />
        <AuthButton disabled={!serial || !code}>Verify</AuthButton>
      </form>
      {err && <div className="notice bad" role="alert">{err}</div>}
      {res && (res.valid ? <div className="notice ok" data-testid="verify-ok"><b>Valid certificate.</b><br />Holder: {res.holder}<br />Examination: {res.exam}<br />Issued: {fmtDate(res.issuedAt)}</div> : <div className="notice bad" data-testid="verify-bad"><b>Not verified.</b> The serial and code do not match a valid certificate.</div>)}
      <p className="auth-alt"><Link href="/login" className="auth-link">Back to sign in</Link></p>
    </AuthFrame>
  );
}
