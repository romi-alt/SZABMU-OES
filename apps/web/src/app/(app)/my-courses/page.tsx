'use client';
import Link from 'next/link';
import { useGet } from '@/api';
import { Async, Card, PageHead, Table } from '@/ui';

interface Assigned { id: string; course: { id: string; code: string; title: string; semester: number; program?: { code: string } }; institution: { code: string } }

/** UI-035: the courses a lecturer is assigned to, with a way into the question bank for each. Assignments are made by the campus administrator. */
export default function MyCourses() {
  const st = useGet<Assigned[]>('/me/course-assignments');
  return (
    <>
      <PageHead title="My courses" sub="The courses you are assigned to. To change an assignment, ask your campus administrator." />
      <Card flush><div data-testid="my-courses"><Async state={st}>{(rows) => (
        <Table rowKey={(r: Assigned) => r.id} rows={rows} empty="You have no course assignments yet. Your campus administrator assigns courses to lecturers." cols={[
          { h: 'Course', cell: (r: Assigned) => <><b>{r.course.title}</b><div className="small faint">{r.course.code}</div></> },
          { h: 'Programme', cell: (r: Assigned) => r.course.program?.code ?? '—' }, { h: 'Semester', num: true, cell: (r: Assigned) => r.course.semester }, { h: 'Campus', more: true, cell: (r: Assigned) => r.institution.code },
          { h: '', cell: (r: Assigned) => <Link href={`/questions?courseId=${r.course.id}`} aria-label={`Open question bank for ${r.course.title}`}>Open question bank ›</Link> }]} />)}</Async></div></Card>
    </>
  );
}
