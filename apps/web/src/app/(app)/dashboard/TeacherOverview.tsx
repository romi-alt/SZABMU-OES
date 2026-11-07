'use client';
import Link from 'next/link';
import { fmtDT, useGet } from '@/api';
import { Async, PageHead } from '@/ui';

/** Teacher overview: every figure is computed by the API from the caller's own APPROVED assignments and question banks. */
export function TeacherOverview({ first }: { first: string }) {
  const ov = useGet<any>('/teacher/overview'); const as = useGet<any[]>('/teacher/assignments');
  return (
    <>
      <PageHead title={`Welcome, ${first}`} sub="Your approved classes, subjects and question banks." />
      <Async state={ov}>{(d) => (
        <>
          <dl className="kpis" data-testid="teacher-kpis" aria-label="Summary">
            {([['Assigned classes', d.classes, '/classes'], ['Approved subjects', d.subjects, '/classes'], ['Total MCQs', d.mcqs, '/pools'], ['Draft questions', d.questions.draft, '/pools'],
              ['Banks under review', d.banks.submitted, '/submissions?status=SUBMITTED'], ['Approved banks', d.banks.approved, '/pools'], ['Returned banks', d.banks.rejected, '/submissions?status=REJECTED'], ['Students', d.students, '/my-students']] as [string, number, string][]).map(([k, v, href]) => (
              <div key={k}><dt>{k}</dt><dd><Link href={href}>{v}</Link></dd></div>))}
          </dl>
          <section className="plain-section" aria-label="Recent question-bank activity">
            <div className="section-head"><h2>Recent question-bank activity</h2><Link className="btn btn-sm" href="/submissions">Question Submissions</Link></div>
            {d.recent.length ? <ul className="activity" data-testid="teacher-recent">{d.recent.map((r: any, i: number) => (
              <li key={`${r.kind}-${r.bank.id}-${r.decision ?? ''}-${i}`}><span className="act-dot" aria-hidden /><div className="act-b">
                <b><Link href={`/pools?pool=${r.bank.id}`}>{r.bank.name}</Link></b>
                <div className="small muted">{r.kind === 'CREATED' ? 'Question bank created' : r.kind === 'SUBMITTED' ? `${r.count} question${r.count === 1 ? '' : 's'} sent for review` : `${r.count} question${r.count === 1 ? '' : 's'} ${r.decision === 'APPROVED' ? 'approved' : 'returned for changes'}`}</div>
                <div className="small faint">{fmtDT(r.at)}</div></div></li>))}</ul>
              : <p className="muted" data-testid="teacher-recent-empty">No question-bank activity yet. Create a question bank to get started.</p>}
          </section>
        </>)}
      </Async>
      <section className="plain-section" aria-label="Approved classes and subjects">
        <div className="section-head"><h2>My classes &amp; subjects</h2><Link className="btn btn-sm" href="/classes">View all</Link></div>
        <Async state={as}>{(rows) => {
          const approved = rows.filter((r) => r.status === 'APPROVED');
          return approved.length ? <table className="tbl"><thead><tr><th scope="col">Subject</th><th scope="col">Class</th><th scope="col">Session</th></tr></thead>
            <tbody>{approved.slice(0, 6).map((r) => <tr key={r.id}><td><b>{r.course.title}</b><div className="small faint">{r.course.code}</div></td><td>{r.institution.code} · {r.program.code} · Semester {r.semester}</td><td>{r.term}</td></tr>)}</tbody></table>
            : <p className="muted">No approved class or subject yet. Requests you made are shown under My Classes &amp; Subjects.</p>;
        }}</Async>
      </section>
    </>
  );
}
