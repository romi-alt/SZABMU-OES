'use client';
import Link from 'next/link';
import { fmtDT, useGet } from '@/api';
import { useUrlState } from '@/url-state';
import { Async, Badge, Field, ListEmpty, PageHead, Pager, Table } from '@/ui';

/** Question Submissions: the teacher's own questions that have left DRAFT, with the reviewer's feedback. The API returns no options or answer key here. */
const LABEL: Record<string, string> = { SUBMITTED: 'Under review', APPROVED: 'Approved', REJECTED: 'Returned for changes' };
const TONE: Record<string, string> = { SUBMITTED: 'amber', APPROVED: 'green', REJECTED: 'red' };

export default function Submissions() {
  const url = useUrlState({ page: '1', status: '' }); const page = Number(url.vals.page) || 1; const { status } = url.vals;
  const st = useGet<any>(`/teacher/submissions?page=${page}&pageSize=25${status ? `&status=${status}` : ''}`);
  return (
    <>
      <PageHead title="Question Submissions" sub="Questions you have sent for review, and what the reviewers decided. Returned questions are edited in their question bank and submitted again." />
      <Async state={st}>{(d) => (
        <>
          <dl className="kpis" data-testid="submission-counts" aria-label="Submissions by state">
            {(['SUBMITTED', 'APPROVED', 'REJECTED'] as const).map((k) => <div key={k}><dt>{LABEL[k]}</dt><dd>{d.counts[k]}</dd></div>)}
          </dl>
          <div className="filters" style={{ margin: '12px 0' }}>
            <Field label="Filter by state"><select className="in" value={status} onChange={(e) => { url.set('status', e.target.value); url.set('page', '1'); }}>
              <option value="">All submissions</option><option value="SUBMITTED">Under review</option><option value="APPROVED">Approved</option><option value="REJECTED">Returned for changes</option></select></Field>
          </div>
          {d.items.length ? (
            <div data-testid="submission-list"><Table rowKey={(r: any) => r.id} rowLabel={(r: any) => r.stem.slice(0, 40)} rows={d.items} cols={[
              { h: 'Question', cell: (r: any) => r.stem },
              { h: 'Question bank', cell: (r: any) => <Link href={`/pools?pool=${r.pool?.id}`}>{r.pool?.name}</Link> },
              { h: 'Subject', more: true, cell: (r: any) => <span className="code">{r.course}</span> },
              { h: 'State', cell: (r: any) => <Badge tone={TONE[r.status] ?? 'grey'}>{LABEL[r.status] ?? r.status}</Badge> },
              { h: 'Reviewer feedback', cell: (r: any) => r.reviewNote ? <span>{r.reviewNote}</span> : <span className="faint">—</span> },
              { h: 'Last change', more: true, cell: (r: any) => fmtDT(r.reviewedAt ?? r.updatedAt) },
            ]} /></div>
          ) : <ListEmpty noun="submissions" filters={[status && LABEL[status]?.toLowerCase()].filter(Boolean) as string[]} onClear={url.reset} />}
          <Pager page={page} total={d.total} size={25} onPage={(n) => url.set('page', String(n))} />
        </>)}
      </Async>
    </>
  );
}
