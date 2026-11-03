'use client';
import { useGet } from '@/api';
import { useUrlState } from '@/url-state';
import { Async, Field, ListEmpty, PageHead, Pager, Table } from '@/ui';

/** Names only. The API returns nothing else for a teacher, so nothing else can be shown. */
export default function MyStudents() {
  const url = useUrlState({ page: '1', search: '', assignment: '' }); const page = Number(url.vals.page) || 1; const { search, assignment } = url.vals;
  const as = useGet<any[]>('/teacher/assignments');
  const st = useGet<any>(`/teacher/students?page=${page}&pageSize=50${search ? `&search=${encodeURIComponent(search)}` : ''}${assignment ? `&assignmentId=${assignment}` : ''}`);
  const approved = (as.data ?? []).filter((a) => a.status === 'APPROVED');
  return (
    <>
      <PageHead title="Students" sub="Names of students enrolled in your approved classes and subjects." />
      <div className="filters" style={{ marginBottom: 12 }}>
        <Field label="Search"><input className="in" type="search" value={search} onChange={(e) => { url.set('search', e.target.value); url.set('page', '1'); }} placeholder="Student name" /></Field>
        {approved.length > 1 && <Field label="Class and subject"><select className="in" value={assignment} onChange={(e) => { url.set('assignment', e.target.value); url.set('page', '1'); }}><option value="">All my classes</option>{approved.map((a) => <option key={a.id} value={a.id}>{a.course.code} · {a.institution.code} · {a.term}</option>)}</select></Field>}
      </div>
      <Async state={st}>{(d) => d.items.length ? (
        <>
          <div data-testid="student-names"><Table rowKey={(r: any) => r.name} rows={d.items} cols={[{ h: 'Student name', cell: (r: any) => r.name }]} /></div>
          <Pager page={page} total={d.total} size={50} onPage={(n) => url.set('page', String(n))} />
        </>) : <ListEmpty noun="students" filters={[search && `“${search}”`, assignment && 'this class and subject'].filter(Boolean) as string[]} onClear={url.reset} />}
      </Async>
    </>
  );
}
