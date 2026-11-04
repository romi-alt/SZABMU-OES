'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { describeExam, type ExamPresentation, type ExamStatusInput } from '@oes/shared';
import { fmtDT } from '@/api';
import { Badge } from '@/ui';

/** A /me/exams row as delivered by the API. */
export type MyExam = ExamStatusInput & { examId: string; code: string; title: string; course: { title: string; semester: number; program?: { code: string } }; totalMarks?: number; durationMin: number; questionCount: number };
export const presentExam = (r: MyExam, offsetMs = 0): ExamPresentation => describeExam(r, new Date(Date.now() + offsetMs), (d) => fmtDT(d));

/** Live countdown that follows the server clock (offset = serverNow − browser now). Only rendered when the presentation model says the number is meaningful. */
export function Countdown({ to, offset, prefix }: { to: string; offset: number; prefix: string }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, []);
  const ms = new Date(to).getTime() - (Date.now() + offset); if (ms <= 0) return null;
  const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return <span className="small muted">{prefix} <span className="mono">{d ? `${d}d ` : ''}{String(h).padStart(2, '0')}:{String(m).padStart(2, '0')}:{String(s % 60).padStart(2, '0')}</span></span>;
}

/** Status badge + one plain sentence + (when meaningful) a countdown. Same wording on the dashboard, the schedule and the entry page. */
export function ExamStatusCell({ row, offset }: { row: MyExam; offset: number }) {
  const p = presentExam(row, offset);
  return (
    <div className="stack" style={{ gap: 4 }} data-testid={`exam-status-${p.key}`}>
      <div><Badge tone={p.tone}>{p.label}</Badge></div>
      <div className="small muted">{p.detail}</div>
      {p.countdown && <Countdown to={p.countdown.to} offset={offset} prefix={p.countdown.kind === 'starts' ? 'Starts in' : 'Closes in'} />}
    </div>
  );
}

export function ExamActionLink({ row, offset, size = 'sm' }: { row: MyExam; offset: number; size?: 'sm' | 'md' }) {
  const a = presentExam(row, offset).action; if (!a) return null;
  const cls = `btn ${a.kind === 'view-result' ? '' : 'btn-green'} ${size === 'sm' ? 'btn-sm' : ''}`;
  if (a.kind === 'view-result') return <Link className={cls} href="/results">{a.label} →</Link>;
  return <Link className={cls} href={`/exam/${row.examId}`}>{a.kind === 'resume' ? 'Resume →' : 'Start →'}</Link>;
}

export interface NotEligible { examId: string; code: string; title: string; course: string; reason: string }
/** Says plainly when a candidate is not admitted to an examination, why, and who to contact (UI-051). */
export function NotEligibleNotice({ items }: { items: NotEligible[] | undefined }) {
  if (!items?.length) return null;
  return (
    <div className="stack" data-testid="not-eligible" style={{ marginBottom: 14 }}>
      {items.map((x) => (
        <div key={x.examId} className="notice warn" role="status"><b>You are not eligible for {x.title}.</b> {x.reason} Contact your campus administrator or examinations office as soon as possible — they can review your record or record a decision.</div>
      ))}
    </div>
  );
}
