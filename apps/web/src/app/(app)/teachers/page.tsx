'use client';
import { useState } from 'react';
import { fmtDT, post, useGet } from '@/api';
import { useUrlState } from '@/url-state';
import { Async, Badge, CancelButton, Field, ListEmpty, Modal, PageHead, Pager, Table, useAction, useToast } from '@/ui';
import { auditLabel } from '@/audit-labels';

const TONE: Record<string, string> = { PENDING: 'amber', APPROVED: 'green', REJECTED: 'red', SUSPENDED: 'red', REVOKED: 'grey' };
const word = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

export default function Teachers() {
  const url = useUrlState({ tab: 'pending', page: '1', search: '', status: '' }); const { tab, search, status } = url.vals; const page = Number(url.vals.page) || 1;
  const effective = tab === 'pending' ? 'PENDING' : status;
  const st = useGet<any>(`/admin/teachers?page=${page}&pageSize=25${effective ? `&status=${effective}` : ''}${search ? `&search=${encodeURIComponent(search)}` : ''}`);
  const [open, setOpen] = useState<string | null>(null);
  const pending = st.data?.pending ?? 0;
  return (
    <>
      <PageHead title="Teachers" sub="Review registrations, approve each class and subject, and manage teacher access." />
      <div className="tabs" role="tablist" aria-label="Teacher lists">
        <button role="tab" aria-selected={tab === 'pending'} className={tab === 'pending' ? 'on' : ''} onClick={() => { url.set('tab', 'pending'); url.set('page', '1'); }}>Pending registrations{pending ? <span className="count">{pending}</span> : null}</button>
        <button role="tab" aria-selected={tab === 'directory'} className={tab === 'directory' ? 'on' : ''} onClick={() => { url.set('tab', 'directory'); url.set('page', '1'); }}>Teacher directory</button>
      </div>
      <div className="filters" style={{ margin: '12px 0' }}>
        <Field label="Search"><input className="in" type="search" value={search} onChange={(e) => { url.set('search', e.target.value); url.set('page', '1'); }} placeholder="Name, email, faculty ID or department" /></Field>
        {tab === 'directory' && <Field label="Status"><select className="in" value={status} onChange={(e) => { url.set('status', e.target.value); url.set('page', '1'); }}><option value="">All</option>{['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'].map((s) => <option key={s} value={s}>{word(s)}</option>)}</select></Field>}
      </div>
      <Async state={st}>{(d) => d.items.length ? (
        <>
          <div data-testid="teacher-list"><Table rowKey={(r: any) => r.userId} rows={d.items} cols={[
            { h: 'Teacher', cell: (r: any) => <><button className="btn-link" onClick={() => setOpen(r.userId)}><b>{r.fullName}</b></button><div className="small faint">{r.email}</div></> }, { h: 'Faculty ID', cls: 'mono', cell: (r: any) => r.employeeId },
            { h: 'Department', cell: (r: any) => <>{r.department}<div className="small faint">{r.designation}</div></> }, { h: 'Status', cell: (r: any) => <Badge tone={TONE[r.status]}>{word(r.status)}</Badge> },
            { h: 'Class-subject requests', cell: (r: any) => <span className="small">{r.assignments.pending} pending · {r.assignments.approved} approved · {r.assignments.rejected} rejected</span> }, { h: 'Submitted', cell: (r: any) => <span className="small">{fmtDT(r.submittedAt)}</span> },
          ]} /></div>
          <Pager page={page} total={d.total} size={25} onPage={(n) => url.set('page', String(n))} />
        </>) : tab === 'pending' && !search ? <p className="muted" data-testid="teacher-empty">No registrations are waiting for review.</p> : <ListEmpty noun="teachers" filters={[search && `“${search}”`, status && word(status)].filter(Boolean) as string[]} onClear={url.reset} />}
      </Async>
      {open && <TeacherDetail userId={open} onClose={() => setOpen(null)} onChanged={() => st.reload?.()} />}
    </>
  );
}

