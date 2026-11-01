'use client';
import { useState } from 'react';
import { post, useGet } from '@/api';
import { useMe } from '@/session';
import { useUrlState } from '@/url-state';
import { Async, Card, Field, Modal, Notice, PageHead, Pager, Status, Table, useAction, CancelButton, ListEmpty } from '@/ui';

export default function Students() {
  const { me, can } = useMe(); const { run, busy } = useAction(); const url = useUrlState({ page: '1', search: '', inst: '' }); const page = Number(url.vals.page) || 1; const search = url.vals.search; const inst = url.vals.inst; const setPage = (n: number) => url.set('page', String(n)); const setSearch = (v: string) => url.set('search', v); const setInst = (v: string) => url.set('inst', v);
  const insts = useGet<any[]>('/institutions'); const programs = useGet<any[]>('/programs');
  const st = useGet<any>(`/students?page=${page}&pageSize=25${search ? `&search=${encodeURIComponent(search)}` : ''}${inst ? `&institutionId=${inst}` : ''}`);
  const [add, setAdd] = useState(false); const [imp, setImp] = useState(false); const [created, setCreated] = useState<string | null>(null);
  const [f, setF] = useState({ fullName: '', email: '', regNo: '', semester: 1, batchYear: new Date().getFullYear(), programId: '', institutionId: '' });
  const [csv, setCsv] = useState('');
  const instId = f.institutionId || inst || me?.institutions[0]?.id || insts.data?.[0]?.id || '';
  const rows = csv.trim().split('\n').filter(Boolean).map((l) => l.split(',').map((x) => x.trim())).filter((c) => c.length >= 5 && c[0] !== 'fullName').map(([fullName, email, regNo, semester, batchYear]) => ({ fullName, email, regNo, semester: +semester!, batchYear: +batchYear!, programId: f.programId || programs.data?.[0]?.id }));
  return (
    <>
      <PageHead title="Students" sub={me?.institutions.length ? `Scoped to ${me.institutions.map((i) => i.code).join(', ')}` : 'All institutions'}>
        {can('student.manage') && <><button className="btn" onClick={() => { setCsv(''); setImp(true); }}>Import CSV</button><button className="btn btn-green" onClick={() => { setF({ fullName: '', email: '', regNo: '', semester: 1, batchYear: new Date().getFullYear(), programId: '', institutionId: '' }); setAdd(true); }}>+ Add student</button></>}
      </PageHead>
      {created && <Notice tone="ok"><b>Student created.</b> Temporary password (shown once): <span className="mono">{created}</span> — the student must change it at first sign-in.</Notice>}
      <Card flush>
        <div className="filters"><Field label="Search"><input className="in" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Name or registration number" /></Field>
          {(insts.data?.length ?? 0) > 1 && <Field label="Institution"><select className="in" value={inst} onChange={(e) => { setInst(e.target.value); setPage(1); }}><option value="">All</option>{insts.data!.map((i) => <option key={i.id} value={i.id}>{i.code}</option>)}</select></Field>}</div>
        <Async state={st}>{(d) => <><Table rowKey={(r: any) => r.id} rows={d.items} empty={<ListEmpty noun="students" filters={[search && `“${search}”`, inst && 'this institution'].filter(Boolean) as string[]} onClear={url.reset} />} cols={[
          { h: 'Reg. no.', cell: (r: any) => <span className="code">{r.regNo}</span> }, { h: 'Name', cell: (r: any) => <b>{r.user.fullName}</b> }, { h: 'Email', cell: (r: any) => <span className="small">{r.user.email}</span> }, { h: 'Programme', cell: (r: any) => r.program.code }, { h: 'Sem', num: true, cell: (r: any) => r.semester }, { h: 'Campus', cell: (r: any) => r.institution.code }, { h: 'Status', cell: (r: any) => <Status s={r.status} /> },
        ]} /><Pager page={page} total={d.total} size={25} onPage={setPage} /></>}</Async>
      </Card>
      {add && <Modal title="Add student" onClose={() => setAdd(false)} missing={[!f.fullName && 'Full name', !f.email && 'Email', !f.regNo && 'Registration no.'].filter(Boolean) as string[]} footer={<><CancelButton /><button className="btn btn-green" disabled={busy || !f.fullName || !f.email || !f.regNo} onClick={() => run(async () => { const r = await post('/students', { ...f, institutionId: instId, programId: f.programId || programs.data![0].id }); setCreated(r.temporaryPassword); setAdd(false); st.reload(); })}>Create</button></>}>
        <div className="stack"><div className="grid g2"><Field label="Full name" required><input className="in" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></Field><Field label="Email" required><input className="in" type="email" autoComplete="off" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field><Field label="Registration no." required><input className="in mono" value={f.regNo} onChange={(e) => setF({ ...f, regNo: e.target.value })} /></Field>
          <Field label="Programme"><select className="in" value={f.programId} onChange={(e) => setF({ ...f, programId: e.target.value })}>{(programs.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</select></Field><Field label="Semester"><input className="in" type="number" min={1} max={12} value={f.semester} onChange={(e) => setF({ ...f, semester: +e.target.value })} /></Field><Field label="Batch year"><input className="in" type="number" value={f.batchYear} onChange={(e) => setF({ ...f, batchYear: +e.target.value })} /></Field></div>
          {(insts.data?.length ?? 0) > 1 && <Field label="Institution"><select className="in" value={instId} onChange={(e) => setF({ ...f, institutionId: e.target.value })}>{insts.data!.map((i) => <option key={i.id} value={i.id}>{i.code}</option>)}</select></Field>}</div></Modal>}
      {imp && <Modal title="Import students (CSV)" onClose={() => setImp(false)} missing={rows.length ? [] : ['at least one valid line (fullName,email,regNo,semester,batchYear)']} footer={<><CancelButton /><button className="btn btn-green" disabled={busy || !rows.length} onClick={() => run(async () => { const r = await post('/students/import', { institutionId: instId, rows }); setImp(false); setCsv(''); st.reload(); return r; }, `Imported ${rows.length} students`)}>Import {rows.length}</button></>}>
        <div className="stack"><p className="muted small" style={{ margin: 0 }}>Columns: <span className="mono">fullName,email,regNo,semester,batchYear</span>. Uses the programme selected in "Add student" (default first programme). Duplicates reject the whole file.</p>
          <textarea className="in mono" rows={8} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder="Ayesha Khan,ayesha@example.invalid,REG-2025-0001,1,2025" aria-label="CSV rows" /></div></Modal>}
    </>
  );
}
