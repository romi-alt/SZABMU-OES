'use client';
import { useState } from 'react';
import { post, useGet } from '@/api';
import { useMe } from '@/session';
import { Async, Card, Field, Modal, Notice, PageHead, Table, useAction, CancelButton } from '@/ui';
import { parseCsv } from '@/csv';

export default function Programs() {
  const { can } = useMe(); const { run, busy } = useAction(); const st = useGet<any[]>('/programs'); const [modal, setModal] = useState<'p' | { id: string } | null>(null); const [bulk, setBulk] = useState<{ id: string; code: string; name: string } | null>(null);
  const [p, setP] = useState({ code: '', name: '', durationYrs: 5 }); const [c, setC] = useState({ code: '', title: '', semester: 1, credits: 3 });
  return (
    <>
      <PageHead title="Programs & courses" sub="University-level academic programs and their subjects by semester.">{can('program.manage') && <button className="btn btn-green" onClick={() => { setP({ code: '', name: '', durationYrs: 5 }); setModal('p'); }}>+ Program</button>}</PageHead>
      <Async state={st}>{(rows: any[]) => <div className="stack-lg">{rows.map((r) => <Card key={r.id} title={<><span className="code">{r.code}</span> {r.name}</>} actions={can('program.manage') && <><button className="btn btn-sm" onClick={() => setBulk({ id: r.id, code: r.code, name: r.name })} aria-label={`Add subjects in bulk to ${r.code}`}>Add subjects in bulk</button> <button className="btn btn-sm" onClick={() => { setC({ code: '', title: '', semester: 1, credits: 3 }); setModal({ id: r.id }); }}>+ Course</button></>} flush>
        <Table rowKey={(x: any) => x.id} rows={r.courses} empty="No courses yet." cols={[{ h: 'Code', cell: (x: any) => <span className="code">{x.code}</span> }, { h: 'Title', cell: (x: any) => x.title }, { h: 'Semester', num: true, cell: (x: any) => x.semester }, { h: 'Credits', num: true, cell: (x: any) => (x.credits ? x.credits : '—') }]} /></Card>)}</div>}</Async>
      {modal === 'p' && <Modal title="New program" onClose={() => setModal(null)} missing={[!p.code && 'Code', !p.name && 'Name'].filter(Boolean) as string[]} footer={<button className="btn btn-green" disabled={busy || !p.code || !p.name} onClick={() => run(async () => { await post('/programs', p); setModal(null); st.reload(); }, 'Program created')}>Create</button>}><div className="stack"><Field label="Code" required><input className="in mono" value={p.code} onChange={(e) => setP({ ...p, code: e.target.value.toUpperCase() })} /></Field><Field label="Name" required><input className="in" value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} /></Field><Field label="Duration (years)"><input className="in" type="number" min={1} max={8} value={p.durationYrs} onChange={(e) => setP({ ...p, durationYrs: +e.target.value })} /></Field></div></Modal>}
      {modal && typeof modal === 'object' && <Modal title="New course" onClose={() => setModal(null)} missing={[!c.code && 'Code', !c.title && 'Title'].filter(Boolean) as string[]} footer={<button className="btn btn-green" disabled={busy || !c.code || !c.title} onClick={() => run(async () => { await post(`/programs/${modal.id}/courses`, c); setModal(null); st.reload(); }, 'Course created')}>Create</button>}><div className="stack"><Field label="Code" required><input className="in mono" value={c.code} onChange={(e) => setC({ ...c, code: e.target.value.toUpperCase() })} /></Field><Field label="Title" required><input className="in" value={c.title} onChange={(e) => setC({ ...c, title: e.target.value })} /></Field><div className="grid g2"><Field label="Semester"><input className="in" type="number" min={1} max={12} value={c.semester} onChange={(e) => setC({ ...c, semester: +e.target.value })} /></Field><Field label="Credits"><input className="in" type="number" min={0} max={30} value={c.credits} onChange={(e) => setC({ ...c, credits: +e.target.value })} /></Field></div></div></Modal>}
      {bulk && <BulkSubjects program={bulk} onClose={() => setBulk(null)} onDone={() => { setBulk(null); st.reload(); }} />}
    </>
  );
}

interface Plan { semester: number; title: string; code: string; credits: number }
interface Preview { dryRun: boolean; created: number; wouldCreate: number; skipped: { row: number; title: string; reason: string }[]; preview: Plan[] }
const REASON: Record<string, string> = { ALREADY_EXISTS: 'already exists for that semester', REPEATED_IN_LIST: 'repeated in your list', CODE_TAKEN: 'that code is used by another subject' };

