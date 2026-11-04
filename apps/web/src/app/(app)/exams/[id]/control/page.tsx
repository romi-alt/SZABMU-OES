'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, fmtDT, openStream, post, useGet } from '@/api';
import { useMe } from '@/session';
import { Async, Badge, Card, Field, Modal, PageHead, Stat, Status, Table, errMsg, useAction, useToast, CancelButton } from '@/ui';

type Cmd = 'OPEN_ADMISSION' | 'CLOSE_ADMISSION' | 'START' | 'SUSPEND' | 'RESUME' | 'EXTEND' | 'CLOSE' | 'RECONCILE' | 'INITIATE_SCORING';
const LABEL: Record<Cmd, string> = { OPEN_ADMISSION: 'Open admission', CLOSE_ADMISSION: 'Stop new entries', START: 'Start examination', SUSPEND: 'Suspend…', RESUME: 'Resume…', EXTEND: 'Extend time…', CLOSE: 'End examination…', RECONCILE: 'Seal expired attempts', INITIATE_SCORING: 'Start scoring' };
const SLUG: Record<Cmd, string> = { OPEN_ADMISSION: 'open-admission', CLOSE_ADMISSION: 'close-admission', START: 'start', SUSPEND: 'suspend', RESUME: 'resume', EXTEND: 'extend', CLOSE: 'close', RECONCILE: 'reconcile', INITIATE_SCORING: 'initiate-scoring' };
const EXPLAIN: Partial<Record<Cmd, string>> = {
  OPEN_ADMISSION: 'Eligible candidates will be able to enter. No attempt deadline is changed.',
  CLOSE_ADMISSION: 'No new attempts can start. Candidates already admitted keep every right: saving, resuming and submitting.',
  START: 'Starts the examination. For a synchronized examination the official clock starts now for every candidate.',
  RECONCILE: 'Seals attempts whose database-derived deadline has passed (the same pass the background worker runs). Safe to repeat.',
  INITIATE_SCORING: 'Scores sealed attempts, records absentees and moves the examination to result review. Requires nothing in progress.',
};
const dt = (v?: string | Date | null) => (v ? fmtDT(v) : '—');
const n = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v);

