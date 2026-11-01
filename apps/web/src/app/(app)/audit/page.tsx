'use client';
import { useState } from 'react';
import { fmtDT, get, useGet } from '@/api';
import { useMe } from '@/session';
import { Async, Card, Field, Notice, PageHead, Pager, Table, useAction } from '@/ui';

export default function Audit() {
  const { me } = useMe(); const { run } = useAction(); const [page, setPage] = useState(1); const [entity, setEntity] = useState(''); const [action, setAction] = useState('');
  const st = useGet<any>(`/audit?page=${page}&pageSize=50${entity ? `&entity=${entity}` : ''}${action ? `&action=${encodeURIComponent(action)}` : ''}`); const [chain, setChain] = useState<any>(null);
  return (
    <>
      <PageHead title="Audit trail" sub="Append-only, hash-chained record of security-relevant actions.">{me?.role === 'SUPER_ADMIN' || me?.role === 'CCE' ? <button className="btn" onClick={() => run(async () => setChain(await get('/audit/verify')))}>Verify chain integrity</button> : null}</PageHead>
      {chain && <Notice tone={chain.brokenAt ? 'bad' : 'ok'}>{chain.brokenAt ? `Chain broken at sequence ${chain.brokenAt}.` : `Chain intact — ${chain.checked} entries verified.`}</Notice>}
      <Card flush>
        <div className="filters"><Field label="Entity"><select className="in" value={entity} onChange={(e) => { setEntity(e.target.value); setPage(1); }}><option value="">All</option>{['user', 'student', 'question', 'exam', 'attempt', 'incident', 'enrollment', 'institution'].map((x) => <option key={x}>{x}</option>)}</select></Field><Field label="Action starts with"><input className="in" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} placeholder="e.g. auth." /></Field></div>
        <Async state={st}>{(d) => <><Table rowKey={(r: any) => r.seq} rows={d.items} cols={[
          { h: '#', num: true, cell: (r: any) => r.seq }, { h: 'When', cell: (r: any) => fmtDT(r.at) }, { h: 'Action', cell: (r: any) => <span className="code">{r.action}</span> }, { h: 'Role', cell: (r: any) => r.actorRole?.toLowerCase() ?? '—' }, { h: 'Entity', cell: (r: any) => `${r.entity}${r.entityId ? ' ' + r.entityId.slice(0, 8) : ''}` }, { h: 'Detail', cell: (r: any) => <span className="small mono faint">{r.meta ? JSON.stringify(r.meta).slice(0, 90) : ''}</span> }, { h: 'Hash', cell: (r: any) => <span className="small mono faint">{r.hash.slice(0, 10)}</span> },
        ]} /><Pager page={page} total={d.total} size={50} onPage={setPage} /></>}</Async>
      </Card>
    </>
  );
}
