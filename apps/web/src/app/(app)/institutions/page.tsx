'use client';
import { useEffect, useRef, useState } from 'react';
import { patch, post, put, del, fmtDate, useGet } from '@/api';
import { useMe } from '@/session';
import { Async, Badge, Card, Confirm, Field, ListEmpty, Modal, Notice, PageHead, Pager, CancelButton, Table, useAction } from '@/ui';
import { INSTITUTION_TYPES } from '@oes/shared';

const PAGE = 20;
const words = (v?: string | null) => (v ? v.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : '—');
const SHIFT: Record<string, string> = { MORNING: 'Morning', EVENING: 'Evening', UNSPECIFIED: 'Single / not split' };
const seats = (n: number | null) => (n == null ? 'Not published' : String(n));
const VERIFY_TONE: Record<string, string> = { VERIFIED: 'green', NEEDS_VERIFICATION: 'amber', LEGACY_UNVERIFIED: 'grey' };
const READY: Record<string, string> = { SUBJECTS_ENTERED: 'Subjects entered', DOCUMENT_LOCATED: 'Official document located; subjects not entered', NO_EVIDENCE: 'No curriculum evidence' };

export default function Institutions() {
  const { can } = useMe(); const { run, busy } = useAction();
  const [q, setQ] = useState(''); const [search, setSearch] = useState(''); const [page, setPage] = useState(1);
  const [flt, setFlt] = useState({ kind: '', sector: '', affiliation: '', type: '', region: '', operationalStatus: '', listingStatus: '', restricted: false, demo: 'exclude' });
  const lastSearch = useRef('');   // reset to page 1 only when the search text really changed (not on mount, which would undo an early page change)
  useEffect(() => { const t = setTimeout(() => { const v = q.trim(); if (v !== lastSearch.current) { lastSearch.current = v; setSearch(v); setPage(1); } }, 250); return () => clearTimeout(t); }, [q]);
  const facets = useGet<{ regions: string[]; types: string[]; canViewDemo: boolean }>('/directory/facets');
  const qs = new URLSearchParams({ page: String(page), pageSize: String(PAGE) }); if (search) qs.set('search', search);
  for (const [k, v] of Object.entries(flt)) if (v) qs.set(k, String(v));   // demo is always sent: the default hides synthetic records even on a site that shows them
  const st = useGet<{ total: number; items: any[] }>(`/directory/institutions?${qs}`);
  const [off, setOff] = useState<any>(null); const [imp, setImp] = useState(false);
  const [view, setView] = useState<string | null>(null); const [edit, setEdit] = useState<any>(null); const [add, setAdd] = useState(false);
  const [f, setF] = useState({ code: '', name: '', type: 'MEDICAL_COLLEGE', affiliation: 'CONSTITUENT', city: '' });
  const setFilter = (k: string, v: string | boolean) => { setFlt((p) => ({ ...p, [k]: v })); setPage(1); };
  const active = [search && `search “${search}”`, ...Object.entries(flt).filter(([k, v]) => v && !(k === 'demo' && v === 'exclude')).map(([k, v]) => `${k}: ${v === true ? 'yes' : String(v).toLowerCase()}`)].filter(Boolean) as string[];
  const clear = () => { setQ(''); setSearch(''); setPage(1); setFlt({ kind: '', sector: '', affiliation: '', type: '', region: '', operationalStatus: '', listingStatus: '', restricted: false, demo: 'exclude' }); };
  const sel = (label: string, k: keyof typeof flt, opts: [string, string][]) => (
    <label className="small" style={{ display: 'grid', gap: 2 }}>{label}<select className="in" value={String(flt[k])} onChange={(e) => setFilter(k, e.target.value)}><option value="">All</option>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>);
  return (
    <>
      <PageHead title="Institutions" sub="SZABMU constituent and affiliated institutions and the programmes each one is listed for. Seat figures are published reference data, not limits; student counts are actual enrolments.">
        {can('institution.manage') && <><button className="btn" onClick={() => setImp(true)}>Update directory</button><button className="btn btn-green" onClick={() => { setF({ code: '', name: '', type: 'MEDICAL_COLLEGE', affiliation: 'CONSTITUENT', city: '' }); setAdd(true); }}>+ Register institution</button></>}
      </PageHead>
      <Card>
        <form role="search" aria-label="Filter institutions" className="toolbar" onSubmit={(e) => e.preventDefault()}>
          <label className="small" style={{ display: 'grid', gap: 2, flex: '1 1 220px' }}>Search<input className="in" type="search" value={q} placeholder="Name, abbreviation, code or city" onChange={(e) => setQ(e.target.value)} /></label>
          {sel('Type of record', 'kind', [['INSTITUTION', 'Institutions'], ['ACADEMIC_UNIT', 'University academic units']])}
          {sel('Sector', 'sector', [['PUBLIC', 'Public'], ['PRIVATE', 'Private']])}
          {sel('Relationship', 'affiliation', [['CONSTITUENT', 'Constituent'], ['AFFILIATED', 'Affiliated']])}
          <details className="more-filters" style={{ flexBasis: '100%' }}><summary>More filters</summary><div className="toolbar" style={{ marginTop: 8 }}>
          {sel('Institution type', 'type', (facets.data?.types ?? INSTITUTION_TYPES).map((t) => [t, words(t)]))}
          {sel('Region', 'region', (facets.data?.regions ?? []).map((r) => [r, r]))}
          {sel('Operational status', 'operationalStatus', [['OPERATING', 'Operating'], ['UNKNOWN', 'Not confirmed'], ['CLOSED', 'Closed']])}
          {sel('Listing status', 'listingStatus', [['LISTED', 'Listed'], ['HIDDEN', 'Hidden'], ['DELISTED', 'Delisted']])}
          {facets.data?.canViewDemo && sel('Demo records', 'demo', [['exclude', 'Hide'], ['include', 'Include'], ['only', 'Only demo']])}
          <label className="row small" style={{ alignSelf: 'end', paddingBottom: 8 }}><input type="checkbox" checked={flt.restricted} onChange={(e) => setFilter('restricted', e.target.checked)} /> Has a stopped intake</label>
          </div></details>
        </form>
      </Card>
      <Card flush><Async state={st}>{(d) => (
        <>
          <p className="sr-only" role="status" aria-live="polite">{d.total} institution{d.total === 1 ? '' : 's'} found</p>
          <Table rowKey={(r: any) => r.id} rowLabel={(r: any) => r.name} rows={d.items} empty={<ListEmpty noun="institutions" filters={active} onClear={clear} />} cols={[
            { h: 'Institution', cls: 'inst-name', cell: (r: any) => <><button className="inst-link" onClick={() => setView(r.id)} aria-label={`Open details for ${r.name}`}>{r.name}</button><div className="small faint"><span className="code">{r.code}</span>{r.abbreviation ? ` · ${r.abbreviation}` : ''}{r.isDemo && <> · <Badge tone="grey">Demo</Badge></>}</div></> },
            { h: 'Type', more: true, cell: (r: any) => <>{r.kind === 'ACADEMIC_UNIT' ? 'University academic unit' : words(r.type)}<div className="small faint">{[words(r.sector), words(r.affiliation)].filter((x) => x !== '—').join(' · ') || '—'}</div></> },
            { h: 'Location', cell: (r: any) => <>{r.city ?? '—'}{r.region && <div className="small faint">{r.region}</div>}</> },
            { h: 'Programmes', num: true, cell: (r: any) => <>{r.offerings.verified}<span className="faint"> / {r.offerings.total}</span>{r.offerings.needsVerification > 0 && <div className="small faint">{r.offerings.needsVerification} to verify</div>}</> },
            { h: 'Students', num: true, cell: (r: any) => r.students },
            { h: 'Status', cell: (r: any) => <><Badge tone={r.active ? 'green' : 'red'}>{r.active ? 'Active' : 'Inactive'}</Badge>{r.listingStatus !== 'LISTED' && <> <Badge tone="amber">{words(r.listingStatus)}</Badge></>}{r.offerings.stopped > 0 && <div style={{ marginTop: 4 }}><Badge tone="amber">{r.offerings.stopped} stopped intake{r.offerings.stopped > 1 ? 's' : ''}</Badge></div>}{r.operationalStatus !== 'OPERATING' && <div className="small faint">{r.operationalStatus === 'CLOSED' ? 'Closed' : 'Operation not confirmed'}</div>}</> },
            { h: '', cell: (r: any) => <span className="row-actions">{r.canEdit && <button className="btn btn-sm" onClick={() => setEdit(r)} aria-label={`Edit ${r.name}`}>Edit</button>}{r.canEdit && <button className="btn btn-sm" aria-label={`${r.active ? 'Deactivate' : 'Activate'} ${r.name}`} onClick={() => (r.active ? setOff(r) : run(async () => { await patch(`/institutions/${r.id}`, { active: true }); st.reload?.(); }, 'Institution activated'))}>{r.active ? 'Deactivate' : 'Activate'}</button>}</span> },
          ]} />
          <Pager page={page} total={d.total} size={PAGE} onPage={setPage} />
        </>)}</Async></Card>
      {imp && <ImportDirectory onClose={() => setImp(false)} onApplied={() => st.reload?.()} />}
      {off && <Confirm danger title={`Deactivate ${off.name}?`} yes="Deactivate institution" onNo={() => setOff(null)} onYes={() => run(async () => { await patch(`/institutions/${off.id}`, { active: false }); setOff(null); st.reload?.(); }, 'Institution deactivated')}
        body={<>Staff and candidates of <b>{off.code}</b> will no longer be able to use it for new exams. No student data is deleted, and you can activate it again at any time.</>} />}
      {view && <Detail id={view} onClose={() => setView(null)} canManage={can('institution.manage')} onChanged={() => st.reload?.()} />}
      {edit && <EditInstitution inst={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); st.reload?.(); }} />}
      {add && <Modal title="Register institution" onClose={() => setAdd(false)} missing={[!f.code && 'Code', !f.name && 'Name'].filter(Boolean) as string[]} footer={<><CancelButton /><button className="btn btn-green" disabled={busy || !f.code || !f.name} onClick={() => run(async () => { await post('/institutions', { ...f, city: f.city || undefined }); setAdd(false); st.reload?.(); }, 'Institution registered')}>Register</button></>}>
        <div className="stack"><Notice tone="warn">Registering by hand does not add it to the official directory. It has no programmes until an administrator adds them from the directory import.</Notice>
          <div className="grid g2"><Field label="Code" hint="Capitals, digits, hyphen" required><input className="in mono" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /></Field><Field label="City"><input className="in" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></Field></div>
          <Field label="Name" required><input className="in" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <div className="grid g2"><Field label="Type"><select className="in" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{INSTITUTION_TYPES.map((t) => <option key={t} value={t}>{words(t)}</option>)}</select></Field><Field label="Affiliation"><select className="in" value={f.affiliation} onChange={(e) => setF({ ...f, affiliation: e.target.value })}><option value="CONSTITUENT">Constituent</option><option value="AFFILIATED">Affiliated</option></select></Field></div></div></Modal>}
    </>
  );
}

