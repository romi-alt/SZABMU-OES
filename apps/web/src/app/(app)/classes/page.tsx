'use client';
import { useGet } from '@/api';
import { Async, Badge, PageHead, Table } from '@/ui';

const TONE: Record<string, string> = { PENDING: 'amber', APPROVED: 'green', REJECTED: 'red' };

export default function MyClasses() {
  const st = useGet<any[]>('/teacher/assignments');
  return (
    <>
      <PageHead title="My Classes & Subjects" sub="Assigned by the university. To change an approved assignment, ask your campus administrator." />
      <Async state={st}>{(rows) => {
        const approved = rows.filter((r) => r.status === 'APPROVED'); const other = rows.filter((r) => r.status !== 'APPROVED');
        return (
          <div className="stack-lg">
            <section aria-label="Approved assignments">
              {approved.length ? (
                <div data-testid="approved-assignments"><Table rowKey={(r: any) => r.id} rows={approved} cols={[
                  { h: 'Subject', cell: (r: any) => <><b>{r.course.title}</b><div className="small faint">{r.course.code}</div></> }, { h: 'Institution', cell: (r: any) => r.institution.name }, { h: 'Programme', cell: (r: any) => r.program.code },
                  { h: 'Semester', num: true, cell: (r: any) => r.semester }, { h: 'Session', cell: (r: any) => r.term }, { h: 'Students', num: true, cell: (r: any) => r.studentCount },
                ]} /></div>
              ) : <p className="muted">You have no approved class or subject yet.</p>}
            </section>
            {other.length > 0 && (
              <section aria-label="Requests awaiting a decision">
                <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>Requests</h2>
                <table className="tbl"><thead><tr><th scope="col">Subject</th><th scope="col">Class</th><th scope="col">Session</th><th scope="col">Status</th></tr></thead>
                  <tbody>{other.map((r) => <tr key={r.id}><td><b>{r.course.title}</b><div className="small faint">{r.course.code}</div></td><td>{r.institution.code} · {r.program.code} · Semester {r.semester}</td><td>{r.term}</td>
                    <td><Badge tone={TONE[r.status] ?? 'grey'}>{r.status.toLowerCase()}</Badge>{r.decisionNote && <div className="small faint">{r.decisionNote}</div>}</td></tr>)}</tbody></table>
              </section>)}
          </div>);
      }}</Async>
    </>
  );
}
