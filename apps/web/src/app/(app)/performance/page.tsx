'use client';
import { useGet } from '@/api';
import { Async, Card, PageHead, Stat } from '@/ui';

export default function Performance() {
  const st = useGet<any[]>('/me/results');
  return (
    <>
      <PageHead title="Performance" sub="Computed from your published results." />
      <Async state={st}>{(rows: any[]) => {
        const sat = rows.filter((r) => r.status !== 'ABSENT');
        if (!sat.length) return <Card><div className="empty">No published results yet.</div></Card>;
        const avg = sat.reduce((a, b) => a + b.percent, 0) / sat.length; const best = [...sat].sort((a, b) => b.percent - a.percent)[0];
        const passed = sat.filter((r) => r.status === 'PASS').length;
        return (
          <div className="stack-lg">
            <div className="grid g4"><Stat k="Average" v={`${avg.toFixed(1)}%`} /><Stat k="Best score" v={`${best.percent.toFixed(0)}%`} s={best.exam.course.title} /><Stat k="Passed" v={`${passed}/${sat.length}`} /><Stat k="Pass rate" v={`${Math.round((passed / sat.length) * 100)}%`} /></div>
            <Card title="Score by subject">
              <svg viewBox={`0 0 ${Math.max(360, sat.length * 70)} 220`} role="img" aria-label="Bar chart of score by subject" style={{ width: '100%', maxHeight: 260 }}>
                {[0, 50, 100].map((g) => <g key={g}><line x1="30" x2="100%" y1={190 - g * 1.6} y2={190 - g * 1.6} stroke="#E9DDDA" /><text x="0" y={194 - g * 1.6} fontSize="10" fill="#8A7A77">{g}</text></g>)}
                {sat.map((r, i) => <g key={r.id}><rect x={44 + i * 70} y={190 - r.percent * 1.6} width="44" height={r.percent * 1.6} fill={r.status === 'PASS' ? '#781F27' : '#BC3040'} rx="2" /><text x={66 + i * 70} y={184 - r.percent * 1.6} fontSize="11" textAnchor="middle" fontFamily="monospace" fontWeight="700">{r.percent.toFixed(0)}</text><text x={66 + i * 70} y="208" fontSize="10" textAnchor="middle" fill="#5E4E4B">{r.exam.course.title.slice(0, 10)}</text></g>)}
              </svg>
            </Card>
          </div>);
      }}</Async>
    </>
  );
}