function EditInstitution({ inst, onClose, onSaved }: { inst: any; onClose: () => void; onSaved: () => void }) {
  const { run, busy } = useAction();
  const [f, setF] = useState({ abbreviation: inst.abbreviation ?? '', sector: inst.sector ?? '', region: inst.region ?? '', city: inst.city ?? '', operationalStatus: inst.operationalStatus, listingStatus: inst.listingStatus });
  const body = () => ({ abbreviation: f.abbreviation || undefined, sector: f.sector || undefined, region: f.region || undefined, city: f.city || undefined, operationalStatus: f.operationalStatus, listingStatus: f.listingStatus });
  return (
    <Modal title={`Edit ${inst.name}`} onClose={onClose} footer={<><CancelButton /><button className="btn btn-green" disabled={busy} onClick={() => run(async () => { await patch(`/institutions/${inst.id}`, body()); onSaved(); }, 'Institution updated')}>Save changes</button></>}>
      <div className="stack">
        <Notice tone="warn">Fields you change here are locked: a later directory import reports a difference instead of overwriting them. Each change is recorded in the audit trail. The name and code are set by the directory and cannot be edited here.</Notice>
        <div className="grid g2">
          <Field label="Abbreviation"><input className="in" value={f.abbreviation} maxLength={20} onChange={(e) => setF({ ...f, abbreviation: e.target.value })} /></Field>
          <Field label="City"><input className="in" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></Field>
          <Field label="Region"><input className="in" value={f.region} onChange={(e) => setF({ ...f, region: e.target.value })} /></Field>
          <Field label="Sector"><select className="in" value={f.sector} onChange={(e) => setF({ ...f, sector: e.target.value })}><option value="">Not recorded</option><option value="PUBLIC">Public</option><option value="PRIVATE">Private</option></select></Field>
          <Field label="Operational status" hint="Whether it is currently running; independent of its listing"><select className="in" value={f.operationalStatus} onChange={(e) => setF({ ...f, operationalStatus: e.target.value })}><option value="UNKNOWN">Not confirmed</option><option value="OPERATING">Operating</option><option value="CLOSED">Closed</option></select></Field>
          <Field label="Listing status" hint="Hidden or delisted institutions cannot be chosen by new students"><select className="in" value={f.listingStatus} onChange={(e) => setF({ ...f, listingStatus: e.target.value })}><option value="LISTED">Listed</option><option value="HIDDEN">Hidden</option><option value="DELISTED">Delisted</option></select></Field>
        </div>
      </div>
    </Modal>);
}