export default function ControlCentre() {
  const { id } = useParams<{ id: string }>(); const { can } = useMe(); const { run } = useAction();
  const view = useGet<any>(`/exams/${id}/control`);
  const [snap, setSnap] = useState<any>(null); const [live, setLive] = useState(false); const [refresh, setRefresh] = useState(0);
  const [dlg, setDlg] = useState<{ kind: Cmd; presetScope?: string } | null>(null); const [selected, setSelected] = useState<Set<string>>(new Set());
  const [campus, setCampus] = useState('');
  const last = useRef(0); const reload = view.reload;

  // Push: authoritative stats arrive over SSE; any control event refreshes the full view. When the stream is down we poll.
  useEffect(() => openStream(`/invigilation/exams/${id}/stream`, {
    status: setLive,
    event: (name, data) => {
      if (name === 'stats') { setSnap(data); if (Date.now() - last.current > 5000) { last.current = Date.now(); setRefresh((r) => r + 1); } }
      else if (name !== 'state') { void reload(); setRefresh((r) => r + 1); }
    },
  }), [id, reload]);
  useEffect(() => { if (live) return; const t = setInterval(() => { void reload(); setRefresh((r) => r + 1); }, 8000); return () => clearInterval(t); }, [live, reload]);

  const toast = useToast(); const [pending, setPending] = useState(false);
  /** Commands propagate refusals to the dialog (shown inline); success refreshes the authoritative view. */
  const command = useCallback(async (cmd: Cmd, body: Record<string, unknown> = {}) => {
    setPending(true);
    try {
      const r = await post(`/exams/${id}/control/${SLUG[cmd]}`, { expectedVersion: view.data?.exam.stateVersion, ...body });
      toast(r.changed === false ? `${LABEL[cmd].replace('…', '')}: no change (${r.note ?? 'already in that state'})` : `${LABEL[cmd].replace('…', '')}: done`);
      setDlg(null); void reload(); setRefresh((x) => x + 1); return r;
    } finally { setPending(false); }
  }, [id, reload, view.data, toast]);
  const busy = pending;

  return (
    <Async state={view}>{(d) => {
      const s = snap && (!d.snapshot || snap.freshness.computedAt >= d.snapshot.freshness.computedAt) ? snap : d.snapshot; const e = d.exam; const t = s.totals;
      const allowed = (c: Cmd) => d.commands.find((x: any) => x.command === c) ?? { allowed: false, reason: '' };
      const openSus = d.suspensions.filter((x: any) => !x.resumedAt);
      return (
        <div className="stack-lg">
          <PageHead title={<>{e.title} <Status s={e.status} /></> as never} sub={<>{e.code} · {e.subject} · {e.program?.code} · {dt(e.opensAt)} → {dt(e.closesAt)} · {e.durationMin} min · <span className="mono">v{e.stateVersion}</span></>}>
            <Link className="btn btn-sm" href={`/exams/${id}`}>Examination record</Link>
          </PageHead>

          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }} data-testid="state-chips">
            <Badge tone={e.timingPolicy === 'SYNCHRONIZED' ? 'amber' : 'grey'}>{e.timingPolicy === 'SYNCHRONIZED' ? 'Synchronized clock' : 'Individual attempt timing'}</Badge>
            <Badge tone="grey">{e.controlMode === 'MANUAL' ? 'Manual control' : 'Automatic by schedule'}</Badge>
            <Badge tone="grey">Paper {e.paper.fingerprint ?? '—'} · {e.paper.questions} Q · approved {dt(e.paper.approvedAt)}</Badge>
            {e.officialStartAt && <Badge tone="green">Started {dt(e.officialStartAt)}</Badge>}
            {e.admissionClosedAt && <Badge tone="red">Admission closed {dt(e.admissionClosedAt)}</Badge>}
            <span className="small muted" data-testid="freshness">{live ? 'Live (push)' : 'Reconnecting — refreshing every 8 s'} · updated {dt(s.freshness.computedAt)}</span>
            {s.freshness.degraded && <Badge tone="amber">Degraded: {s.freshness.reasons.join('; ')}</Badge>}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(140px,100%),1fr))', gap: 12 }} data-testid="stats">
            <Stat k="Allocated" v={t.allocated} /><Stat k="Eligible" v={t.eligible} /><Stat k="Admitted (entered)" v={t.admitted} s={t.eligible ? `${Math.round((t.admitted / t.eligible) * 100)}% of eligible` : undefined} />
            <Stat k="In progress" v={t.inProgress} s={t.suspended ? `${t.suspended} suspended` : undefined} /><Stat k="Online / disconnected" v={`${n(t.online)} / ${n(t.disconnected)}`} s={t.online === null ? 'unknown — heartbeat store unavailable' : undefined} />
            <Stat k="Submitted" v={t.submitted} /><Stat k="Auto-submitted" v={t.autoSubmitted} /><Stat k="Remaining" v={t.remaining} s="eligible, not yet sealed" /><Stat k="Active incidents" v={t.activeIncidents} />
          </div>

          <Card title="Controls" actions={<span className="small muted">Every action is a transaction on the examination record and is audited.</span>}>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              {(['OPEN_ADMISSION', 'CLOSE_ADMISSION', 'START', 'SUSPEND', 'RESUME', 'EXTEND', 'CLOSE', 'RECONCILE', 'INITIATE_SCORING'] as Cmd[]).map((c) => {
                const a = allowed(c); const danger = c === 'SUSPEND' || c === 'CLOSE';
                return <button key={c} className={`btn ${danger && a.allowed ? 'btn-danger' : ''}`} disabled={!can('exam.control') || !a.allowed || busy} title={!can('exam.control') ? 'Requires the examination control permission' : a.allowed ? undefined : a.reason} data-testid={`cmd-${SLUG[c]}`} onClick={() => setDlg({ kind: c })}>{LABEL[c]}</button>;
              })}
              {selected.size > 0 && can('exam.control') && <><span className="small muted">{selected.size} candidate(s) selected:</span>
                <button className="btn btn-sm" disabled={!allowed('EXTEND').allowed} onClick={() => setDlg({ kind: 'EXTEND', presetScope: 'CANDIDATES' })}>Extend selected…</button>
                <button className="btn btn-sm btn-danger" disabled={!allowed('SUSPEND').allowed} onClick={() => setDlg({ kind: 'SUSPEND', presetScope: 'CANDIDATES' })}>Suspend selected…</button></>}
            </div>
            {!can('exam.control') && <p className="small muted" style={{ marginBottom: 0 }}>You can monitor this examination; commands are available to the Controller of Examinations and Super Administrator.</p>}
          </Card>

          <PolicyCard d={d} id={id} can={can} run={run} onDone={reload} />

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(420px,100%),1fr))', gap: 16 }}>
            <Card title="Campuses" flush>
              <Table rowKey={(c: any) => c.institutionId} rows={s.campuses} empty="No participating campuses." cols={[
                { h: 'Campus', cell: (c: any) => <button className="btn-link" onClick={() => setCampus(campus === c.institutionId ? '' : c.institutionId)} aria-pressed={campus === c.institutionId}>{c.code}</button> },
                { h: 'Eligible', num: true, cell: (c: any) => c.eligible }, { h: 'Attendance', num: true, cell: (c: any) => (c.attendancePct === null ? '—' : `${c.attendancePct}%`) },
                { h: 'In progress', num: true, cell: (c: any) => c.inProgress }, { h: 'Disconn.', num: true, cell: (c: any) => n(c.disconnected) },
                { h: 'Submitted', num: true, cell: (c: any) => `${c.submitted + c.autoSubmitted}/${c.eligible}` }, { h: 'Incidents', num: true, cell: (c: any) => c.incidents || '' },
                { h: 'Warning', cell: (c: any) => (c.warning ? <Badge tone="amber">{c.warning}</Badge> : '') },
              ]} />
              <div className="small muted" style={{ padding: '8px 16px' }}>{t.campusesParticipating} participating · {t.campusesActive} active now. Click a campus to filter the candidates below.</div>
            </Card>
            <HealthCard h={d.health} />
          </div>

          <Candidates id={id} campuses={s.campuses} campus={campus} setCampus={setCampus} refresh={refresh} selected={selected} setSelected={setSelected} canSelect={can('exam.control')} />

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(420px,100%),1fr))', gap: 16 }}>
            <Card title="Suspension history" flush><Table rowKey={(x: any) => x.id} rows={d.suspensions} empty="No suspensions." cols={[
              { h: 'Scope', cell: (x: any) => x.scope + (x.institutionId ? ' · campus' : '') }, { h: 'Policy', cell: (x: any) => x.timePolicy.replace('_', ' ').toLowerCase() }, { h: 'Suspended', cell: (x: any) => <>{dt(x.suspendedAt)}<div className="small muted">{x.suspendedByName}: {x.reason}</div></> },
              { h: 'Resumed', cell: (x: any) => (x.resumedAt ? <>{dt(x.resumedAt)}<div className="small muted">{x.resumedByName} · paused {x.pausedSeconds ?? 0}s</div></> : <Badge tone="red">Open</Badge>) }, { h: 'Affected', num: true, cell: (x: any) => x.affectedCount },
            ]} /></Card>
            <Card title="Extension history" flush><Table rowKey={(x: any) => x.id} rows={d.extensions} empty="No extensions." cols={[
              { h: 'When', cell: (x: any) => dt(x.createdAt) }, { h: 'Scope', cell: (x: any) => x.scope }, { h: 'Minutes', num: true, cell: (x: any) => `+${x.minutes}` }, { h: 'Affected', num: true, cell: (x: any) => x.affectedCount },
              { h: 'Approved by', cell: (x: any) => <>{x.approvedByName}<div className="small muted">{x.reason}</div></> },
            ]} /></Card>
          </div>
          <Card title="Recent state events" flush><Table rowKey={(x: any) => String(x.id)} rows={d.recentEvents} empty="No events yet." cols={[
            { h: '#', num: true, cell: (x: any) => x.id }, { h: 'Event', cell: (x: any) => <span className="code">{x.type}</span> }, { h: 'Version', num: true, cell: (x: any) => x.version }, { h: 'Committed', cell: (x: any) => dt(x.at) }, { h: 'Delivery', cell: (x: any) => x.delivery.toLowerCase() },
          ]} /></Card>

          {dlg && <CommandDialog kind={dlg.kind} presetScope={dlg.presetScope} d={d} s={s} selected={selected} busy={busy} onClose={() => setDlg(null)} send={command} openSuspensions={openSus} />}
        </div>
      );
    }}</Async>
  );
}