/** Turns pasted text (comma-separated, or tab-separated from a spreadsheet) into rows: semester, title, optional code, optional credits. Problems are reported by line, never guessed. */
function parseRows(raw: string) {
  const text = raw.includes('\t') ? raw.split('\n').map((l) => l.split('\t').map((c) => (/[",]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n') : raw;
  const table = parseCsv(text); const rows: { semester: number; title: string; code?: string; credits?: number }[] = []; const problems: string[] = [];
  table.forEach((cells, i) => {
    const [sem = '', title = '', code = '', credits = ''] = cells.map((c) => c.trim()); const line = i + 1;
    if (i === 0 && !/^\d+$/.test(sem) && /sem/i.test(sem)) return;                                    // a header row
    if (!/^\d+$/.test(sem) || Number(sem) < 1 || Number(sem) > 12) { problems.push(`Line ${line}: the semester must be a number from 1 to 12.`); return; }
    if (title.length < 2) { problems.push(`Line ${line}: the subject title is missing.`); return; }
    if (credits && !/^\d+$/.test(credits)) { problems.push(`Line ${line}: credits must be a whole number or left empty.`); return; }
    rows.push({ semester: Number(sem), title, ...(code ? { code } : {}), ...(credits ? { credits: Number(credits) } : {}) });
  });
  if (rows.length > 200) problems.push('At most 200 subjects at a time. Split the list.');
  return { rows, problems };
}

function BulkSubjects({ program, onClose, onDone }: { program: { id: string; code: string; name: string }; onClose: () => void; onDone: () => void }) {
  const { run, busy } = useAction(); const [text, setText] = useState(''); const [pv, setPv] = useState<{ text: string; data: Preview } | null>(null);
  const parsed = parseRows(text); const fresh = pv && pv.text === text ? pv.data : null; const canAdd = !!fresh && fresh.wouldCreate > 0 && parsed.problems.length === 0;
  return (
    <Modal title={`Add subjects — ${program.code}`} onClose={onClose} footer={<><CancelButton />
      <button className="btn" disabled={busy || !parsed.rows.length || parsed.problems.length > 0} onClick={() => run(async () => { setPv({ text, data: await post<Preview>(`/programs/${program.id}/courses/bulk`, { rows: parsed.rows, dryRun: true }) }); })}>Preview</button>
      <button className="btn btn-green" disabled={busy || !canAdd} onClick={() => run(async () => { await post(`/programs/${program.id}/courses/bulk`, { rows: parsed.rows, dryRun: false }); onDone(); }, 'Subjects added')}>{canAdd ? `Add ${fresh!.wouldCreate} subjects` : 'Add subjects'}</button></>}>
      <div className="stack">
        <p className="small" style={{ margin: 0 }}>For <b>{program.name}</b>. Paste one subject per line from the official curriculum: <span className="code">semester, title, code, credits</span> (code and credits are optional). Quote a title that contains a comma. Spreadsheet paste works too.</p>
        <Field label="Subjects" hint="Example: 1,Human Anatomy,ANAT-101,4"><textarea className="in" rows={9} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} style={{ fontFamily: 'monospace' }} /></Field>
        {parsed.problems.length > 0 && <Notice tone="bad"><div data-testid="bulk-problems">{parsed.problems.map((x) => <div key={x}>{x}</div>)}</div></Notice>}
        {fresh && <div data-testid="bulk-preview">
          <Table rowKey={(r: Plan) => `${r.semester}|${r.title}`} rows={fresh.preview} empty="Nothing new to add." cols={[{ h: 'Semester', num: true, cell: (r: Plan) => r.semester }, { h: 'Subject', cell: (r: Plan) => r.title }, { h: 'Code', cell: (r: Plan) => <span className="code">{r.code}</span> }, { h: 'Credits', num: true, cell: (r: Plan) => (r.credits ? r.credits : 'not recorded') }]} />
          {fresh.skipped.length > 0 && <Notice tone="warn"><b>{fresh.skipped.length} skipped:</b> {fresh.skipped.map((x) => `line ${x.row} “${x.title}” (${REASON[x.reason] ?? x.reason})`).join('; ')}</Notice>}
          <p className="small faint" style={{ margin: '8px 0 0' }}>A subject without a code gets an <b>internal reference</b> (programme, semester, number). It is not an official subject code; edit it later if the curriculum gives one. Credits left empty are stored as “not recorded”.</p></div>}
      </div>
    </Modal>);
}
