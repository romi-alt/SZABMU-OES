'use client';
import Link from 'next/link';
import { useGet } from '@/api';
import { Async, PageHead } from '@/ui';

/** Teacher overview: four numbers, all computed by the API from the caller's APPROVED assignments, and the assignments themselves. */
export function TeacherOverview({ first }: { first: string }) {
  const ov = useGet<any>('/teacher/overview'); const as = useGet<any[]>('/teacher/assignments');
  return (
    <>
      <PageHead title={`Welcome, ${first}`} sub="Your approved classes, subjects and question pools." />
      <Async state={ov}>{(d) => (
        <dl className="kpis" data-testid="teacher-kpis" aria-label="Summary">
          {[['Assigned classes', d.classes, '/classes'], ['Assigned subjects', d.subjects, '/classes'], ['MCQs', d.mcqs, '/pools'], ['Students', d.students, '/my-students']].map(([k, v, href]) => (
            <div key={k as string}><dt>{k}</dt><dd><Link href={href as string}>{v}</Link></dd></div>))}
        </dl>)}
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
