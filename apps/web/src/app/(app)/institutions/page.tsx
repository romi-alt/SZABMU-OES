'use client';
import { useState } from 'react';
import { patch, post, useGet } from '@/api';
import { useMe } from '@/session';
import { Async, Card, Confirm, Field, Modal, PageHead, Status, Table, useAction } from '@/ui';
import { INSTITUTION_TYPES } from '@oes/shared';

export default function Institutions() {
  const { can } = useMe(); const { run, busy } = useAction(); const st = useGet<any[]>('/institutions'); const [add, setAdd] = useState(false); const [off, setOff] = useState<any>(null);
  const [f, setF] = useState({ code: '', name: '', type: 'MEDICAL_COLLEGE', affiliation: 'CONSTITUENT', city: '' });
  return (
    <>
      <PageHead title="Institutions" sub="Constituent and affiliated colleges and institutes.">{can('institution.manage') && <button className="btn btn-green" onClick={() => setAdd(true)}>+ Register institution</button>}</PageHead>
      <Card flush><Async state={st}>{(rows: any[]) => <Table rowKey={(r: any) => r.id} rows={rows} cols={[
        { h: 'Code', cell: (r: any) => <span className="code">{r.code}</span> }, { h: 'Name', cell: (r: any) => <b>{r.name}</b> }, { h: 'Type', cell: (r: any) => r.type.replace(/_/g, ' ').toLowerCase() }, { h: 'Affiliation', cell: (r: any) => r.affiliation.toLowerCase() }, { h: 'City', cell: (r: any) => r.city ?? '—' }, { h: 'Students', num: true, cell: (r: any) => r._count.students },
        { h: 'Status', cell: (r: any) => <Status s={r.active ? 'ACTIVE' : 'CANCELLED'} /> }, { h: '', cell: (r: any) => !can('institution.manage') ? null : <button className="btn btn-sm" aria-label={`${r.active ? 'Deactivate' : 'Activate'} ${r.name}`} onClick={() => (r.active ? setOff(r) : run(async () => { await patch(`/institutions/${r.id}`, { active: true }); st.reload(); }, 'Institution activated'))}>{r.active ? 'Deactivate' : 'Activate'}</button> },
      ]} />}</Async></Card>
      {off && <Confirm danger title={`Deactivate ${off.name}?`} yes="Deactivate institution" onNo={() => setOff(null)} onYes={() => run(async () => { await patch(`/institutions/${off.id}`, { active: false }); setOff(null); st.reload(); }, 'Institution deactivated')}
        body={<>Staff and candidates of <b>{off.code}</b> will no longer be able to use it for new exams. No student data is deleted, and you can activate it again at any time.</>} />}
      {add && <Modal title="Register institution" onClose={() => setAdd(false)} footer={<><button className="btn" onClick={() => setAdd(false)}>Cancel</button><button className="btn btn-green" disabled={busy || !f.code || !f.name} onClick={() => run(async () => { await post('/institutions', { ...f, city: f.city || undefined }); setAdd(false); st.reload(); }, 'Institution registered')}>Register</button></>}>
        <div className="stack"><div className="grid g2"><Field label="Code" hint="Capitals, digits, hyphen"><input className="in mono" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /></Field><Field label="City"><input className="in" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></Field></div>
          <Field label="Name"><input className="in" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <div className="grid g2"><Field label="Type"><select className="in" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{INSTITUTION_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ').toLowerCase()}</option>)}</select></Field><Field label="Affiliation"><select className="in" value={f.affiliation} onChange={(e) => setF({ ...f, affiliation: e.target.value })}><option value="CONSTITUENT">Constituent</option><option value="AFFILIATED">Affiliated</option></select></Field></div></div></Modal>}
    </>
  );
}
