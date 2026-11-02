'use client';
import { useGet } from '@/api';
import { useMe } from '@/session';
import { Async, Badge, Notice } from '@/ui';

const COPY = {
  PENDING: { title: 'Your registration is awaiting approval', body: 'An administrator is reviewing your identity and the classes and subjects you requested. You will be notified here when a decision is made. Until then you cannot use the teacher workspace.' },
  REJECTED: { title: 'Your registration was not approved', body: 'You cannot use the teacher workspace. If you think this is a mistake, contact your campus administrator or the examination office.' },
  SUSPENDED: { title: 'Your teacher access is suspended', body: 'You cannot use the teacher workspace until an administrator restores your access. Contact your campus administrator.' },
} as const;
const TONE: Record<string, string> = { PENDING: 'amber', APPROVED: 'green', REJECTED: 'red', REVOKED: 'grey' };

/** Shown instead of the workspace while a teacher's registration is not APPROVED. Read-only: it lists what was requested and nothing else. */
export function TeacherApproval() {
  const { me, refresh } = useMe(); const st = useGet<any>('/teacher/status');
  const status = (me?.teacher?.status ?? 'PENDING') as keyof typeof COPY; const c = COPY[status] ?? COPY.PENDING;
  return (
    <div className="stack-lg" data-testid="teacher-approval" style={{ maxWidth: 760 }}>
      <div>
        <h1 style={{ margin: '0 0 6px', fontSize: 24 }}>{c.title}</h1>
        <p className="muted" style={{ margin: 0 }}>{c.body}</p>
      </div>
      {me?.teacher?.reviewNote && status !== 'PENDING' && <Notice tone="warn"><b>Reason given:</b> {me.teacher.reviewNote}</Notice>}
      <Async state={st}>{(d) => (
        <section aria-label="Requested classes and subjects">
          <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>What you requested</h2>
          <table className="tbl"><thead><tr><th scope="col">Subject</th><th scope="col">Class</th><th scope="col">Session</th><th scope="col">Status</th></tr></thead>
            <tbody>{d.requested.map((r: any) => (
              <tr key={r.id}><td><b>{r.course.title}</b><div className="small faint">{r.course.code}</div></td><td>{r.institution} · {r.program} · Semester {r.semester}</td><td>{r.term}</td>
                <td><Badge tone={TONE[r.status] ?? 'grey'}>{r.status.toLowerCase()}</Badge>{r.decisionNote && <div className="small faint">{r.decisionNote}</div>}</td></tr>))}</tbody></table>
          <p className="small faint" style={{ marginTop: 8 }}>Each class and subject is approved separately. Only approved ones give access.</p>
        </section>)}
      </Async>
      <div><button className="btn" onClick={() => void refresh()}>Check again</button></div>
    </div>
  );
}
