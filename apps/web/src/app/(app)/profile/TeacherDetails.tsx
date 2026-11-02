'use client';
import { useEffect, useState } from 'react';
import { isValidPhone, PHONE_HINT } from '@oes/shared';
import { fmtDT, patch, useGet } from '@/api';
import { photoToDataUrl } from '@/image';
import { useMe } from '@/session';
import { Async, Card, Field, Notice, useAction, useToast } from '@/ui';

/** Teacher details. Name, email, faculty ID and class/subject assignments are managed by administrators, so they are shown as text, not as inputs. */
export function TeacherDetails() {
  const { refresh } = useMe(); const st = useGet<any>('/teacher/profile'); const { run, busy } = useAction(); const toast = useToast();
  const [f, setF] = useState<{ phone: string; department: string; designation: string; photo: string | null | undefined } | null>(null); const [err, setErr] = useState('');
  useEffect(() => { if (st.data && !f) setF({ phone: st.data.phone ?? '', department: st.data.department, designation: st.data.designation, photo: undefined }); }, [st.data, f]);
  return (
    <Card title="Personal details">
      <Async state={st}>{(d) => f && (
        <div className="stack">
          <dl className="facts"><div><dt>Name</dt><dd>{d.fullName}</dd></div><div><dt>Email</dt><dd>{d.email}</dd></div><div><dt>Faculty / employee ID</dt><dd className="mono">{d.employeeId}</dd></div></dl>
          <p className="small faint" style={{ margin: 0 }}>These and your classes and subjects are managed by the university.</p>
          <div className="photo-row">
            {(f.photo === undefined ? d.photo : f.photo) ? <img src={(f.photo === undefined ? d.photo : f.photo)!} alt="Your profile photo" width={72} height={72} /> : <span className="photo-ph" aria-hidden>{d.fullName.charAt(0)}</span>}
            <div className="row"><label className="btn btn-sm">Change photo<input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; try { setErr(''); setF({ ...f, photo: await photoToDataUrl(file) }); } catch (x) { setErr((x as Error).message); } }} /></label>
              {(f.photo === undefined ? d.photo : f.photo) && <button className="btn btn-sm" type="button" onClick={() => setF({ ...f, photo: null })}>Remove</button>}</div>
          </div>
          {err && <Notice tone="bad">{err}</Notice>}
          <Field label="Phone" error={isValidPhone(f.phone) ? undefined : PHONE_HINT}><input className="in" inputMode="tel" autoComplete="tel" value={f.phone} maxLength={30} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          <div className="grid g2"><Field label="Department"><input className="in" value={f.department} maxLength={120} onChange={(e) => setF({ ...f, department: e.target.value })} /></Field><Field label="Designation"><input className="in" value={f.designation} maxLength={120} onChange={(e) => setF({ ...f, designation: e.target.value })} /></Field></div>
          <div className="row"><button className="btn btn-green" disabled={busy || !isValidPhone(f.phone) || f.department.trim().length < 2 || f.designation.trim().length < 2}
            onClick={() => run(async () => { await patch('/teacher/profile', { phone: f.phone, department: f.department, designation: f.designation, ...(f.photo !== undefined ? { photo: f.photo } : {}) }); toast('Profile saved'); setF(null); st.reload?.(); await refresh(); })}>Save changes</button>
            <span className="small faint">Last sign-in: {fmtDT(d.lastLoginAt)}</span></div>
        </div>)}
      </Async>
    </Card>
  );
}
