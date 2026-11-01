'use client';
import Link from 'next/link';
import { useState } from 'react';
import { get, fmtDate } from '@/api';
import { errMsg } from '@/ui';
import { AuthFrame } from '../AuthFrame';

export default function Verify() {
  const [serial, setSerial] = useState(''); const [code, setCode] = useState(''); const [res, setRes] = useState<any>(null); const [err, setErr] = useState('');
  return (
    <AuthFrame headline="Verify a certificate." body="Employers and institutions can confirm that a certificate was issued by the university, using the serial and verify code printed on it.">
      <div><h1>Certificate verification</h1><p className="muted" style={{ margin: '4px 0 0' }}>Enter both values exactly as printed on the certificate.</p></div>
      <form className="stack" onSubmit={async (e) => { e.preventDefault(); setErr(''); setRes(null); try { setRes(await get(`/public/verify?serial=${encodeURIComponent(serial)}&code=${encodeURIComponent(code)}`)); } catch (x) { setErr(errMsg(x)); } }}>
        <label className="f">Serial<input className="in mono" value={serial} onChange={(e) => setSerial(e.target.value)} placeholder="SZABMU/2026/1000" /></label>
        <label className="f">Verify code<input className="in mono" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} /></label>
        <button className="btn btn-primary" disabled={!serial || !code} style={{ justifyContent: 'center', padding: 10 }}>Verify</button>
      </form>
      {err && <div className="notice bad" role="alert">{err}</div>}
      {res && (res.valid ? <div className="notice ok" data-testid="verify-ok"><b>Valid certificate.</b><br />Holder: {res.holder}<br />Examination: {res.exam}<br />Issued: {fmtDate(res.issuedAt)}</div> : <div className="notice bad" data-testid="verify-bad"><b>Not verified.</b> The serial and code do not match a valid certificate.</div>)}
      <div className="small muted"><Link href="/login">Back to sign in</Link></div>
    </AuthFrame>
  );
}
