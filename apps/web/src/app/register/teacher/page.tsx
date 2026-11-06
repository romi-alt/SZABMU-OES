'use client';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { checkPassword, isValidPhone, PHONE_HINT } from '@oes/shared';
import { get, post } from '@/api';
import { photoToDataUrl } from '@/image';
import { usePortal } from '@/portal-context';
import { staffSignInHref } from '@/portal-urls';
import { errMsg } from '@/ui';
import { AuthField, AuthFrame, AuthHeading, Icon } from '../../AuthFrame';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/; const DRAFT = 'oes:teacher-reg:v1';
type Step = 1 | 2 | 3 | 'code' | 'done';
interface Catalog { offerings?: { institutionId: string; programId: string; intakeStopped: boolean }[]; institutions: { id: string; code: string; name: string }[]; programs: { id: string; code: string; name: string }[]; courses: { id: string; programId: string; code: string; title: string; semester: number }[]; terms: string[]; termsByClass: { term: string; institutionId: string; programId: string; semester: number }[] }
interface Combo { institutionId: string; programId: string; semester: number; term: string; courseId: string }
const key = (c: Combo) => `${c.institutionId}|${c.courseId}|${c.term}`;

/**
 * Teacher registration in three steps. Nothing selected here gives access: the classes and subjects are REQUESTS that an administrator approves one by one.
 * Entered values are kept while moving between steps (and across a reload, except passwords and the photo).
 */