function PolicyCard({ d, id, can, run, onDone }: any) {
  const e = d.exam; const [sp, setSp] = useState(e.suspendTimePolicy ?? 'FREEZE_CLOCK'); const editable = ['DRAFT', 'PAPER_PENDING', 'APPROVED', 'SCHEDULED'].includes(e.status);
  return (
    <Card title="Timing and suspension policy">
      <div className="small" style={{ lineHeight: 1.7 }}>
        Timing: <b>{e.timingPolicy === 'SYNCHRONIZED' ? 'one official clock for every candidate' : 'each candidate’s own clock from their start'}</b> · Control: <b>{e.controlMode === 'MANUAL' ? 'staff commands' : 'schedule-driven'}</b> ·
        Suspension clock: {e.suspendTimePolicy ? <b data-testid="suspend-policy">{e.suspendTimePolicy === 'FREEZE_CLOCK' ? 'frozen — deadlines move by the paused time' : 'continues — deadlines never change'} (approved by {e.suspendPolicyApprovedBy ?? '—'}, {dt(e.suspendPolicyApprovedAt)})</b> : <Badge tone="amber">Not approved — suspension is unavailable until an authorised approver sets it</Badge>}
      </div>
      {can('exam.control.policy') && editable && <div className="row" style={{ marginTop: 10 }}>
        <select className="in" style={{ maxWidth: 360 }} value={sp} onChange={(x) => setSp(x.target.value)} aria-label="Suspension time policy"><option value="FREEZE_CLOCK">Freeze the clock while suspended</option><option value="CLOCK_CONTINUES">Clock continues while suspended</option></select>
        <button className="btn btn-green btn-sm" onClick={() => run(async () => { await post(`/exams/${id}/control/policy`, { suspendTimePolicy: sp }); await onDone(); }, 'Policy approved')}>Approve this policy</button></div>}
    </Card>
  );
}

