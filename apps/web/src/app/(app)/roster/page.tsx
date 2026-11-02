'use client';
import { useState } from 'react';
import { post, useGet } from '@/api';
import { useMe } from '@/session';
import { useUrlState } from '@/url-state';
import { Async, Badge, Card, Field, Modal, Notice, PageHead, Pager, Table, useAction, CancelButton, ListEmpty } from '@/ui';

const HEADER = 'regNo,fullName,dateOfBirth,programCode,semester,batchYear';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
interface Row { regNo: string; fullName: string; dateOfBirth: string; programCode: string; semester: number; batchYear: number }

/** Splits one CSV line, honouring "quoted, fields" and "" escapes (Excel quotes names that contain commas). */
function splitCsvLine(line: string): string[] {
  const out: string[] = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true; else if (ch === ',') { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  out.push(cur.trim()); return out;
}

const MAX_ROWS = 2000;   // server limit per import

/** A real calendar date in the past, not before 1940 (mirrors the API: 2004-02-30 is rejected, not rolled over to March). */
function validDob(v: string, today = new Date().toISOString().slice(0, 10)): boolean {
  if (!DATE_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v && v >= '1940-01-01' && v < today;
}
const isInt = (s: string) => /^\d+$/.test(s);

/** Parses pasted or uploaded CSV; returns valid rows plus a human message for each bad line (1-based line numbers). */
function parseCsv(text: string): { rows: Row[]; problems: string[] } {
  const rows: Row[] = []; const problems: string[] = []; const seen = new Map<string, number>();
  (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).split(/\r?\n/).map((l) => l.trim()).forEach((line, i) => {
    if (!line || line.toLowerCase().replace(/[^a-z]/g, '').startsWith('regno')) return;
    if (/^,*$/.test(line)) return;                                         // blank spreadsheet row
    const c = splitCsvLine(line);
    if (c.length < 6) { problems.push(`Line ${i + 1}: expected 6 columns, found ${c.length}.`); return; }
    if (c.length > 6 && c.slice(6).some(Boolean)) { problems.push(`Line ${i + 1}: expected 6 columns, found ${c.length}. Put names that contain commas in "quotes".`); return; }
    const [regNo, fullName, dateOfBirth, programCode, sem, batch] = c as [string, string, string, string, string, string];
    const key = regNo.toLowerCase();
    if (regNo.length < 3 || regNo.length > 40) problems.push(`Line ${i + 1}: registration number must be 3–40 characters.`);
    else if (seen.has(key)) problems.push(`Line ${i + 1}: ${regNo} is already on line ${seen.get(key)} of this file.`);
    else if (fullName.length < 2 || fullName.length > 200) problems.push(`Line ${i + 1}: name is missing or too long.`);
    else if (!validDob(dateOfBirth)) problems.push(`Line ${i + 1}: date of birth must be a real past date like 2004-03-09.`);
    else if (!programCode) problems.push(`Line ${i + 1}: programme code is missing.`);
    else if (!isInt(sem) || +sem < 1 || +sem > 12) problems.push(`Line ${i + 1}: semester must be a whole number 1–12.`);
    else if (!isInt(batch) || +batch < 1990 || +batch > 2100) problems.push(`Line ${i + 1}: batch year looks wrong (use e.g. 2025).`);
    else { seen.set(key, i + 1); rows.push({ regNo, fullName, dateOfBirth, programCode: programCode.toUpperCase(), semester: +sem, batchYear: +batch }); }
  });
  if (rows.length > MAX_ROWS) problems.unshift(`This file has ${rows.length} students; at most ${MAX_ROWS} can be imported at once. Split it into smaller files.`);
  return { rows, problems };
}

const SAMPLE = `${HEADER}\nDMC-A-2025-0101,Amna Khan,2004-03-09,MBBS,2,2025\nDMC-A-2025-0102,"Raza, Ali",2003-11-21,MBBS,2,2025\n`;
const EMPTY_ONE = { regNo: '', fullName: '', dateOfBirth: '', programCode: '', semester: '1', batchYear: String(new Date().getFullYear()) };
type OneKey = keyof typeof EMPTY_ONE;

export default function Roster() {
  const { me } = useMe(); const { run, busy } = useAction();
  const url = useUrlState({ page: '1', search: '', status: '', inst: '' }); const page = Number(url.vals.page) || 1; const search = url.vals.search; const status = url.vals.status; const inst = url.vals.inst; const setPage = (n: number) => url.set('page', String(n)); const setSearch = (v: string) => url.set('search', v); const setStatus = (v: string) => url.set('status', v); const setInst = (v: string) => url.set('inst', v);
  const insts = useGet<any[]>('/institutions'); const programs = useGet<any[]>('/programs');
  const st = useGet<any>(`/roster?page=${page}&pageSize=25${search ? `&search=${encodeURIComponent(search)}` : ''}${status ? `&status=${status}` : ''}${inst ? `&institutionId=${inst}` : ''}`);
  const [imp, setImp] = useState(false); const [csv, setCsv] = useState(''); const [fileName, setFileName] = useState(''); const [fileErr, setFileErr] = useState(''); const [target, setTarget] = useState(''); const [done, setDone] = useState('');
  const [addOpen, setAddOpen] = useState(false); const [one, setOne] = useState(EMPTY_ONE); const [oneTouched, setOneTouched] = useState(false);
  const mine = me?.institutions ?? []; const choices = mine.length ? mine : (insts.data ?? []);
  const instId = target || choices[0]?.id || '';
  const parsed = parseCsv(csv); const blocked = !instId || !parsed.rows.length || parsed.problems.length > 0;

  const today = new Date().toISOString().slice(0, 10);
  const oneErr: Record<OneKey, string> = {
    regNo: one.regNo.trim().length < 3 ? 'Enter the registration number (at least 3 characters).' : one.regNo.trim().length > 40 ? 'Registration number is too long (40 characters at most).' : '',
    fullName: one.fullName.trim().length < 2 ? 'Enter the student’s full name.' : one.fullName.trim().length > 200 ? 'Name is too long.' : '',
    dateOfBirth: !one.dateOfBirth ? 'Choose the date of birth.' : !validDob(one.dateOfBirth, today) ? 'Enter a real date of birth (after 1940, before today).' : '',
    programCode: !one.programCode ? 'Choose a programme.' : '',
    semester: !isInt(one.semester) || +one.semester < 1 || +one.semester > 12 ? 'Semester must be a whole number 1–12.' : '',
    batchYear: !isInt(one.batchYear) || +one.batchYear < 1990 || +one.batchYear > 2100 ? 'Enter the intake year, e.g. 2025.' : '',
  };
  const oneInvalid = !instId || Object.values(oneErr).some(Boolean);
  const showOne = (k: OneKey) => (oneTouched ? oneErr[k] : '');
  const set1 = (k: OneKey) => (e: { target: { value: string } }) => setOne((o) => ({ ...o, [k]: e.target.value }));

  /** Imports rows; resolves true only when the server accepted them (useAction shows any error as a toast). */
  const importRows = async (rows: Row[], msg: (n: number) => string) =>
    (await run(async () => { const r = await post('/roster/import', { institutionId: instId, rows }); setDone(msg(r.imported)); st.reload(); return true; })) === true;

  async function onFile(f: File | undefined) {
    setFileErr(''); if (!f) return;
    if (/\.(xlsx?|ods|numbers)$/i.test(f.name)) { setFileErr('Excel files must be saved as CSV first: in Excel choose File → Save As → “CSV UTF-8 (Comma delimited)”, then choose that file here.'); return; }
    if (f.size > 2_000_000) { setFileErr('That file is larger than 2 MB. Split the register into smaller files.'); return; }
    try { const text = await f.text(); if (!text.trim()) { setFileErr(`${f.name} is empty.`); return; } setFileName(f.name); setCsv(text); }
    catch { setFileErr(`Could not read ${f.name}. Save it again as “CSV UTF-8” and retry.`); }
  }

  async function addOne() {
    setOneTouched(true); if (oneInvalid) return;
    const row: Row = { regNo: one.regNo.trim(), fullName: one.fullName.trim(), dateOfBirth: one.dateOfBirth, programCode: one.programCode, semester: +one.semester, batchYear: +one.batchYear };
    if (await importRows([row], () => `${row.fullName} (${row.regNo}) added. They can now create their account on the student portal with this registration number and date of birth.`)) setAddOpen(false);
  }
  async function importAll() { if (await importRows(parsed.rows, (n) => `${n} student${n === 1 ? '' : 's'} added to the register.`)) { setImp(false); setCsv(''); } }

  return (
    <>
      <PageHead title="Student register" sub="The official list of students entitled to create their own account. A student registers with their registration number, date of birth and an emailed code.">
        <button className="btn btn-green" onClick={() => { setOne(EMPTY_ONE); setOneTouched(false); setAddOpen(true); setDone(''); }}>Add student</button>
        <button className="btn" onClick={() => { setCsv(''); setFileName(''); setFileErr(''); setImp(true); setDone(''); }}>Import register (CSV)</button>
      </PageHead>
      {done && <Notice tone="ok"><span role="status">{done}</span></Notice>}
      <Card flush>
        <div className="filters">
          <Field label="Search"><input className="in" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Name or registration number" /></Field>
          <Field label="Status"><select className="in" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">All</option><option value="unclaimed">Not registered yet</option><option value="claimed">Registered</option></select></Field>
          {(insts.data?.length ?? 0) > 1 && <Field label="Institution"><select className="in" value={inst} onChange={(e) => { setInst(e.target.value); setPage(1); }}><option value="">All</option>{insts.data!.map((i) => <option key={i.id} value={i.id}>{i.code}</option>)}</select></Field>}
        </div>
        <Async state={st}>{(d) => <>
          <div className="small muted" style={{ padding: '8px 16px' }} data-testid="roster-summary">{d.claimed} of {d.total} on this list have registered.</div>
          <Table rowKey={(r: any) => r.id} rows={d.items} empty={search || status || inst ? <ListEmpty noun="entries" filters={[search && `“${search}”`, status && (status === 'claimed' ? 'registered' : 'not registered yet'), inst && 'this institution'].filter(Boolean) as string[]} onClear={url.reset} /> : 'No students on the register yet. Use “Add student” for one student, or “Import register (CSV)” for a whole class.'} cols={[
            { h: 'Reg. no.', cell: (r: any) => <span className="code">{r.regNo}</span> }, { h: 'Name', cell: (r: any) => <b>{r.fullName}</b> }, { h: 'Institution', cell: (r: any) => r.institution.code },
            { h: 'Programme', cell: (r: any) => r.program.code }, { h: 'Semester', num: true, cell: (r: any) => r.semester }, { h: 'Batch', num: true, cell: (r: any) => r.batchYear },
            { h: 'Status', cell: (r: any) => r.claimedAt ? <Badge tone="green">Registered</Badge> : <Badge tone="grey">Not registered yet</Badge> },
          ]} /><Pager page={page} total={d.total} size={25} onPage={setPage} /></>}</Async>
      </Card>

      {addOpen && <Modal title="Add a student to the register" onClose={() => setAddOpen(false)} footer={<><CancelButton /><button className="btn btn-green" disabled={busy} onClick={() => void addOne()}>Add student</button></>}>
        <form className="stack" noValidate onSubmit={(e) => { e.preventDefault(); void addOne(); }}>
          {choices.length > 1 && <Field label="Institution" required><select className="in" value={instId} onChange={(e) => setTarget(e.target.value)}>{choices.map((i: any) => <option key={i.id} value={i.id}>{i.code} — {i.name}</option>)}</select></Field>}
          <Field label="Registration number" required error={showOne('regNo')} hint="Exactly as on the admission letter. The student types this to register."><input className="in mono" value={one.regNo} onChange={set1('regNo')} placeholder="e.g. DMC-A-2025-0101" autoFocus /></Field>
          <Field label="Full name" required error={showOne('fullName')}><input className="in" value={one.fullName} onChange={set1('fullName')} placeholder="e.g. Amna Khan" /></Field>
          <Field label="Date of birth" required error={showOne('dateOfBirth')} hint="The student must enter the same date. It is not shown in the list."><input className="in" type="date" value={one.dateOfBirth} onChange={set1('dateOfBirth')} min="1940-01-01" max={today} /></Field>
          <Field label="Programme" required error={showOne('programCode')}><select className="in" value={one.programCode} onChange={set1('programCode')}><option value="">Choose a programme…</option>{(programs.data ?? []).map((p: any) => <option key={p.id} value={p.code}>{p.code} — {p.name}</option>)}</select></Field>
          <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
            <Field label="Semester" required error={showOne('semester')}><input className="in" type="number" inputMode="numeric" min={1} max={12} value={one.semester} onChange={set1('semester')} /></Field>
            <Field label="Batch year" required error={showOne('batchYear')} hint="Year of intake."><input className="in" type="number" inputMode="numeric" min={1990} max={2100} value={one.batchYear} onChange={set1('batchYear')} /></Field>
          </div>
          <button type="submit" hidden aria-hidden tabIndex={-1} />
        </form>
      </Modal>}

      {imp && <Modal title="Import student register" onClose={() => setImp(false)} footer={<><CancelButton /><button className="btn btn-green" disabled={busy || blocked} onClick={() => void importAll()}>Import {parsed.rows.length || ''} {parsed.rows.length === 1 ? 'entry' : 'entries'}</button></>}>
        <div className="stack">
          {choices.length > 1 && <Field label="Institution"><select className="in" value={instId} onChange={(e) => setTarget(e.target.value)}>{choices.map((i: any) => <option key={i.id} value={i.id}>{i.code}</option>)}</select></Field>}
          <Field label="CSV file" hint="One student per row: registration number, full name, date of birth (YYYY-MM-DD), programme code, semester, batch year. A header row is optional.">
            <input className="in" type="file" accept=".csv,text/csv,.txt" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void onFile(f); }} data-testid="roster-file" />
          </Field>
          <div className="small"><a className="auth-link" href={`data:text/csv;charset=utf-8,${encodeURIComponent(SAMPLE)}`} download="student-register-template.csv">Download a template</a>{fileName && <> · Loaded <b>{fileName}</b></>}</div>
          {fileErr && <Notice tone="bad">{fileErr}</Notice>}
          <details><summary className="small">…or paste the rows instead</summary>
            <Field label="Register (one student per line)" hint={`Columns: ${HEADER}. Dates as YYYY-MM-DD. Programme code e.g. MBBS. A header line is optional.`}>
              <textarea className="in mono" rows={6} value={csv} onChange={(e) => { setCsv(e.target.value); setFileName(''); }} placeholder={`${HEADER}\nDMC-A-2025-0101,Amna Khan,2004-03-09,MBBS,2,2025`} aria-describedby="roster-parse" />
            </Field>
          </details>
          <div id="roster-parse" className="small" role="status">
            {csv.trim() ? <>{parsed.rows.length} valid line{parsed.rows.length === 1 ? '' : 's'}{parsed.problems.length ? <>, <b style={{ color: 'var(--crimson)' }}>{parsed.problems.length} to fix</b>:</> : ' — ready to import.'}</> : 'Choose a CSV file, or paste the rows.'}
            {parsed.problems.slice(0, 5).map((p) => <div key={p} className="err-text">{p}</div>)}
            {parsed.problems.length > 5 && <div className="err-text">…and {parsed.problems.length - 5} more.</div>}
          </div>
          {parsed.rows.length > 0 && <div style={{ maxHeight: 220, overflow: 'auto' }} data-testid="roster-preview">
            <Table rowKey={(r: Row) => r.regNo} rows={parsed.rows.slice(0, 50)} cols={[
              { h: 'Reg. no.', cell: (r: Row) => <span className="code">{r.regNo}</span> }, { h: 'Name', cell: (r: Row) => r.fullName }, { h: 'Date of birth', cell: (r: Row) => r.dateOfBirth },
              { h: 'Programme', cell: (r: Row) => r.programCode }, { h: 'Sem.', num: true, cell: (r: Row) => r.semester }, { h: 'Batch', num: true, cell: (r: Row) => r.batchYear },
            ]} />
            {parsed.rows.length > 50 && <div className="small muted">Showing the first 50 of {parsed.rows.length}.</div>}
          </div>}
          <Notice>Dates of birth are used only to check a student who registers. They are not shown in the register list.</Notice>
        </div>
      </Modal>}
    </>
  );
}
