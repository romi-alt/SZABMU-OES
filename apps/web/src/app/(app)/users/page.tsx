'use client';
import { useState } from 'react';
import { patch, post, fmtDT, useGet } from '@/api';
import { useMe } from '@/session';
import { Async, Card, Field, Modal, Notice, PageHead, Pager, Status, Table, useAction } from '@/ui';
import { ROLES, ROLE_LABEL } from '@oes/shared';

export default function Users() {
  const { me } = useMe(); const { run, busy } = useAction(); const [page, setPage] = useState(1); const [role, setRole] = useState(''); const [search, setSearch] = useState('');
  const insts = useGet<any[]>('/institutions'); const st = useGet<any>(`/users?page=${page}&pageSize=25${role ? `&role=${role}` : '&staffOnly=true'}${search ? `&search=${encodeURIComponent(search)}` : ''}`);
  const [add, setAdd] = useState(false); const [secret, setSecret] = useState<string | null>(null);
  const roles = me?.role === 'SUPER_ADMIN' ? ROLES : (['LECTURER', 'INVIGILATOR', 'STUDENT'] as const);
  const [f, setF] = useState({ fullName: '', email: '', role: 'LECTURER', institutionIds: [] as string[] });
  return (
    <>
      <PageHead title={me?.role === 'SUPER_ADMIN' ? 'Users' : 'Staff & accounts'} sub="Staff accounts: create, deactivate leavers and reset passwords. Students are managed from the Students page (choose Student in the filter to see them). Every action is audited."><button className="btn btn-green" onClick={() => setAdd(true)}>+ New account</button></PageHead>
      {secret && <Notice tone="ok"><b>Temporary password (shown once):</b> <span className="mono">{secret}</span> — the user must change it at first sign-in.</Notice>}
      <Card flush>
        <div className="filters"><Field label="Role"><select className="in" value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }}><option value="">All staff</option>{roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></Field><Field label="Search"><input className="in" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} /></Field></div>
        <Async state={st}>{(d) => <><Table rowKey={(r: any) => r.id} rows={d.items} cols={[
          { h: 'Name', cell: (r: any) => <b>{r.fullName}</b> }, { h: 'Email', cell: (r: any) => <span className="small">{r.email}</span> }, { h: 'Role', cell: (r: any) => ROLE_LABEL[r.role as keyof typeof ROLE_LABEL] }, { h: 'Institutions', cell: (r: any) => r.institutions.map((i: any) => i.code).join(', ') || 'University-wide' },
          { h: 'Last sign-in', cell: (r: any) => fmtDT(r.lastLoginAt) }, { h: 'Status', cell: (r: any) => <Status s={r.active ? 'ACTIVE' : 'CANCELLED'} /> },
          { h: '', cell: (r: any) => r.id === me?.id ? null : <div className="row"><button className="btn btn-sm" onClick={() => run(async () => { await patch(`/users/${r.id}`, { active: !r.active }); st.reload(); }, r.active ? 'Deactivated' : 'Reactivated')}>{r.active ? 'Deactivate' : 'Reactivate'}</button><button className="btn btn-sm" onClick={() => run(async () => { const x = await post(`/users/${r.id}/reset-password`); setSecret(x.temporaryPassword); })}>Reset password</button></div> },
        ]} /><Pager page={page} total={d.total} size={25} onPage={setPage} /></>}</Async>
      </Card>
      {add && <Modal title="New account" onClose={() => setAdd(false)} footer={<><button className="btn" onClick={() => setAdd(false)}>Cancel</button><button className="btn btn-green" disabled={busy || !f.fullName || !f.email} onClick={() => run(async () => { const r = await post('/users', { ...f, institutionIds: f.institutionIds.length ? f.institutionIds : (me?.institutions.map((i) => i.id) ?? []).slice(0, 1) }); setSecret(r.temporaryPassword); setAdd(false); st.reload(); })}>Create</button></>}>
        <div className="stack"><Field label="Full name"><input className="in" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></Field><Field label="Email"><input className="in" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Role"><select className="in" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{roles.filter((r) => r !== 'STUDENT').map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></Field>
          {(insts.data?.length ?? 0) > 1 && <Field label="Institutions (campus-scoped roles)"><select multiple className="in" value={f.institutionIds} onChange={(e) => setF({ ...f, institutionIds: [...e.target.selectedOptions].map((o) => o.value) })}>{insts.data!.map((i) => <option key={i.id} value={i.id}>{i.code} — {i.name}</option>)}</select></Field>}
          <span className="hint">Student accounts are created from the Students page.</span></div></Modal>}
    </>
  );
}