export default function TeacherRegister() {
  const portal = usePortal();
  const [step, setStep] = useState<Step>(1); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [tried, setTried] = useState<Record<string, boolean>>({});
  const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [pw, setPw] = useState(''); const [pw2, setPw2] = useState('');
  const [combos, setCombos] = useState<Combo[]>([]);
  const [empId, setEmpId] = useState(''); const [dept, setDept] = useState(''); const [desig, setDesig] = useState(''); const [phone, setPhone] = useState(''); const [photo, setPhoto] = useState('');
  const [cat, setCat] = useState<Catalog | null>(null); const [catErr, setCatErr] = useState('');
  const [devCode, setDevCode] = useState(''); const [info, setInfo] = useState(''); const [digits, setDigits] = useState(['', '', '', '', '', '']); const refs = useRef<(HTMLInputElement | null)[]>([]); const code = digits.join('');
  const head = useRef<HTMLHeadingElement>(null);

  useEffect(() => { document.title = 'Teacher registration · SZABMU OES'; try { const d = JSON.parse(sessionStorage.getItem(DRAFT) ?? 'null'); if (d) { setName(d.name ?? ''); setEmail(d.email ?? ''); setCombos(d.combos ?? []); setEmpId(d.empId ?? ''); setDept(d.dept ?? ''); setDesig(d.desig ?? ''); setPhone(d.phone ?? ''); } } catch { /* no draft */ } }, []);
  useEffect(() => { try { sessionStorage.setItem(DRAFT, JSON.stringify({ name, email, combos, empId, dept, desig, phone })); } catch { /* storage unavailable */ } }, [name, email, combos, empId, dept, desig, phone]);
  useEffect(() => { get<Catalog>('/teacher-registration/catalog').then(setCat).catch((e) => setCatErr(errMsg(e))); }, []);
  useEffect(() => { head.current?.focus(); window.scrollTo?.({ top: 0 }); }, [step]);

  const strength = checkPassword(pw, [email.split('@')[0] ?? '', name]);
  const e1 = { name: name.trim().length < 3 ? 'Enter your full name.' : '', email: !EMAIL_RE.test(email.trim()) ? 'Enter a valid email address.' : '', pw: strength.ok ? '' : strength.problems[0] ?? 'Choose a stronger password.', pw2: pw2 !== pw ? 'Passwords do not match.' : '' };
  const e3 = { empId: !/^[A-Za-z0-9._/-]{2,40}$/.test(empId.trim()) ? 'Enter your faculty / employee ID (letters, digits . _ / -).' : '', dept: dept.trim().length < 2 ? 'Enter your department.' : '', desig: desig.trim().length < 2 ? 'Enter your designation.' : '', phone: isValidPhone(phone) && phone.trim() ? '' : PHONE_HINT };
  const show = <T extends Record<string, string>>(e: T, k: keyof T & string) => (tried[k] ? e[k] : '');
  const touch = (k: string) => () => setTried((t) => ({ ...t, [k]: true }));
  const focusFirstError = () => setTimeout(() => document.querySelector<HTMLElement>('[aria-invalid="true"], [data-invalid="true"]')?.focus(), 30);

  const next = () => {
    setErr('');
    if (step === 1) { setTried((t) => ({ ...t, name: true, email: true, pw: true, pw2: true })); if (Object.values(e1).some(Boolean)) return focusFirstError(); setStep(2); }
    else if (step === 2) { if (!combos.length) { setErr('Add at least one class and subject to continue.'); return; } setStep(3); }
  };
  async function submit() {
    setTried((t) => ({ ...t, empId: true, dept: true, desig: true, phone: true })); if (Object.values(e3).some(Boolean)) return focusFirstError();
    setBusy(true); setErr('');
    try {
      const r = await post('/teacher-registration', { fullName: name.trim(), email: email.trim(), password: pw, employeeId: empId.trim(), department: dept.trim(), designation: desig.trim(), phone: phone.trim(), photo: photo || undefined, assignments: combos });
      setInfo(r.message); setDevCode(r.devCode ?? ''); setDigits(['', '', '', '', '', '']); setStep('code');
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  }
  async function verify() {
    setBusy(true); setErr('');
    try { await post('/teacher-registration/verify', { email: email.trim(), code }); try { sessionStorage.removeItem(DRAFT); } catch { /* ignore */ } setPw(''); setPw2(''); setStep('done'); }
    catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  }
  const onDigit = (i: number, v: string) => { const d = v.replace(/\D/g, '').slice(-1); const n = [...digits]; n[i] = d; setDigits(n); if (d && i < 5) refs.current[i + 1]?.focus(); };
  const onPaste = (e: React.ClipboardEvent) => { const t = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6); if (t.length === 6) { e.preventDefault(); setDigits(t.split('')); } };
  const labelOf = (c: Combo) => { const i = cat?.institutions.find((x) => x.id === c.institutionId); const p = cat?.programs.find((x) => x.id === c.programId); const s = cat?.courses.find((x) => x.id === c.courseId); return { inst: i?.name ?? '', prog: p?.code ?? '', course: s?.title ?? '', code: s?.code ?? '' }; };

  return (
    <AuthFrame wide>
      {typeof step === 'number' && <Progress step={step} />}
      {step === 1 && <>
        <AuthHeading icon="userPlus" title="Create your teacher account" lead="Your sign-in details" />
        <form noValidate onSubmit={(e) => { e.preventDefault(); next(); }}>
          <AuthField label="Full name" icon="user" value={name} onChange={setName} onBlur={touch('name')} required autoFocus autoComplete="name" placeholder="As on your university ID" error={show(e1, 'name')} />
          <AuthField label="Email" icon="mail" type="email" value={email} onChange={setEmail} onBlur={touch('email')} required autoComplete="email" inputMode="email" placeholder="Your email address" error={show(e1, 'email')} hint="We send a 6-digit code here to confirm it." />
          <AuthField label="Password" icon="lock" type="password" value={pw} onChange={setPw} onBlur={touch('pw')} required autoComplete="new-password" placeholder="Create a password" error={tried.pw && pw ? '' : show(e1, 'pw')} />
          <div className="meter" aria-hidden>{[1, 2, 3, 4].map((n) => <i key={n} className={strength.score >= n ? (strength.score <= 2 ? 'weak' : 'on') : ''} />)}</div>
          <span className="small" style={{ color: strength.ok ? 'var(--green)' : 'var(--ink-3)', minHeight: 20 }}>{pw ? (strength.ok ? 'Strong password' : strength.problems[0]) : 'At least 10 characters, three of four character types.'}</span>
          <AuthField label="Confirm password" icon="lock" type="password" value={pw2} onChange={setPw2} onBlur={touch('pw2')} required autoComplete="new-password" placeholder="Re-enter your password" error={show(e1, 'pw2')} />
          {err && <div className="notice bad" role="alert">{err}</div>}
          <Actions><span /><button className="auth-btn" type="submit">Continue<Icon name="arrow" size={18} /></button></Actions>
        </form>
        <p className="auth-alt"><span>Already registered?</span><Link href={staffSignInHref(portal)} className="auth-link">Sign in</Link></p>
      </>}
      {step === 2 && <>
        <AuthHeading icon="programs" title="Classes and subjects you teach" lead="Choose from the university’s records" />
        {catErr ? <div className="notice bad" role="alert">{catErr} <button className="btn-link" onClick={() => { setCatErr(''); get<Catalog>('/teacher-registration/catalog').then(setCat).catch((e) => setCatErr(errMsg(e))); }}>Try again</button></div> : !cat ? <div className="skeleton" style={{ height: 180 }} aria-busy="true" aria-label="Loading classes and subjects" /> :
          <Picker cat={cat} combos={combos} onAdd={(l) => setCombos((c) => [...c, ...l.filter((x) => !c.some((y) => key(y) === key(x)))])} />}
        <section aria-label="Selected classes and subjects" data-testid="selected-combos">
          <h2 className="sel-h">Your selection <span className="count">{combos.length}</span></h2>
          {combos.length ? <ul className="sel-list">{combos.map((c) => { const l = labelOf(c); return (
            <li key={key(c)}><div><b>{l.course}</b> <span className="small faint">{l.code}</span><div className="small">{l.inst} · {l.prog} · Semester {c.semester} · {c.term}</div></div>
              <button type="button" className="btn btn-sm" onClick={() => setCombos(combos.filter((x) => key(x) !== key(c)))} aria-label={`Remove ${l.course}, ${l.inst}, ${c.term}`}>Remove</button></li>); })}</ul>
            : <p className="muted small">Nothing selected yet.</p>}
          <p className="small faint">Selecting a class and subject only sends a request. You get access to each one only after an administrator approves it.</p>
        </section>
        {err && <div className="notice bad" role="alert">{err}</div>}
        <Actions><button type="button" className="btn" onClick={() => { setErr(''); setStep(1); }}>Back</button><button className="auth-btn" type="button" onClick={next}>Continue<Icon name="arrow" size={18} /></button></Actions>
      </>}
      {step === 3 && <>
        <AuthHeading icon="id" title="Complete your teacher profile" lead="Then review and submit" />
        <form noValidate onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <div className="grid g2">
            <AuthField label="Faculty / employee ID" icon="id" mono value={empId} onChange={setEmpId} onBlur={touch('empId')} required autoFocus autoComplete="off" error={show(e3, 'empId')} />
            <AuthField label="Phone number" icon="mail" type="text" value={phone} onChange={setPhone} onBlur={touch('phone')} required autoComplete="tel" inputMode="tel" placeholder="+92 300 1234567" error={show(e3, 'phone')} />
            <AuthField label="Department" icon="institutions" value={dept} onChange={setDept} onBlur={touch('dept')} required autoComplete="organization" error={show(e3, 'dept')} />
            <AuthField label="Designation" icon="user" value={desig} onChange={setDesig} onBlur={touch('desig')} required autoComplete="organization-title" placeholder="e.g. Assistant Professor" error={show(e3, 'desig')} />
          </div>
          <PhotoField photo={photo} onChange={setPhoto} onError={setErr} />
          <section className="review" aria-label="Review your registration" data-testid="review">
            <h2 className="sel-h">Review</h2>
            <dl className="facts"><div><dt>Name</dt><dd>{name}</dd></div><div><dt>Email</dt><dd>{email}</dd></div><div><dt>Classes and subjects requested</dt><dd>{combos.length}</dd></div></dl>
            <ul className="sel-list compact">{combos.map((c) => { const l = labelOf(c); return <li key={key(c)}><span><b>{l.course}</b> · {l.inst} · {l.prog} · Sem {c.semester} · {c.term}</span></li>; })}</ul>
            <p className="small faint">An administrator reviews your identity and each requested class and subject. Only approved ones give access.</p>
          </section>
          {err && <div className="notice bad" role="alert">{err}</div>}
          <Actions><button type="button" className="btn" onClick={() => { setErr(''); setStep(2); }}>Back</button><button className="auth-btn" type="submit" disabled={busy}>{busy ? 'Submitting…' : 'Submit Registration'}<Icon name="arrow" size={18} /></button></Actions>
        </form>
      </>}
      {step === 'code' && <>
        <AuthHeading icon="mail" title="Confirm your email" lead={<span data-testid="register-info">{info}</span>} />
        <form onSubmit={(e) => { e.preventDefault(); void verify(); }}>
          <span className="f" id="otp-label" style={{ fontWeight: 600, fontSize: 13.5 }}>Verification code</span>
          <div className="otp" role="group" aria-labelledby="otp-label" onPaste={onPaste}>{digits.map((d, i) => <input key={i} ref={(el) => { refs.current[i] = el; }} inputMode="numeric" autoComplete="one-time-code" aria-label={`Digit ${i + 1}`} value={d} onChange={(e) => onDigit(i, e.target.value)} onKeyDown={(e) => { if (e.key === 'Backspace' && !digits[i] && i > 0) refs.current[i - 1]?.focus(); }} />)}</div>
          {devCode && <div className="notice warn small" data-testid="dev-code">Development mode — code: <b className="mono">{devCode}</b></div>}
          {err && <div className="notice bad" role="alert">{err}</div>}
          <Actions><button type="button" className="btn" onClick={() => { setErr(''); setStep(3); }}>Back</button><button className="auth-btn" type="submit" disabled={busy || code.length !== 6}>Confirm and submit<Icon name="arrow" size={18} /></button></Actions>
        </form>
      </>}
      {step === 'done' && <>
        <AuthHeading icon="user" title="Registration submitted" />
        <div className="notice ok" role="status" data-testid="register-done">Your email is confirmed and your registration is with the university for approval. <b>You cannot use the teacher workspace until an administrator approves it.</b></div>
        <p className="muted" style={{ margin: 0 }}>Sign in with <b>{email.trim()}</b> on the staff portal to see the status of your registration and of each class and subject.</p>
        <a className="auth-btn" href={staffSignInHref(portal)} style={{ textDecoration: 'none' }}>Go to staff sign in<Icon name="arrow" size={18} /></a>
      </>}
    </AuthFrame>
  );
}

