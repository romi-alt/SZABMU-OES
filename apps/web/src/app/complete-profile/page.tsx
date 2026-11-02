'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { isValidPhone, PHONE_HINT } from '@oes/shared';
import { get, post } from '@/api';
import { BrandLogo } from '@/brand';
import { photoToDataUrl } from '@/image';
import { useMe } from '@/session';
import { Field, Loading, Notice, errMsg, useToast } from '@/ui';

interface Catalog { institutions: { id: string; code: string; name: string }[]; programs: { id: string; code: string; name: string }[]; programsByInstitution: Record<string, string[]>; semestersByProgram: Record<string, number[]>; batchYears: number[] }
const GENDERS = [['MALE', 'Male'], ['FEMALE', 'Female'], ['OTHER', 'Other']] as const;

/**
 * One-time student profile. Shown right after sign-up (or when a student signs in with an incomplete profile) and never again once saved.
 * Colleges, programmes, semesters and academic years come from existing records; the choices are validated again on the server.
 */
export default function CompleteProfile() {
  const { me, loading, refresh, logout } = useMe(); const router = useRouter(); const toast = useToast();
  const [cat, setCat] = useState<Catalog | null>(null); const [catErr, setCatErr] = useState('');
  const [f, setF] = useState({ fullName: '', fatherName: '', gender: '', dateOfBirth: '', mobile: '', institutionId: '', programId: '', semester: '', batchYear: '' });
  const [photo, setPhoto] = useState(''); const [tried, setTried] = useState(false); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  useEffect(() => { document.title = 'Complete your profile · SZABMU OES'; }, []);
  useEffect(() => { if (me?.role === 'STUDENT' && me.onboarding?.required) get<Catalog>('/onboarding/catalog').then(setCat).catch((e) => setCatErr(errMsg(e))); }, [me]);

  const programs = useMemo(() => { if (!cat) return []; const allowed = cat.programsByInstitution[f.institutionId]; return allowed?.length ? cat.programs.filter((p) => allowed.includes(p.id)) : cat.programs; }, [cat, f.institutionId]);
  const semesters = cat?.semestersByProgram[f.programId] ?? [];
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v, ...(k === 'institutionId' ? { programId: '', semester: '' } : {}), ...(k === 'programId' ? { semester: '' } : {}) }));
  const today = new Date().toISOString().slice(0, 10);
  const e = {
    fullName: f.fullName.trim().length < 3 ? 'Enter your full name.' : '', fatherName: f.fatherName.trim().length < 3 ? "Enter your father's name." : '', gender: f.gender ? '' : 'Select your gender.',
    mobile: f.mobile.trim() && isValidPhone(f.mobile) ? '' : PHONE_HINT, institutionId: f.institutionId ? '' : 'Select your college.', programId: f.programId ? '' : 'Select your degree programme.',
    semester: f.semester ? '' : 'Select your semester.', batchYear: f.batchYear ? '' : 'Select your academic year.', dateOfBirth: f.dateOfBirth && (f.dateOfBirth >= today || f.dateOfBirth < '1940-01-01') ? 'Enter a valid date of birth.' : '',
  };
  const invalid = Object.values(e).some(Boolean); const show = (k: keyof typeof e) => (tried ? e[k] : '');

  async function submit() {
    setTried(true); setErr(''); if (invalid) { setTimeout(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(), 30); return; }
    setBusy(true);
    try {
      await post('/onboarding/complete', { fullName: f.fullName.trim(), fatherName: f.fatherName.trim(), gender: f.gender, institutionId: f.institutionId, programId: f.programId, semester: Number(f.semester), batchYear: Number(f.batchYear), mobile: f.mobile.trim(), dateOfBirth: f.dateOfBirth || undefined, photo: photo || undefined });
      await refresh(); toast('Profile saved'); router.replace('/schedule');
    } catch (x) { setErr(errMsg(x)); setBusy(false); }                                    // the form keeps everything the student typed
  }

  if (loading || !me) return <div style={{ padding: 40 }}><Loading /></div>;
  const sel = (label: string, k: keyof typeof f, children: React.ReactNode, opts: { disabled?: boolean; required?: boolean } = {}) => (
    <Field label={label} required={opts.required ?? true} error={show(k as keyof typeof e)}><select className="in" value={f[k]} disabled={opts.disabled} aria-invalid={show(k as keyof typeof e) ? true : undefined} onChange={(ev) => set(k, ev.target.value)}>{children}</select></Field>);
  return (
    <div className="cp">
      <header className="cp-bar"><BrandLogo className="cp-logo" priority /><button className="btn" onClick={logout}>Sign out</button></header>
      <main className="cp-main" id="main">
        <h1 tabIndex={-1}>Complete your profile</h1>
        <p className="cp-lead">This is a one-time step. When you save, you go straight to your examinations. Fields marked * are required.</p>
        {catErr && <Notice tone="bad">{catErr}</Notice>}
        {!cat && !catErr ? <div className="skeleton" style={{ height: 240 }} aria-busy="true" aria-label="Loading" /> : cat && (
          <form noValidate onSubmit={(ev) => { ev.preventDefault(); void submit(); }} className="cp-form">
            <section aria-labelledby="cp-personal" className="cp-section">
              <h2 id="cp-personal">Personal details</h2>
              <div className="cp-grid">
                <Field label="Full name" required error={show('fullName')}><input className="in" value={f.fullName} maxLength={120} autoComplete="name" autoFocus aria-invalid={show('fullName') ? true : undefined} onChange={(ev) => set('fullName', ev.target.value)} /></Field>
                <Field label="Father's name" required error={show('fatherName')}><input className="in" value={f.fatherName} maxLength={120} aria-invalid={show('fatherName') ? true : undefined} onChange={(ev) => set('fatherName', ev.target.value)} /></Field>
                {sel('Gender', 'gender', <><option value="">Select</option>{GENDERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</>)}
                <Field label="Mobile number" required error={show('mobile')}><input className="in" inputMode="tel" autoComplete="tel" placeholder="+92 300 1234567" value={f.mobile} maxLength={20} aria-invalid={show('mobile') ? true : undefined} onChange={(ev) => set('mobile', ev.target.value)} /></Field>
                <Field label="Date of birth (optional)" error={show('dateOfBirth')}><input className="in" type="date" value={f.dateOfBirth} min="1940-01-01" max={today} autoComplete="bday" aria-invalid={show('dateOfBirth') ? true : undefined} onChange={(ev) => set('dateOfBirth', ev.target.value)} /></Field>
                <div className="cp-photo">
                  {photo ? <img src={photo} alt="Your photograph" width={64} height={64} /> : <span className="cp-ph" aria-hidden>{(f.fullName.trim()[0] ?? '?').toUpperCase()}</span>}
                  <div><span className="cp-label">Photograph (optional)</span><div className="row"><label className="btn btn-sm">{photo ? 'Change' : 'Choose photo'}<input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={async (ev) => { const file = ev.target.files?.[0]; if (!file) return; try { setErr(''); setPhoto(await photoToDataUrl(file)); } catch (x) { setErr((x as Error).message); } }} /></label>{photo && <button type="button" className="btn btn-sm" onClick={() => setPhoto('')}>Remove</button>}</div></div>
                </div>
              </div>
            </section>
            <section aria-labelledby="cp-academic" className="cp-section">
              <h2 id="cp-academic">Academic details</h2>
              <div className="cp-grid">
                <Field label="Registration number"><input className="in mono" value={me.onboarding?.regNo ?? ''} readOnly aria-readonly="true" /></Field>
                {sel('College / institution', 'institutionId', <><option value="">Select your college</option>{cat.institutions.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</>)}
                {sel('Degree programme', 'programId', <><option value="">{f.institutionId ? 'Select your programme' : 'Select a college first'}</option>{programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</>, { disabled: !f.institutionId })}
                {sel('Semester', 'semester', <><option value="">{f.programId ? 'Select your semester' : 'Select a programme first'}</option>{semesters.map((s) => <option key={s} value={s}>Semester {s}</option>)}</>, { disabled: !f.programId })}
                {sel('Academic year (year of admission)', 'batchYear', <><option value="">Select</option>{cat.batchYears.map((y) => <option key={y} value={y}>{y}</option>)}</>)}
              </div>
              <p className="cp-note">Your college, programme and semester are checked by your campus examination office. After you save they can only be changed by them, and you can sit an examination only once they are verified and you are assigned to it.</p>
            </section>
            {err && <Notice tone="bad">{err}</Notice>}
            <div className="cp-actions"><button className="btn btn-green cp-save" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save and continue'}</button></div>
          </form>)}
      </main>
    </div>
  );
}