function HealthCard({ h }: any) {
  const row = (k: string, v: any, bad = false) => <tr><td className="muted">{k}</td><td className={bad ? 'err-text' : ''}>{v}</td></tr>;
  return (
    <Card title="Operational health" flush>
      <table className="tbl" data-testid="health"><tbody>
        {row('Monitoring updated', dt(h.monitoringUpdatedAt))}
        {row('Lifecycle worker', `${h.lifecycle.status}${h.lifecycle.lastRunAgeSeconds != null ? ` · last run ${Math.round(h.lifecycle.lastRunAgeSeconds)} s ago` : ' · no run recorded'}`, h.lifecycle.status !== 'OK')}
        {row('Expired attempts awaiting seal', `${h.lifecycle.expiredBacklog}${h.lifecycle.poisonedAttempts ? ` · ${h.lifecycle.poisonedAttempts} failing repeatedly` : ''}`, h.lifecycle.expiredBacklog > 0 || h.lifecycle.poisonedAttempts > 0)}
        {row('Event outbox', `${h.outbox.pending} pending${h.outbox.oldestPendingSeconds ? ` (oldest ${Math.round(h.outbox.oldestPendingSeconds)} s)` : ''} · ${h.outbox.failed} failed`, h.outbox.failed > 0)}
        {row(h.redis.backend === 'database' ? 'Coordination store' : 'Redis', h.redis.available ? (h.redis.backend === 'database' ? 'database (no Redis) · available' : h.redis.eventChannel ? 'available' : 'available, event channel connecting') : 'UNAVAILABLE — monitoring degraded, answers unaffected', !h.redis.available)}
        {row('Live connections (this instance)', h.sseSubscribersThisInstance)}
        {row('Answer writes (this API instance)', h.saves.total ? `${h.saves.successRate}% ok of ${h.saves.total} · p95 ≤ ${h.saves.p95Seconds === null ? '—' : Math.round(h.saves.p95Seconds * 1000)} ms` : 'no writes yet')}
        {row('API errors (this API instance)', `${h.apiErrors.http5xx} server errors · ${h.apiErrors.unhandled} unhandled`, h.apiErrors.http5xx > 0)}
      </tbody></table>
      <div className="small muted" style={{ padding: '8px 16px' }}>Counts and states come from the database. Save and error figures are per API process since it started.</div>
    </Card>
  );
}

