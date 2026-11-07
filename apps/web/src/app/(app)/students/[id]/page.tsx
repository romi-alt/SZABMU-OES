'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { fmtDate, fmtDT, useGet } from '@/api';
import { Async, Badge, Card, PageHead, Status, Table } from '@/ui';

const words = (v?: string | null) => (v ? v.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : '—');
const ELIG_TONE: Record<string, string> = { ELIGIBLE: 'green', CONDONED: 'amber', NOT_ELIGIBLE: 'red' };

/** UI-034: a read-only student record: who the student is, where they are placed, what they are enrolled in and how each exam admission was decided. No marks. */
export default function StudentRecord() {
  const { id } = useParams<{ id: string }>(); const st = useGet<any>(`/students/${id}`);
  return (
    <>
      <p style={{ margin: '0 0 8px' }}><Link href="/students" className="btn-link">← Students</Link></p>
      <Async state={st}>{(s) => (
        <div className="stack-lg" data-testid="student-record">
          <PageHead title={s.fullName} sub={<><span className="code">{s.regNo}</span> · {s.program.name} · Semester {s.semester}</>} />
          <Card title="Placement and account">
            <dl className="kv" style={{ margin: 0, padding: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 14 }}>
              <div><dt className="small faint">Institution</dt><dd style={{ margin: 0 }}>{s.institution.name}<div className="small faint">{s.institution.code}</div></dd></div>
              <div><dt className="small faint">Programme</dt><dd style={{ margin: 0 }}>{s.program.name}<div className="small faint">{s.program.code}</div></dd></div>
              <div><dt className="small faint">Semester · admission year</dt><dd style={{ margin: 0 }}>Semester {s.semester} · {s.batchYear}</dd></div>
              <div><dt className="small faint">Shift</dt><dd style={{ margin: 0 }}>{s.shift ? words(s.shift) : 'Not split into shifts'}</dd></div>
              <div><dt className="small faint">Placement</dt><dd style={{ margin: 0 }}>{s.verification === 'VERIFIED' ? <Badge tone="green">Verified by the campus</Badge> : <Badge tone="amber">Chosen by the student, awaiting verification</Badge>}</dd></div>
              <div><dt className="small faint">Account</dt><dd style={{ margin: 0 }}>{s.accountActive ? <Badge tone="green">Active</Badge> : <Badge tone="red">Inactive</Badge>} <span className="small faint">{s.email}</span></dd></div>
              <div><dt className="small faint">Profile</dt><dd style={{ margin: 0 }}>{s.profileCompletedAt ? `Completed ${fmtDate(s.profileCompletedAt)}` : 'Not completed by the student'}</dd></div>
            </dl>
          </Card>
          <Card title={`Enrolments (${s.enrolments.length})`} flush>
            <Table rowKey={(e: any) => e.id} rows={s.enrolments} empty="This student has no course enrolments." cols={[
              { h: 'Course', cell: (e: any) => <><b>{e.course.title}</b><div className="small faint">{e.course.code}</div></> }, { h: 'Session', cell: (e: any) => e.term },
              { h: 'Attendance', num: true, cell: (e: any) => (e.attendancePct == null ? '—' : `${e.attendancePct}%`) },
              { h: 'Eligibility', cell: (e: any) => <Badge tone={ELIG_TONE[e.eligibility] ?? 'grey'}>{words(e.eligibility)}</Badge> }, { h: 'Note', more: true, cell: (e: any) => e.note ?? '—' }]} />
          </Card>
          <Card title={`Examinations (${s.exams.length})`} flush>
            <Table rowKey={(c: any) => c.id} rows={s.exams} empty="This student is not on any examination roster." cols={[
              { h: 'Examination', cell: (c: any) => <><b>{c.exam.title}</b><div className="small faint">{c.exam.code}</div></> }, { h: 'Opens', cell: (c: any) => fmtDT(c.exam.opensAt) },
              { h: 'Exam status', cell: (c: any) => <Status s={c.exam.status} /> }, { h: 'Admission', cell: (c: any) => words(c.admission) }, { h: 'Reason', more: true, cell: (c: any) => c.reason ?? '—' }]} />
          </Card>
          <p className="small faint" style={{ margin: 0 }}>This record is read-only and does not show marks or answers. Changes are made from the Students list and Enrolment pages.</p>
        </div>)}</Async>
    </>
  );
}