function Progress({ step }: { step: 1 | 2 | 3 }) {
  const items = ['Account', 'Classes & subjects', 'Profile'];
  return (
    <nav className="steps" aria-label="Registration progress">
      <ol>{items.map((t, i) => <li key={t} aria-current={i + 1 === step ? 'step' : undefined} className={i + 1 < step ? 'done' : i + 1 === step ? 'on' : ''}><span className="n" aria-hidden>{i + 1 < step ? '✓' : i + 1}</span><span className="t">{t}</span><span className="sr-only">{i + 1 < step ? ' (completed)' : i + 1 === step ? ' (current step)' : ''}</span></li>)}</ol>
      <p className="steps-now" aria-live="polite">Step {step} of 3</p>
    </nav>
  );
}
const Actions = ({ children }: { children: React.ReactNode }) => <div className="reg-actions">{children}</div>;

function Sel({ label, value, onChange, children, disabled }: { label: string; value: string; onChange: (v: string) => void; children: React.ReactNode; disabled?: boolean }) {
  const id = useMemo(() => 's' + Math.random().toString(36).slice(2, 8), []);
  return <div className="af"><label htmlFor={id}>{label}</label><div className="af-wrap"><select id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>{children}</select></div></div>;
}

/** Institution → programme → semester → session → subjects, every option taken from the catalog served by the API. */
function Picker({ cat, combos, onAdd }: { cat: Catalog; combos: Combo[]; onAdd: (c: Combo[]) => void }) {
  const [inst, setInst] = useState(''); const [prog, setProg] = useState(''); const [sem, setSem] = useState(''); const [term, setTerm] = useState(''); const [picked, setPicked] = useState<string[]>([]);
  const semesters = useMemo(() => [...new Set(cat.courses.filter((c) => c.programId === prog).map((c) => c.semester))].sort((a, b) => a - b), [cat, prog]);
  const sessions = useMemo(() => { const own = cat.termsByClass.filter((t) => t.institutionId === inst && t.programId === prog && String(t.semester) === sem).map((t) => t.term); return own.length ? [...new Set(own)].sort().reverse() : cat.terms; }, [cat, inst, prog, sem]);
  const subjects = useMemo(() => cat.courses.filter((c) => c.programId === prog && String(c.semester) === sem), [cat, prog, sem]);
  const programs = useMemo(() => { if (!inst || !cat.offerings) return cat.programs; const ids = new Set(cat.offerings.filter((o) => o.institutionId === inst).map((o) => o.programId)); return cat.programs.filter((p) => ids.has(p.id)); }, [cat, inst]);   // only programmes the institution offers
  const have = (courseId: string) => combos.some((c) => c.institutionId === inst && c.courseId === courseId && c.term === term);
  const ready = inst && prog && sem && term;
  return (
    <section className="picker" aria-label="Add classes and subjects">
      <div className="grid g2">
        <Sel label="Institution" value={inst} onChange={(v) => { setInst(v); setTerm(''); setPicked([]); if (prog && cat.offerings && !cat.offerings.some((o) => o.institutionId === v && o.programId === prog)) { setProg(''); setSem(''); } }}>   {/* the programme stays selected only if the new institution also offers it */}<option value="">Select institution</option>{cat.institutions.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</Sel>
        <Sel label="Programme" value={prog} disabled={!inst} onChange={(v) => { setProg(v); setSem(''); setTerm(''); setPicked([]); }}><option value="">{inst ? 'Select programme' : 'Select an institution first'}</option>{programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Sel>
        <Sel label="Semester" value={sem} disabled={!prog} onChange={(v) => { setSem(v); setTerm(''); setPicked([]); }}><option value="">Select semester</option>{semesters.map((s) => <option key={s} value={s}>Semester {s}</option>)}</Sel>
        <Sel label="Academic session" value={term} disabled={!sem || !inst} onChange={(v) => { setTerm(v); setPicked([]); }}><option value="">Select session</option>{sessions.map((t) => <option key={t} value={t}>{t}</option>)}</Sel>
      </div>
      {ready ? (
        <fieldset className="subjects"><legend>Subjects you teach in this class</legend>
          {subjects.length ? subjects.map((s) => (
            <label key={s.id} className={have(s.id) ? 'added' : ''}><input type="checkbox" checked={have(s.id) || picked.includes(s.id)} disabled={have(s.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, s.id] : picked.filter((x) => x !== s.id))} /><span><b>{s.title}</b> <span className="small faint">{s.code}</span></span>{have(s.id) && <span className="small faint">Added</span>}</label>)) : <p className="muted small">No subjects are recorded for this programme and semester.</p>}
          <button type="button" className="btn btn-sm" disabled={!picked.length} onClick={() => { onAdd(picked.map((courseId) => ({ institutionId: inst, programId: prog, semester: Number(sem), term, courseId }))); setPicked([]); }}>Add {picked.length ? `${picked.length} subject${picked.length === 1 ? '' : 's'}` : 'selected subjects'}</button>
        </fieldset>) : <p className="small faint" style={{ margin: 0 }}>Choose institution, programme, semester and session to see the subjects. You can add several classes.</p>}
    </section>
  );
}

function PhotoField({ photo, onChange, onError }: { photo: string; onChange: (v: string) => void; onError: (m: string) => void }) {
  return (
    <div className="photo-row">
      {photo ? <img src={photo} alt="Your photo preview" width={72} height={72} /> : <span className="photo-ph" aria-hidden><Icon name="user" size={28} /></span>}
      <div><span className="f" style={{ fontWeight: 600, fontSize: 13.5, display: 'block' }}>Profile photo <span className="small faint">(optional)</span></span>
        <div className="row"><label className="btn btn-sm">{photo ? 'Change photo' : 'Choose photo'}<input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; try { onError(''); onChange(await photoToDataUrl(f)); } catch (x) { onError((x as Error).message); } }} /></label>
          {photo && <button type="button" className="btn btn-sm" onClick={() => onChange('')}>Remove</button>}</div></div>
    </div>
  );
}