function Candidates({ id, campuses, campus, setCampus, refresh, selected, setSelected, canSelect }: any) {
  const [page, setPage] = useState(1); const [status, setStatus] = useState(''); const [q, setQ] = useState('');
  const qs = useMemo(() => `page=${page}&pageSize=25${status ? `&status=${status}` : ''}${campus ? `&institutionId=${campus}` : ''}${q ? `&search=${encodeURIComponent(q)}` : ''}`, [page, status, campus, q]);
  const data = useGet<any>(`/invigilation/exams/${id}/candidates?${qs}`); const reload = data.reload;
  useEffect(() => { void reload(); }, [refresh, reload]);
  useEffect(() => { setPage(1); }, [status, campus, q]);
  const toggle = (sid: string) => setSelected((p: Set<string>) => { const x = new Set(p); if (x.has(sid)) x.delete(sid); else x.add(sid); return x; });
  return (
    <Card title="Candidates" flush actions={<span className="small muted">{data.data ? `${data.data.total} match` : ''}</span>}>
      <div className="filters">
        <Field label="Campus"><select className="in" value={campus} onChange={(e) => setCampus(e.target.value)}><option value="">All campuses</option>{campuses.map((c: any) => <option key={c.institutionId} value={c.institutionId}>{c.code}</option>)}</select></Field>
        <Field label="Status"><select className="in" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option>{['NOT_STARTED', 'IN_PROGRESS', 'SUSPENDED', 'SUBMITTED', 'AUTO_SUBMITTED'].map((x) => <option key={x} value={x}>{x.replace('_', ' ').toLowerCase()}</option>)}</select></Field>
        <Field label="Find"><input className="in" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Reg. no. or name" /></Field>
      </div>
      <Async state={data}>{(r) => <>
        <Table rowKey={(x: any) => x.studentId} rows={r.rows} empty="No candidates match." cols={[
          ...(canSelect ? [{ h: '', cell: (x: any) => x.status === 'IN_PROGRESS' ? <input type="checkbox" aria-label={`Select ${x.regNo}`} checked={selected.has(x.studentId)} onChange={() => toggle(x.studentId)} /> : null }] : []),
          { h: 'Reg. no.', cell: (x: any) => <span className="code">{x.regNo}</span> }, { h: 'Name', cell: (x: any) => x.fullName }, { h: 'Campus', cell: (x: any) => x.institution },
          { h: 'Status', cell: (x: any) => <Status s={x.suspended ? 'SUSPENDED' : x.status} /> }, { h: 'Connection', cell: (x: any) => <Status s={x.connection} /> },
          { h: 'Answered', num: true, cell: (x: any) => (x.attemptId ? x.answered : '—') }, { h: 'Last confirmed save', cell: (x: any) => (x.lastConfirmedSaveAt ? dt(x.lastConfirmedSaveAt) : '—') }, { h: 'Deadline', cell: (x: any) => (x.deadlineAt ? dt(x.deadlineAt) : '—') },
        ]} />
        <div className="row between" style={{ padding: '8px 16px' }}><span className="small muted">Page {r.page} of {Math.max(1, Math.ceil(r.total / r.pageSize))}</span>
          <span className="row"><button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><button className="btn btn-sm" disabled={page * r.pageSize >= r.total} onClick={() => setPage(page + 1)}>Next</button></span></div></>}</Async>
    </Card>
  );
}