function Detail({ id, onClose, canManage, onChanged }: { id: string; onClose: () => void; canManage: boolean; onChanged: () => void }) {
  const st = useGet<any>(`/directory/institutions/${id}`); const { run } = useAction();
  const [toggle, setToggle] = useState<any>(null); const [sess, setSess] = useState<any>(null);
  const reload = () => { st.reload?.(); onChanged(); };
  return (
    <Modal title="Institution details" onClose={onClose} footer={<CancelButton>Close</CancelButton>}>
      <Async state={st}>{(d) => (
        <div className="stack" data-testid="institution-detail">
          <div><h3 style={{ margin: 0 }}>{d.name}</h3><div className="small faint"><span className="code">{d.code}</span> · {d.kind === 'ACADEMIC_UNIT' ? 'University academic unit' : words(d.type)} · {words(d.sector)} · {words(d.affiliation)}</div>
            <div className="small">{[d.city, d.region].filter(Boolean).join(', ') || 'Location not recorded'}{d.campusLabel ? ` · ${d.campusLabel}` : ''}</div></div>
          <div className="row wrap"><Badge tone={d.operationalStatus === 'OPERATING' ? 'green' : 'grey'}>{d.operationalStatus === 'UNKNOWN' ? 'Operation not confirmed' : words(d.operationalStatus)}</Badge><Badge tone={d.listingStatus === 'LISTED' ? 'green' : 'amber'}>{words(d.listingStatus)}</Badge><span className="small faint">Last verified against official sources: {d.lastVerifiedAt ? fmtDate(d.lastVerifiedAt) : 'not recorded'}</span></div>
          <p className="small" style={{ margin: 0 }}>Enrolled students: <b>{d.students.total}</b>{d.students.pendingVerification > 0 && <> ({d.students.pendingVerification} awaiting verification)</>}. Published seat figures below are annual reference data, not a limit on enrolment.</p>
          <section aria-label="Programmes offered">
            <h4 style={{ margin: '0 0 6px' }}>Programmes ({d.offerings.length})</h4>
            {!d.offerings.length ? <p className="muted small">No programme table is published for this record, so none is listed.</p> : d.offerings.map((o: any) => (
              <div key={o.id} className="card" style={{ padding: 12, marginBottom: 8 }}>
                <div className="row between wrap"><b>{o.program.name}</b><span className="row"><Badge tone={VERIFY_TONE[o.verificationStatus] ?? 'grey'}>{o.verificationStatus === 'LEGACY_UNVERIFIED' ? 'Pre-existing, unverified' : words(o.verificationStatus)}</Badge>{o.intakeStatus === 'STOPPED' ? <Badge tone="amber">New intake stopped</Badge> : <Badge tone="green">Intake not restricted</Badge>}</span></div>
                <div className="small faint">{o.program.directoryKey ?? o.program.code}{o.program.durationMonths ? ` · ${o.program.durationMonths / 12 >= 1 && o.program.durationMonths % 12 === 0 ? `${o.program.durationMonths / 12} years` : `${o.program.durationMonths} months`}` : ''} · awarded by {o.awardingBody.name}</div>
                <ul className="small" style={{ margin: '6px 0', paddingLeft: 18 }}>
                  {o.allocations.map((a: any) => <li key={a.shift}>{SHIFT[a.shift] ?? a.shift}: annual seats {seats(a.annualSeats)}{o.enrolledByShift?.[a.shift] != null ? ` · enrolled ${o.enrolledByShift[a.shift]}` : ''}</li>)}
                  <li>Enrolled in total: {o.enrolled}</li><li>Curriculum: {READY[o.curriculum.readiness]}{o.curriculum.documents.length > 0 && <> — {o.curriculum.documents.map((c: any, i: number) => <span key={c.id ?? i}>{i ? ', ' : ''}<a href={c.url} target="_blank" rel="noreferrer">{c.title ?? 'document'}</a></span>)}</>}</li>
                </ul>
                {o.restrictions.map((r: any) => <Notice key={r.id} tone="warn">{r.text} <span className="small">Source: <a href={r.source.url} target="_blank" rel="noreferrer">{r.source.title}</a>; effective date {r.effectiveFrom ? fmtDate(r.effectiveFrom) : 'not published'}; {words(r.status)}.</span></Notice>)}
                {o.sessions.length > 0 && <ul className="small" style={{ margin: '6px 0', paddingLeft: 18 }}>{o.sessions.map((s: any) => <li key={s.batchYear}>Admissions {s.batchYear}{s.label ? ` (${s.label})` : ''}: {words(s.admissionsStatus)}{s.seatLimit != null ? `, limit ${s.seatLimit}` : ''}{canManage && <> <button className="btn-link" onClick={() => setSess({ offering: o, ...s })}>Edit</button></>}</li>)}</ul>}
                {canManage && <div className="row wrap" style={{ marginTop: 6 }}>
                  <button className="btn btn-sm" onClick={() => setToggle(o)}>{o.intakeStatus === 'STOPPED' ? 'Resume new intake' : 'Stop new intake'}</button>
                  <button className="btn btn-sm" onClick={() => setSess({ offering: o, batchYear: new Date().getFullYear(), admissionsStatus: 'OPEN', seatLimit: null, label: '', note: '' })}>Set admissions session</button></div>}
              </div>))}
          </section>
          {d.claims.length > 0 && <section aria-label="Sources and open items"><h4 style={{ margin: '0 0 6px' }}>Sources and open items</h4><ul className="small" style={{ paddingLeft: 18, margin: 0 }}>{d.claims.map((c: any) => <li key={c.id}>{c.text} <span className="faint">[{words(c.status)}; <a href={c.source.url} target="_blank" rel="noreferrer">{c.source.title}</a>]</span></li>)}</ul></section>}
        </div>)}</Async>
      {toggle && <Confirm title={toggle.intakeStatus === 'STOPPED' ? 'Resume new intake?' : 'Stop new intake?'} yes={toggle.intakeStatus === 'STOPPED' ? 'Resume intake' : 'Stop intake'} danger={toggle.intakeStatus !== 'STOPPED'} onNo={() => setToggle(null)}
        body={<>This changes whether <b>new</b> students may join <b>{toggle.program.name}</b> here. Existing students, their classes and their examinations are not affected. The change is audited and protected from being overwritten by a later import.</>}
        onYes={() => run(async () => { await patch(`/directory/offerings/${toggle.id}`, { intakeStatus: toggle.intakeStatus === 'STOPPED' ? 'UNRESTRICTED' : 'STOPPED' }); setToggle(null); reload(); }, 'Intake updated')} />}
      {sess && <SessionForm s={sess} onClose={() => setSess(null)} onSaved={() => { setSess(null); reload(); }} />}
    </Modal>);
}

