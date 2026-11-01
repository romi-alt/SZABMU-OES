'use client';
import { useState } from 'react';
import { post, useGet } from '@/api';
import { useMe } from '@/session';
import { useUrlState } from '@/url-state';
import { Async, Badge, Card, Field, Modal, Notice, PageHead, Pager, Table, useAction, CancelButton, ListEmpty } from '@/ui';

const HEADER = 'regNo,fullName,dateOfBirth,programCode,semester,batchYear';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
interface Row { regNo: string; fullName: string; dateOfBirth: string; programCode: string; semester: number; batchYear: number }

/** Parses pasted CSV; returns valid rows plus a human message for each bad line (1-based line numbers). */
function parseCsv(text: string): { rows: Row[]; problems: string[] } {
  const rows: Row[] = []; const problems: string[] = [];
  text.split('\n').map((l) => l.trim()).forEach((line, i) => {
    if (!line || line.toLowerCase().startsWith('regno')) return;
    const c = line.split(',').map((x) => x.trim());
    if (c.length < 6) { problems.push(`Line ${i + 1}: expected 6 columns, found ${c.length}.`); return; }
    const [regNo, fullName, dateOfBirth, programCode, sem, batch] = c as [string, string, string, string, string, string];
    if (regNo.length < 3) problems.push(`Line ${i + 1}: registration number is too short.`);
    else if (fullName.length < 2) problems.push(`Line ${i + 1}: name is missing.`);
    else if (!DATE_RE.test(dateOfBirth) || Number.isNaN(Date.parse(dateOfBirth))) problems.push(`Line ${i + 1}: date of birth must look like 2004-03-09.`);
    else if (!programCode) problems.push(`Line ${i + 1}: programme code is missing.`);
    else if (!(+sem >= 1 && +sem <= 12)) problems.push(`Line ${i + 1}: semester must be 1–12.`);
    else if (!(+batch >= 1990 && +batch <= 2100)) problems.push(`Line ${i + 1}: batch year looks wrong.`);
    else rows.push({ regNo, fullName, dateOfBirth, programCode, semester: +sem, batchYear: +batch });
  });
  return { rows, problems };
}

export default function Roster() {
  const { me } = useMe(); const { run, busy } = useAction();
  const url = useUrlState({ page: '1', search: '', status: '', inst: '' }); const page = Number(url.vals.page) || 1; const search = url.vals.search; const status = url.vals.status; const inst = url.vals.inst; const setPage = (n: number) => url.set('page', String(n)); const setSearch = (v: string) => url.set('search', v); const setStatus = (v: string) => url.set('status', v); const setInst = (v: string) => url.set('inst', v);
  const insts = useGet<any[]>('/institutions');
  const st = useGet<any>(`/roster?page=${page}&pageSize=25${search ? `&search=${encodeURIComponent(search)}` : ''}${status ? `&status=${status}` : ''}${inst ? `&institutionId=${inst}` : ''}`);
  const [imp, setImp] = useState(false); const [csv, setCsv] = useState(''); const [target, setTarget] = useState(''); const [done, setDone] = useState('');
  const mine = me?.institutions ?? []; const choices = mine.length ? mine : (insts.data ?? []);
  const instId = target || choices[0]?.id || '';
  const parsed = parseCsv(csv); const blocked = !instId || !parsed.rows.length || parsed.problems.length > 0;
  return (
    <>
      <PageHead title="Student register" sub="The official list of students entitled to create their own account. A student registers with their registration number, date of birth and an emailed code."><button className="btn btn-green" onClick={() => { setCsv(''); setImp(true); setDone(''); }}>Import register (CSV)</button></PageHead>
      {done && <Notice tone="ok"><span role="status">{done}</span></Notice>}
      <Card flush>
        <div className="filters">
          <Field label="Search"><input className="in" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Name or registration number" /></Field>
          <Field label="Status"><select className="in" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">All</option><option value="unclaimed">Not registered yet</option><option value="claimed">Registered</option></select></Field>
          {(insts.data?.length ?? 0) > 1 && <Field label="Institution"><select className="in" value={inst} onChange={(e) => { setInst(e.target.value); setPage(1); }}><option value="">All</option>{insts.data!.map((i) => <option key={i.id} value={i.id}>{i.code}</option>)}</select></Field>}
        </div>
        <Async state={st}>{(d) => <>
          <div className="small muted" style={{ padding: '8px 16px' }} data-testid="roster-summary">{d.claimed} of {d.total} on this list have registered.</div>
          <Table rowKey={(r: any) => r.id} rows={d.items} empty={search || status || inst ? <ListEmpty noun="entries" filters={[search && `“${search}”`, status && (status === 'claimed' ? 'registered' : 'not registered yet'), inst && 'this institution'].filter(Boolean) as string[]} onClear={url.reset} /> : 'No entries yet. Import the register to let students sign up.'} cols={[
            { h: 'Reg. no.', cell: (r: any) => <span className="code">{r.regNo}</span> }, { h: 'Name', cell: (r: any) => <b>{r.fullName}</b> }, { h: 'Institution', cell: (r: any) => r.institution.code },
            { h: 'Programme', cell: (r: any) => r.program.code }, { h: 'Semester', num: true, cell: (r: any) => r.semester }, { h: 'Batch', num: true, cell: (r: any) => r.batchYear },
            { h: 'Status', cell: (r: any) => r.claimedAt ? <Badge tone="green">Registered</Badge> : <Badge tone="grey">Not registered yet</Badge> },
          ]} /><Pager page={page} total={d.total} size={25} onPage={setPage} /></>}</Async>
      </Card>
      {imp && <Modal title="Import student register" onClose={() => setImp(false)} footer={<><CancelButton /><button className="btn btn-green" disabled={busy || blocked}
        onClick={() => run(async () => { const r = await post('/roster/import', { institutionId: instId, rows: parsed.rows }); setImp(false); setCsv(''); setDone(`${r.imported} student${r.imported === 1 ? '' : 's'} added to the register.`); st.reload(); })}>Import {parsed.rows.length || ''} {parsed.rows.length === 1 ? 'entry' : 'entries'}</button></>}>
        <div className="stack">
          {choices.length > 1 && <Field label="Institution"><select className="in" value={instId} onChange={(e) => setTarget(e.target.value)}>{choices.map((i: any) => <option key={i.id} value={i.id}>{i.code}</option>)}</select></Field>}
          <Field label="Register (one student per line)" hint={`Columns: ${HEADER}. Dates as YYYY-MM-DD. Programme code e.g. MBBS. A header line is optional.`}>
            <textarea className="in mono" rows={8} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={`${HEADER}\nDMC-A-2025-0101,Amna Khan,2004-03-09,MBBS,2,2025`} aria-describedby="roster-parse" />
          </Field>
          <div id="roster-parse" className="small" role="status">
            {csv.trim() ? <>{parsed.rows.length} valid line{parsed.rows.length === 1 ? '' : 's'}{parsed.problems.length ? <>, <b style={{ color: 'var(--crimson)' }}>{parsed.problems.length} to fix</b>:</> : ' — ready to import.'}</> : 'Paste the register above.'}
            {parsed.problems.slice(0, 5).map((p) => <div key={p} className="err-text">{p}</div>)}
          </div>
          <Notice>Dates of birth are used only to check a student who registers. They are not shown in this list.</Notice>
        </div>
      </Modal>}
    </>
  );
}
