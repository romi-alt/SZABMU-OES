'use client';
import { useState } from 'react';
import { post, useGet } from '@/api';
import { useMe } from '@/session';
import { Async, Card, Field, Modal, PageHead, Table, useAction } from '@/ui';

export default function Programs() {
  const { can } = useMe(); const { run, busy } = useAction(); const st = useGet<any[]>('/programs'); const [modal, setModal] = useState<'p' | { id: string } | null>(null);
  const [p, setP] = useState({ code: '', name: '', durationYrs: 5 }); const [c, setC] = useState({ code: '', title: '', semester: 1, credits: 3 });
  return (
    <>
      <PageHead title="Programs & courses" sub="University-level academic programs and their subjects by semester.">{can('program.manage') && <button className="btn btn-green" onClick={() => setModal('p')}>+ Program</button>}</PageHead>
      <Async state={st}>{(rows: any[]) => <div className="stack-lg">{rows.map((r) => <Card key={r.id} title={<><span className="code">{r.code}</span> {r.name}</>} actions={can('program.manage') && <button className="btn btn-sm" onClick={() => setModal({ id: r.id })}>+ Course</button>} flush>
        <Table rowKey={(x: any) => x.id} rows={r.courses} empty="No courses yet." cols={[{ h: 'Code', cell: (x: any) => <span className="code">{x.code}</span> }, { h: 'Title', cell: (x: any) => x.title }, { h: 'Semester', num: true, cell: (x: any) => x.semester }, { h: 'Credits', num: true, cell: (x: any) => x.credits }]} /></Card>)}</div>}</Async>
      {modal === 'p' && <Modal title="New program" onClose={() => setModal(null)} footer={<button className="btn btn-green" disabled={busy || !p.code || !p.name} onClick={() => run(async () => { await post('/programs', p); setModal(null); st.reload(); }, 'Program created')}>Create</button>}><div className="stack"><Field label="Code"><input className="in mono" value={p.code} onChange={(e) => setP({ ...p, code: e.target.value.toUpperCase() })} /></Field><Field label="Name"><input className="in" value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} /></Field><Field label="Duration (years)"><input className="in" type="number" min={1} max={8} value={p.durationYrs} onChange={(e) => setP({ ...p, durationYrs: +e.target.value })} /></Field></div></Modal>}
      {modal && typeof modal === 'object' && <Modal title="New course" onClose={() => setModal(null)} footer={<button className="btn btn-green" disabled={busy || !c.code || !c.title} onClick={() => run(async () => { await post(`/programs/${modal.id}/courses`, c); setModal(null); st.reload(); }, 'Course created')}>Create</button>}><div className="stack"><Field label="Code"><input className="in mono" value={c.code} onChange={(e) => setC({ ...c, code: e.target.value.toUpperCase() })} /></Field><Field label="Title"><input className="in" value={c.title} onChange={(e) => setC({ ...c, title: e.target.value })} /></Field><div className="grid g2"><Field label="Semester"><input className="in" type="number" min={1} max={12} value={c.semester} onChange={(e) => setC({ ...c, semester: +e.target.value })} /></Field><Field label="Credits"><input className="in" type="number" min={0} max={30} value={c.credits} onChange={(e) => setC({ ...c, credits: +e.target.value })} /></Field></div></div></Modal>}
    </>
  );
}