function SessionForm({ s, onClose, onSaved }: { s: any; onClose: () => void; onSaved: () => void }) {
  const { run, busy } = useAction(); const [batchYear, setBy] = useState(String(s.batchYear)); const [status, setStatus] = useState(s.admissionsStatus); const [limit, setLimit] = useState(s.seatLimit ?? ''); const [label, setLabel] = useState(s.label ?? '');
  const exists = !!s.offering.sessions.find((x: any) => x.batchYear === s.batchYear);
  return (
    <Modal title={`Admissions session — ${s.offering.program.name}`} onClose={onClose} footer={<><CancelButton />{exists && <button className="btn" disabled={busy} onClick={() => run(async () => { await del(`/directory/offerings/${s.offering.id}/sessions/${s.batchYear}`); onSaved(); }, 'Session removed')}>Remove session</button>}
      <button className="btn btn-green" disabled={busy || !/^\d{4}$/.test(batchYear)} onClick={() => run(async () => { await put(`/directory/offerings/${s.offering.id}/sessions/${batchYear}`, { admissionsStatus: status, seatLimit: limit === '' ? undefined : Number(limit), label: label || undefined }); onSaved(); }, 'Session saved')}>Save session</button></>}>
      <div className="stack"><Notice>A session is recorded only when an administrator sets it. Nothing is assumed from the published annual seats.</Notice>
        <div className="grid g2"><Field label="Admission year" required><input className="in" inputMode="numeric" value={batchYear} onChange={(e) => setBy(e.target.value)} /></Field>
          <Field label="Admissions"><select className="in" value={status} onChange={(e) => setStatus(e.target.value)}><option value="OPEN">Open</option><option value="CLOSED">Closed</option></select></Field>
          <Field label="Seat limit (optional)" hint="Blank means no limit is enforced"><input className="in" inputMode="numeric" value={limit} onChange={(e) => setLimit(e.target.value.replace(/\D/g, ''))} /></Field>
          <Field label="Label (optional)"><input className="in" value={label} onChange={(e) => setLabel(e.target.value)} /></Field></div></div>
    </Modal>);
}

