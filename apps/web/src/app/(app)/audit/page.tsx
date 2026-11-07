'use client';
import { useState } from 'react';
import Link from 'next/link';
import { ROLE_LABEL } from '@oes/shared';
import { auditLabel, entityLabel } from '@/audit-labels';
import { fmtDT, get, useGet } from '@/api';
import { useMe } from '@/session';
import { useUrlState } from '@/url-state';
import { Async, Card, Field, Notice, PageHead, Pager, Table, useAction, ListEmpty } from '@/ui';

/** Plain-language activity groups for the filter (audit A-10); each maps to an action-code prefix the API already supports. */
const ACTIVITY: [string, string][] = [['auth.', 'Sign-in and passwords'], ['mfa.', 'Two-factor authentication'], ['user.', 'Staff accounts'], ['student.', 'Students'], ['teacher.', 'Teachers'],
  ['question.', 'Question bank'], ['paper.', 'Papers'], ['exam.', 'Examinations and live control'], ['eligibility.', 'Eligibility and admission'], ['attempt.', 'Candidate attempts'],
  ['grading.', 'Grading and key corrections'], ['results.', 'Results and publication'], ['institution.', 'Institutions'], ['course.', 'Courses and lecturer assignments']];
const ENTITIES = ['user', 'student', 'teacher', 'question', 'exam', 'attempt', 'incident', 'enrollment', 'institution'];

export default function Audit() {
  const { me } = useMe(); const { run } = useAction(); const url = useUrlState({ page: '1', entity: '', action: '' }); const page = Number(url.vals.page) || 1; const entity = url.vals.entity; const action = url.vals.action; const setPage = (n: number) => url.set('page', String(n)); const setEntity = (v: string) => url.set('entity', v); const setAction = (v: string) => url.set('action', v);
  const st = useGet<any>(`/audit?page=${page}&pageSize=50${entity ? `&entity=${entity}` : ''}${action ? `&action=${encodeURIComponent(action)}` : ''}`); const [chain, setChain] = useState<any>(null);
  return (
    <>
      <PageHead title="Audit trail" sub="Append-only, hash-chained record of security-relevant actions.">{me?.role === 'SUPER_ADMIN' || me?.role === 'CCE' ? <button className="btn" onClick={() => run(async () => setChain(await get('/audit/verify')))}>Verify chain integrity</button> : null}</PageHead>
      {chain && <Notice tone={chain.brokenAt ? 'bad' : 'ok'}>{chain.brokenAt ? `Chain broken at sequence ${chain.brokenAt}.` : `Chain intact — ${chain.checked} entries verified.`}</Notice>}
      <Card flush>
        <div className="filters"><Field label="Entity"><select className="in" value={entity} onChange={(e) => { setEntity(e.target.value); setPage(1); }}><option value="">All records</option>{ENTITIES.map((x) => <option key={x} value={x}>{entityLabel(x)}</option>)}</select></Field><Field label="Activity"><select className="in" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }}><option value="">All activity</option>{ACTIVITY.map(([v, l]) => <option key={v} value={v}>{l}</option>)}{action && !ACTIVITY.some(([v]) => v === action) && <option value={action}>{action}</option>}</select></Field></div>
        <Async state={st}>{(d) => <><Table rowKey={(r: any) => String(r.seq)} rowLabel={(r: any) => `entry ${r.seq}`} rows={d.items} empty={<ListEmpty noun="audit entries" filters={[entity && entityLabel(entity), action && (ACTIVITY.find(([v]) => v === action)?.[1] ?? action)].filter(Boolean) as string[]} onClear={url.reset} />} cols={[
          { h: 'Entry no.', num: true, more: true, cell: (r: any) => r.seq }, { h: 'When', cls: 'nowrap', cell: (r: any) => fmtDT(r.at) },
          { h: 'What happened', cell: (r: any) => <><b>{auditLabel(r.action)}</b><div className="small faint code" title="Technical action name">{r.action}</div></> },
          { h: 'Who', more: true, cell: (r: any) => r.actorRole ? ROLE_LABEL[r.actorRole as keyof typeof ROLE_LABEL] ?? r.actorRole.toLowerCase() : 'System / not signed in' },
          { h: 'About', more: true, cell: (r: any) => r.entity === 'exam' && r.entityId ? <Link href={`/exams/${r.entityId}`}>{entityLabel(r.entity)} {r.entityId.slice(0, 8)}</Link> : <>{entityLabel(r.entity)}{r.entityId ? <span className="small faint mono"> {r.entityId.slice(0, 8)}</span> : null}</> },
          { h: 'Details', more: true, cell: (r: any) => <details className="audit-det"><summary className="small">Show</summary><div className="small mono faint">{r.meta ? JSON.stringify(r.meta) : 'No extra details.'}<br />Record hash {r.hash.slice(0, 16)}…</div></details> },
        ]} /><Pager page={page} total={d.total} size={50} onPage={setPage} /></>}</Async>
      </Card>
    </>
  );
}
