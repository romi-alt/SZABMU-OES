'use client';
import { BrandLogo } from '@/brand';
import { useParams } from 'next/navigation';
import { fmtDate, useGet } from '@/api';
import Link from 'next/link';
import { Async, Notice, PageHead } from '@/ui';

export default function Certificate() {
  const { id } = useParams<{ id: string }>(); const st = useGet<any>(`/me/results/${id}/certificate`);
  return (
    <>
      <PageHead title="Certificate">{st.data && <button className="btn btn-green no-print" onClick={() => window.print()}>Print certificate</button>}</PageHead>
      {st.error && <Notice>Certificates are issued only for examinations you passed, after the results are published. <Link href="/results">Back to your results</Link></Notice>}
      <Async state={st}>{(c) => (
        <div className="cert" data-testid="certificate">
          <BrandLogo className="cert-logo" />
          <h1>Certificate of Examination Success</h1>
          <p className="muted">This is to certify that</p>
          <div className="name">{c.student.fullName}</div>
          <p className="muted">Registration No. <b className="mono">{c.student.regNo}</b> · {c.student.institution}</p>
          <p>has successfully passed the examination in <b>{c.course}</b> ({c.program}) — <i>{c.exam}</i> — with <b>{c.rawScore} / {c.totalMarks}</b> marks ({c.percent.toFixed(1)}%).</p>
          <div className="row between small" style={{ marginTop: 32 }}><div>Issued {fmtDate(c.issuedAt)}</div><div className="right">Serial <b className="mono">{c.serial}</b><br />Verify code <b className="mono">{c.verifyCode}</b></div></div>
          <p className="small faint no-print" style={{ marginTop: 16 }}>Anyone can verify this certificate at <a href="/verify">/verify</a> using the serial and verify code.</p>
        </div>)}</Async>
    </>
  );
}