interface ImportReport { version: string; mode: string; datasetSha256: string; runId?: string; counts: Record<string, { create: number; reuse: number; update: number; preserved: number; skipped: number }>; ambiguous: string[]; reviewExisting: string[]; discrepancies: string[]; unresolved: string[]; lineCount: number }
const ENTITY: Record<string, string> = { institution: 'Institutions', program: 'Programmes', offering: 'Programme offerings', allocation: 'Seat allocations', curriculum: 'Curriculum documents', source: 'Sources', claim: 'Source claims', alias: 'Programme aliases' };

/** Super administrators load or refresh the official directory from the browser: check first (writes nothing), then apply exactly what was checked. */
function ImportDirectory({ onClose, onApplied }: { onClose: () => void; onApplied: () => void }) {
  const { run, busy } = useAction(); const [rep, setRep] = useState<ImportReport | null>(null); const [done, setDone] = useState<ImportReport | null>(null); const [sure, setSure] = useState(false);
  const total = (k: 'create' | 'reuse' | 'update' | 'preserved') => Object.values(rep?.counts ?? {}).reduce((a, c) => a + c[k], 0);
  const list = (title: string, xs: string[]) => xs.length > 0 && <details><summary>{title} ({xs.length})</summary><ul className="small" style={{ margin: '6px 0', paddingLeft: 18 }}>{xs.map((x, i) => <li key={i}>{x}</li>)}</ul></details>;
  return (
    <Modal title="Update directory" onClose={onClose} footer={<><CancelButton>{done ? 'Close' : 'Cancel'}</CancelButton>
      {!done && <button className="btn" disabled={busy} onClick={() => run(async () => { setSure(false); setRep(await post<ImportReport>('/directory/import', { apply: false })); })}>{rep ? 'Check again' : 'Check (changes nothing)'}</button>}
      {!done && rep && <button className="btn btn-green" disabled={busy || !sure} onClick={() => run(async () => { const r = await post<ImportReport>('/directory/import', { apply: true, datasetSha256: rep.datasetSha256 }); setDone(r); onApplied(); }, 'Directory updated')}>Apply to the live database</button>}</>}>
      <div className="stack" data-testid="import-directory">
        <p className="small" style={{ margin: 0 }}>Loads the official SZABMU institutions and programmes (dataset <b>{rep?.version ?? 'checked first'}</b>). Existing records you edited are kept, nothing is deleted, and the run is recorded so it can be undone. <b>Check</b> shows what would happen and changes nothing.</p>
        {!rep && !done && <Notice>Start with “Check”. You can apply only after a check.</Notice>}
        {rep && !done && <>
          <Table rowKey={(r: any) => r.k} rows={Object.entries(rep.counts).map(([k, c]) => ({ k, ...c }))} cols={[
            { h: 'Record', cell: (r: any) => ENTITY[r.k] ?? r.k }, { h: 'Create', num: true, cell: (r: any) => r.create }, { h: 'Reuse', num: true, cell: (r: any) => r.reuse }, { h: 'Update', num: true, cell: (r: any) => r.update }, { h: 'Kept as edited', num: true, cell: (r: any) => r.preserved }]} />
          <p className="small" style={{ margin: 0 }}>Totals: {total('create')} to create, {total('update')} to update, {total('reuse')} already present.</p>
          {list('Ambiguous matches (nothing is merged automatically)', rep.ambiguous)}{list('Existing relationships to review', rep.reviewExisting)}{list('Differences from the official pages or your edits', rep.discrepancies)}{list('Items still unresolved (recorded, not applied)', rep.unresolved)}
          <Notice tone="warn">Applying writes to this site’s live database. Make sure a database backup exists first.</Notice>
          <label className="row small"><input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} /> I have a backup and want to apply this checked update</label></>}
        {done && <Notice tone="ok">Directory updated. Run <span className="code">{done.runId}</span> ({total('create') ? `${Object.values(done.counts).reduce((a, c) => a + c.create, 0)} records created` : 'nothing new to create'}). Keep this run number: it is how this update is undone.</Notice>}
      </div>
    </Modal>);
}
