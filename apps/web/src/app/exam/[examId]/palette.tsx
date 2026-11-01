'use client';
import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import type { PaletteKind } from '@/exam-engine';

export type Filter = 'all' | PaletteKind | 'marked';
export interface PalItem { id: string; number: number; index: number; kind: PaletteKind; marked: boolean; unsynced: boolean }
const pad = (n: number) => String(n).padStart(2, '0');
/** Non-colour cue for every state (WCAG 1.4.1): a glyph in the corner of the button, repeated in the legend. */
export const GLYPH: Record<PaletteKind, string> = { answered: '✓', skipped: '»', unanswered: '?', notvisited: '' };
const WORD: Record<PaletteKind, string> = { answered: 'answered', skipped: 'skipped', unanswered: 'unanswered', notvisited: 'not visited' };
export const labelFor = (i: PalItem) => `Question ${i.number}, ${WORD[i.kind]}${i.marked ? ', marked for review' : ''}${i.unsynced ? ', not yet confirmed by the server' : ''}`;

/**
 * Question navigator. Real buttons in a real list (no role override), a single tab stop with arrow-key movement (roving tabindex),
 * a "go to question" field and "next not answered", a glyph per state, and an aria-label such as "Question 12, answered".
 */
export function QuestionPalette({ items, all, total, current, inView, counts, filter, setFilter, onGo, sheet }: {
  items: PalItem[]; all: PalItem[]; total: number; current: number; inView: boolean; counts: Record<string, number>; filter: Filter; setFilter: (f: Filter) => void; onGo: (index: number) => void; sheet: boolean;
}) {
  const listRef = useRef<HTMLUListElement>(null); const jumpRef = useRef<HTMLInputElement>(null);
  const [focusIdx, setFocusIdx] = useState<number | null>(null); const [jump, setJump] = useState(''); const [hint, setHint] = useState('');
  // keep the current question visible inside the palette's own scroll area
  useEffect(() => { listRef.current?.querySelector<HTMLElement>('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' }); }, [current, sheet]);
  const tabbable = items.findIndex((x) => x.index === current) >= 0 ? items.findIndex((x) => x.index === current) : 0;
  const cols = () => { const t = listRef.current && getComputedStyle(listRef.current).gridTemplateColumns; return t ? Math.max(1, t.split(' ').length) : 6; };
  const move = (to: number) => { const n = Math.max(0, Math.min(items.length - 1, to)); setFocusIdx(n); requestAnimationFrame(() => listRef.current?.querySelectorAll<HTMLButtonElement>('button')[n]?.focus()); };
  const onKey = (e: KeyboardEvent, at: number) => {
    const c = cols();
    const map: Record<string, number> = { ArrowRight: at + 1, ArrowLeft: at - 1, ArrowDown: at + c, ArrowUp: at - c, Home: 0, End: items.length - 1, PageDown: at + c * 5, PageUp: at - c * 5 };
    if (e.key in map) { e.preventDefault(); move(map[e.key]!); }
  };
  const goTo = (n: number) => { if (!Number.isFinite(n) || n < 1 || n > total) { setHint(`Enter a question number from 1 to ${total}.`); return false; } setHint(''); onGo(n - 1); return true; };
  const nextNotAnswered = () => {
    const open = all.filter((x) => x.kind !== 'answered'); if (!open.length) { setHint('Every question is answered.'); return; }
    const next = open.find((x) => x.index > current) ?? open[0]!; setHint(`Question ${next.number}.`); onGo(next.index);
  };
  return (
    <div className="card"><div className="card-h"><h2 id="palette-title">Question palette</h2><span className="small muted mono" aria-label={`${counts.answered ?? 0} of ${total} answered`}>{counts.answered ?? 0}/{total}</span></div>
      <div className="card-b stack">
        <div className="bar" aria-hidden><i style={{ width: `${((counts.answered ?? 0) / Math.max(1, total)) * 100}%` }} /></div>
        <form className="row pal-jump" onSubmit={(e) => { e.preventDefault(); if (goTo(+jump)) setJump(''); }}>
          <label className="f grow"><span className="sr-only">Go to question number</span><input ref={jumpRef} id="jump-input" className="in mono" inputMode="numeric" pattern="[0-9]*" value={jump} onChange={(e) => setJump(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder={`Go to 1–${total}  (G)`} aria-label="Go to question number" aria-describedby="jump-hint" /></label>
          <button className="btn" type="submit" disabled={!jump}>Go</button>
          <button className="btn" type="button" onClick={nextNotAnswered}>Next not answered</button>
        </form>
        <span className={hint ? 'small faint' : 'sr-only'} id="jump-hint" role="status" aria-live="polite">{hint || 'Type a question number and press Enter, or press G anywhere to jump here.'}</span>
        <div className="row wrap" role="group" aria-label="Filter questions">{([['all', 'All'], ['answered', 'Answered'], ['skipped', 'Skipped'], ['unanswered', 'Unanswered'], ['notvisited', 'Not visited'], ['marked', 'Marked']] as [Filter, string][]).map(([k, l]) => <button key={k} type="button" className="chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}{k !== 'all' ? ` ${counts[k] ?? 0}` : ''}</button>)}</div>
        <ul className="pal" ref={listRef} aria-labelledby="palette-title">
          {items.map((x, at) => (
            <li key={x.id}>
              <button type="button" tabIndex={(focusIdx ?? tabbable) === at ? 0 : -1} className={`${x.kind} ${x.index === current && inView ? 'current' : ''} ${x.marked ? 'marked' : ''} ${x.unsynced ? 'unsynced' : ''}`}
                aria-label={labelFor(x)} aria-current={x.index === current ? 'true' : undefined} onFocus={() => setFocusIdx(at)} onKeyDown={(e) => onKey(e, at)} onClick={() => onGo(x.index)}>
                <span className="g" aria-hidden>{x.unsynced ? '!' : GLYPH[x.kind]}</span>{pad(x.number)}
              </button>
            </li>))}
        </ul>
        {!items.length && <div className="small faint">No questions match this filter.</div>}
        <ul className="legend" aria-label="Legend">
          <li><i className="lg answered" aria-hidden />✓ Answered</li><li><i className="lg skipped" aria-hidden />» Skipped</li><li><i className="lg unanswered" aria-hidden />? Unanswered</li><li><i className="lg notvisited" aria-hidden />Not visited</li><li><i className="lg marked" aria-hidden />Marked for review</li><li><i className="lg unsynced" aria-hidden />! Not yet confirmed</li>
        </ul>
      </div></div>
  );
}
export type { RefObject };