function CommandDialog({ kind, presetScope, d, s, selected, busy, onClose, send, openSuspensions }: any) {
  const e = d.exam; const [scope, setScope] = useState(presetScope ?? 'EXAM'); const [institutionId, setInst] = useState(s.campuses[0]?.institutionId ?? ''); const [reason, setReason] = useState(''); const [confirm, setConfirm] = useState(false);
  const [minutes, setMinutes] = useState(10); const [force, setForce] = useState(false); const [suspensionId, setSus] = useState(openSuspensions[0]?.id ?? ''); const [prev, setPrev] = useState<any>(null); const [err, setErr] = useState('');
  const key = useRef(`ui-${crypto.randomUUID()}`); const [extendWindow, setExtendWindow] = useState(false);
  const target = useMemo(() => ({ scope, ...(scope === 'CAMPUS' ? { institutionId } : {}), ...(scope === 'CANDIDATES' ? { studentIds: [...selected] } : {}) }), [scope, institutionId, selected]);
  const simple = EXPLAIN[kind as Cmd];
  const fail = (x: unknown) => { setErr(x instanceof ApiError && x.code === 'WINDOW_TOO_SHORT' ? `${x.message}` : errMsg(x)); if (x instanceof ApiError && x.code === 'WINDOW_TOO_SHORT') setExtendWindow(true); };
  const go = async (cmd: Cmd, body: Record<string, unknown>) => { setErr(''); try { await send(cmd, body); } catch (x) { fail(x); } };
  const scopeFields = <>
    <Field label="Scope"><select className="in" value={scope} onChange={(x) => { setScope(x.target.value); setPrev(null); }}><option value="EXAM">{kind === 'EXTEND' ? 'Entire active examination' : 'Entire examination'}</option><option value="CAMPUS">One campus cohort</option><option value="CANDIDATES" disabled={selected.size === 0}>Selected candidates ({selected.size})</option></select></Field>
    {scope === 'CAMPUS' && <Field label="Campus"><select className="in" value={institutionId} onChange={(x) => { setInst(x.target.value); setPrev(null); }}>{s.campuses.map((c: any) => <option key={c.institutionId} value={c.institutionId}>{c.code} — {c.name}</option>)}</select></Field>}
  </>;
  const reasonField = <Field label="Reason (recorded in the audit trail)" hint="At least 10 characters"><textarea className="in" rows={3} value={reason} onChange={(x) => setReason(x.target.value)} /></Field>;
  const ok = (cb: React.ReactNode) => <label className="row" style={{ alignItems: 'flex-start' }}><input type="checkbox" checked={confirm} onChange={(x) => setConfirm(x.target.checked)} data-testid="confirm-box" /> <span>{cb}</span></label>;
  const title = LABEL[kind as Cmd].replace('…', '');
  let body: React.ReactNode; let footer: React.ReactNode;
  const cancel = <CancelButton />;
  if (kind === 'SUSPEND') {
    body = <div className="stack">{scopeFields}{reasonField}
      <div className="notice small">Clock policy: <b>{e.suspendTimePolicy === 'FREEZE_CLOCK' ? 'frozen — each candidate’s deadline moves later by the time paused' : 'continues — deadlines are not changed and may pass during the suspension'}</b>. Affected candidates cannot answer or submit until you resume.</div>
      {ok('I confirm this suspension.')}</div>;
    footer = <>{cancel}<button className="btn btn-danger" disabled={busy || !confirm || reason.trim().length < 10} data-testid="dlg-go" onClick={() => go('SUSPEND', { ...target, reason, confirm })}>Suspend</button></>;
  } else if (kind === 'RESUME') {
    body = <div className="stack">{openSuspensions.length > 1 && <Field label="Which suspension"><select className="in" value={suspensionId} onChange={(x) => setSus(x.target.value)}>{openSuspensions.map((x: any) => <option key={x.id} value={x.id}>{x.scope}{x.institutionId ? ' (campus)' : ''} — {x.reason.slice(0, 50)}</option>)}</select></Field>}
      <Field label="Note (optional)"><input className="in" value={reason} onChange={(x) => setReason(x.target.value)} /></Field>
      <div className="notice small">Candidates resume with every confirmed answer intact. {e.suspendTimePolicy === 'FREEZE_CLOCK' ? 'Deadlines move later by each attempt’s paused time.' : 'Deadlines are unchanged.'} Sealed attempts are never modified.</div>{ok('I confirm resuming.')}</div>;
    footer = <>{cancel}<button className="btn btn-green" disabled={busy || !confirm} data-testid="dlg-go" onClick={() => go('RESUME', { ...(openSuspensions.length > 1 ? { suspensionId } : {}), note: reason || undefined, confirm })}>Resume</button></>;
  } else if (kind === 'EXTEND') {
    const doPreview = async () => { setErr(''); try { setPrev(await post(`/exams/${e.id}/control/extend/preview`, { ...target, minutes })); } catch (x) { fail(x); } };
    body = <div className="stack">{scopeFields}<Field label="Additional minutes (1–240)"><input className="in" type="number" min={1} max={240} value={minutes} onChange={(x) => { setMinutes(Number(x.target.value)); setPrev(null); }} /></Field>{reasonField}
      <button className="btn btn-sm" onClick={doPreview} data-testid="preview">Preview effect</button>
      {prev && <div className="notice" data-testid="preview-result"><b>{prev.affected}</b> attempt(s) in progress affected{prev.ofWhichSuspended ? ` (${prev.ofWhichSuspended} suspended)` : ''}. Earliest deadline {dt(prev.currentEarliestDeadline)} → <b>{dt(prev.newEarliestDeadline)}</b>; latest {dt(prev.currentLatestDeadline)} → <b>{dt(prev.newLatestDeadline)}</b>.{scope === 'EXAM' && <> Window end {dt(prev.windowEnd.current)} → <b>{dt(prev.windowEnd.after)}</b>.</>} Sealed attempts are not reopened.</div>}
      {ok('I approve this extension and have reviewed the effect above.')}</div>;
    footer = <>{cancel}<button className="btn btn-green" disabled={busy || !confirm || !prev || reason.trim().length < 10} data-testid="dlg-go" onClick={() => go('EXTEND', { ...target, minutes, reason, confirm, idempotencyKey: key.current })}>Apply extension</button></>;
  } else if (kind === 'CLOSE') {
    body = <div className="stack"><p style={{ margin: 0 }}>Admission closes. Candidates still working finish at their own deadlines, then the examination becomes <b>Closed</b>.</p>
      <label className="row"><input type="checkbox" checked={force} onChange={(x) => setForce(x.target.checked)} data-testid="force-box" /> Seal all attempts now: end every remaining attempt immediately ({s.totals.inProgress + s.totals.suspended} in progress)</label>
      {force && reasonField}</div>;
    footer = <>{cancel}<button className="btn btn-danger" disabled={busy || (force && reason.trim().length < 10)} data-testid="dlg-go" onClick={() => go('CLOSE', { force, reason: force ? reason : undefined })}>{force ? 'Seal all attempts and end examination' : 'End examination'}</button></>;
  } else if (kind === 'START') {
    body = <div className="stack"><p style={{ margin: 0 }}>{simple}</p>{err && extendWindow && <label className="row"><input type="checkbox" checked={confirm} onChange={(x) => setConfirm(x.target.checked)} /> Extend the examination window to fit the full duration</label>}</div>;
    footer = <>{cancel}<button className="btn btn-green" disabled={busy || (extendWindow && !confirm)} data-testid="dlg-go" onClick={() => go('START', extendWindow ? { extendWindow: true } : {})}>Start examination</button></>;
  } else {
    body = <p style={{ margin: 0 }}>{simple}</p>;
    footer = <>{cancel}<button className="btn btn-green" disabled={busy} data-testid="dlg-go" onClick={() => go(kind as Cmd, {})}>{title}</button></>;
  }
  return <Modal title={title} onClose={onClose} footer={footer}>{body}{err && <div className="notice bad" role="alert" style={{ marginTop: 12 }}>{err}</div>}</Modal>;
}