function Reason({ title, label, optional, yes, onYes, onNo }: { title: string; label: string; optional?: boolean; yes: string; onYes: (note: string) => void; onNo: () => void }) {
  const [note, setNote] = useState('');
  const ok = optional || note.trim().length >= 5;
  return (
    <Modal title={title} onClose={onNo} missing={ok ? [] : [label]} footer={<><CancelButton /><button className="btn btn-primary" disabled={!ok} onClick={() => onYes(note.trim())}>{yes}</button></>}>
      <Field label={label} required={!optional} hint={optional ? undefined : 'At least 5 characters. The teacher and the audit trail see this.'}><textarea className="in" rows={3} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} /></Field>
    </Modal>
  );
}

function TeacherDetail({ userId, onClose, onChanged }: { userId: string; onClose: () => void; onChanged: () => void }) {
  const st = useGet<any>(`/admin/teachers/${userId}`); const [pools, setPools] = useState<any[] | null>(null); const [activity, setActivity] = useState<any | null>(null); const { run, busy } = useAction(); const toast = useToast();
  const [ask, setAsk] = useState<{ title: string; label: string; optional?: boolean; yes: string; act: (note: string) => Promise<unknown>; done: string } | null>(null);
  const act = (path: string, body: object, done: string) => run(async () => { await post(path, body); toast(done); st.reload?.(); onChanged(); });
  return (
    <Modal title="Teacher registration" onClose={onClose} footer={<CancelButton>Close</CancelButton>}>
      <Async state={st}>{(d) => (
        <div className="stack" data-testid="teacher-detail">
          <div className="detail-head">
            {d.photo ? <img src={d.photo} alt={`Photo of ${d.fullName}`} width={64} height={64} /> : <span className="photo-ph" aria-hidden>{d.fullName.charAt(0)}</span>}
            <div><h3 style={{ margin: 0 }}>{d.fullName} <Badge tone={TONE[d.status]}>{word(d.status)}</Badge></h3><div className="small faint">{d.email} · {d.phone ?? 'no phone'}</div></div>
          </div>
          <dl className="facts"><div><dt>Faculty / employee ID</dt><dd className="mono">{d.employeeId}</dd></div><div><dt>Department</dt><dd>{d.department}</dd></div><div><dt>Designation</dt><dd>{d.designation}</dd></div><div><dt>Registered</dt><dd>{fmtDT(d.submittedAt)}</dd></div></dl>
          {d.reviewNote && <p className="small muted" style={{ margin: 0 }}><b>Last note:</b> {d.reviewNote}</p>}
          <div className="row wrap">
            {(d.status === 'PENDING' || d.status === 'REJECTED') && <button className="btn btn-green" disabled={busy} onClick={() => act(`/admin/teachers/${userId}/decision`, { decision: 'APPROVE' }, 'Registration approved')}>Approve registration</button>}
            {d.status === 'PENDING' && <button className="btn" onClick={() => setAsk({ title: 'Reject registration', label: 'Reason', yes: 'Reject registration', done: 'Registration rejected', act: (note) => post(`/admin/teachers/${userId}/decision`, { decision: 'REJECT', note }) })}>Reject registration</button>}
            {d.status === 'APPROVED' && <button className="btn" onClick={() => setAsk({ title: 'Suspend teacher access', label: 'Reason', yes: 'Suspend access', done: 'Access suspended', act: (note) => post(`/admin/teachers/${userId}/suspend`, { note }) })}>Suspend access</button>}
            {d.status === 'SUSPENDED' && <button className="btn btn-green" disabled={busy} onClick={() => act(`/admin/teachers/${userId}/reinstate`, {}, 'Access restored')}>Reinstate access</button>}
          </div>
          <p className="small faint" style={{ margin: 0 }}>Approving a registration does not give access to any class or subject. Decide each request below.</p>
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th scope="col">Subject</th><th scope="col">Class</th><th scope="col">Session</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{d.assignments.map((a: any) => (
              <tr key={a.id}><td><b>{a.course.title}</b><div className="small faint">{a.course.code}</div></td><td>{a.institution.code} · {a.course.program.code} · Semester {a.course.semester}</td><td>{a.term}</td>
                <td><Badge tone={TONE[a.status]}>{word(a.status)}</Badge>{a.decisionNote && <div className="small faint">{a.decisionNote}</div>}</td>
                <td className="row-actions">
                  {a.status === 'PENDING' && <><button className="btn btn-sm btn-green" disabled={busy} onClick={() => act(`/admin/teachers/assignments/${a.id}/decision`, { decision: 'APPROVE' }, 'Class and subject approved')}>Approve</button>
                    <button className="btn btn-sm" onClick={() => setAsk({ title: 'Reject class and subject', label: 'Reason', yes: 'Reject', done: 'Rejected', act: (note) => post(`/admin/teachers/assignments/${a.id}/decision`, { decision: 'REJECT', note }) })}>Reject</button></>}
                  {a.status === 'APPROVED' && <button className="btn btn-sm" onClick={() => setAsk({ title: 'Remove access to this class and subject', label: 'Reason', yes: 'Remove access', done: 'Access removed', act: (note) => post(`/admin/teachers/assignments/${a.id}/revoke`, { note }) })}>Revoke</button>}
                </td></tr>))}</tbody></table></div>
          <div>
            {pools === null ? <button className="btn btn-sm" onClick={() => run(async () => { const { get } = await import('@/api'); setPools(await get<any[]>(`/admin/teachers/${userId}/pools`)); })}>View MCQ pools</button> : (
              <section aria-label="MCQ pools" data-testid="teacher-pools"><h4 style={{ margin: '0 0 6px' }}>MCQ pools</h4>
                {pools.length ? pools.map((p) => <details key={p.id} style={{ marginBottom: 6 }}><summary><b>{p.name}</b> · {p.course?.code} · {p.questions.length} question{p.questions.length === 1 ? '' : 's'}</summary>
                  <ul className="plain-list">{p.questions.map((q: any) => <li key={q.id}>{q.stem} <span className="small faint">({word(q.difficulty)}, {q.status.toLowerCase()})</span></li>)}</ul></details>) : <p className="muted small">This teacher has no pools in your institutions.</p>}</section>)}
          </div>
          <div>
            {activity === null ? <button className="btn btn-sm" onClick={() => run(async () => { const { get } = await import('@/api'); setActivity(await get<any>(`/admin/teachers/${userId}/activity`)); })}>View activity history</button> : (
              <section aria-label="Activity history" data-testid="teacher-activity"><h4 style={{ margin: '0 0 6px' }}>Activity history</h4>
                <p className="small muted" style={{ margin: '0 0 6px' }}>Question banks: {activity.summary.banks.total} ({activity.summary.banks.draft + activity.summary.banks.empty} draft · {activity.summary.banks.submitted} under review · {activity.summary.banks.rejected} returned · {activity.summary.banks.approved} approved). Questions: {activity.summary.questions.draft} draft · {activity.summary.questions.submitted} under review · {activity.summary.questions.rejected} returned · {activity.summary.questions.approved} approved.</p>
                {activity.items.length ? <ul className="plain-list">{activity.items.map((i: any, n: number) => (
                  <li key={n}><b>{auditLabel(i.action)}</b>{i.bank ? <> — {i.bank.name}</> : null}{typeof i.approved === 'number' ? <> ({i.approved} approved, {i.rejected} returned)</> : null}{i.note ? <> — “{i.note}”</> : null}
                    <div className="small faint">{fmtDT(i.at)} · {i.actor.name}</div></li>))}</ul> : <p className="muted small">No activity recorded for your institutions yet.</p>}</section>)}
          </div>
        </div>)}
      </Async>
      {ask && <Reason title={ask.title} label={ask.label} optional={ask.optional} yes={ask.yes} onNo={() => setAsk(null)} onYes={(note) => run(async () => { await ask.act(note); toast(ask.done); setAsk(null); st.reload?.(); onChanged(); })} />}
    </Modal>
  );
}
