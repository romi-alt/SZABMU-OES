'use client';
import { useState } from 'react';
import { del, fmtDate, post, useGet } from '@/api';
import { Async, Confirm, Field, Modal, Notice, PageHead, Table, useAction, CancelButton } from '@/ui';

/** Lecturer ↔ course assignments. A lecturer can author or manage questions only for courses listed here. */
export default function Assignments() {
  const { run, busy } = useAction();
  const list = useGet<any[]>('/course-assignments'); const insts = useGet<any[]>('/institutions'); const programs = useGet<any[]>('/programs');
  const [add, setAdd] = useState(false); const [inst, setInst] = useState(''); const [userId, setUserId] = useState(''); const [courseId, setCourseId] = useState(''); const [revoke, setRevoke] = useState<any>(null);
  const lecturers = useGet<any>(inst ? `/users?role=LECTURER&institutionId=${inst}&pageSize=100` : null);
  const courses = (programs.data ?? []).flatMap((p: any) => p.courses.map((c: any) => ({ ...c, program: p.code })));
  return (
    <>
      <PageHead title="Lecturer course assignments" sub="A lecturer can author and manage questions, build papers and review grading only for courses assigned here.">
        <button className="btn btn-primary" onClick={() => { setAdd(true); setInst(insts.data?.[0]?.id ?? ''); setUserId(''); setCourseId(''); }}>+ Assign lecturer</button>
      </PageHead>
      <Async state={list}>{(rows: any[]) => <Table rowKey={(r: any) => r.id} empty="No lecturers are assigned to any course yet. Lecturers cannot author questions until assigned." rows={rows} cols={[
        { h: 'Lecturer', cell: (r: any) => <>{r.user.fullName}<div className="small faint">{r.user.email}</div></> },
        { h: 'Course', cell: (r: any) => <><span className="code">{r.course.code}</span> {r.course.title}</> },
        { h: 'Campus', cell: (r: any) => r.institution.code }, { h: 'Assigned', cell: (r: any) => fmtDate(r.createdAt) },
        { h: '', cell: (r: any) => <button className="btn btn-sm" onClick={() => setRevoke(r)}>Revoke</button> },
      ]} />}</Async>
      {add && (
        <Modal title="Assign lecturer to course" onClose={() => setAdd(false)} missing={[!userId && 'Lecturer', !courseId && 'Course'].filter(Boolean) as string[]} footer={<><CancelButton />
          <button className="btn btn-primary" disabled={busy || !userId || !courseId} onClick={() => run(async () => { await post('/course-assignments', { userId, courseId, institutionId: inst }); setAdd(false); list.reload(); }, 'Assignment saved')}>Assign</button></>}>
          <div className="stack">
            <Field label="Campus"><select className="in" value={inst} onChange={(e) => { setInst(e.target.value); setUserId(''); }}>{(insts.data ?? []).map((i: any) => <option key={i.id} value={i.id}>{i.code} — {i.name}</option>)}</select></Field>
            <Field label="Lecturer" required><select className="in" value={userId} onChange={(e) => setUserId(e.target.value)}><option value="">Select…</option>{(lecturers.data?.items ?? []).map((u: any) => <option key={u.id} value={u.id}>{u.fullName}</option>)}</select></Field>
            <Field label="Course" required><select className="in" value={courseId} onChange={(e) => setCourseId(e.target.value)}><option value="">Select…</option>{courses.map((c: any) => <option key={c.id} value={c.id}>{c.code} — {c.title} ({c.program})</option>)}</select></Field>
            <Notice>The lecturer immediately gains access to this course's question bank at the selected campus.</Notice>
          </div>
        </Modal>
      )}
      {revoke && <Confirm title="Revoke assignment" yes="Revoke" danger onNo={() => setRevoke(null)} onYes={() => run(async () => { await del(`/course-assignments/${revoke.id}`); setRevoke(null); list.reload(); }, 'Assignment revoked')} body={<>Revoke <b>{revoke.user.fullName}</b>'s access to <b>{revoke.course.code}</b>? They will immediately lose access to that course's questions, including ones they wrote.</>} />}
    </>
  );
}
