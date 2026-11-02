/** Minimal RFC 4180 CSV parser (quoted fields, doubled quotes, commas and line breaks inside quotes). Returns rows of cells; blank lines are skipped. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let q = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (q) { if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && src[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some((x) => x.trim() !== '')) rows.push(row); row = []; }
    else cell += c;
  }
  row.push(cell); if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

export const MCQ_COLUMNS = ['statement', 'option_a', 'option_b', 'option_c', 'option_d', 'option_e', 'correct', 'explanation', 'difficulty', 'topic', 'marks'] as const;
export const MCQ_TEMPLATE = `${MCQ_COLUMNS.join(',')}\r\nWhich organ produces insulin?,Liver,Pancreas,Kidney,Spleen,,B,Beta cells of the islets,easy,Endocrine,1\r\n`;

/** Turns CSV text into the rows the import endpoint expects, or says what is wrong with the header. */
export function mcqRowsFromCsv(text: string): { rows: { statement: string; options: string[]; correct: string; explanation?: string; difficulty?: string; topic?: string; marks?: number }[]; error?: string } {
  const t = parseCsv(text); if (t.length < 2) return { rows: [], error: 'The file needs a header row and at least one question.' };
  const head = t[0]!.map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, '_')); const at = (n: string) => head.indexOf(n);
  const missing = ['statement', 'option_a', 'option_b', 'option_c', 'option_d', 'correct'].filter((n) => at(n) < 0);
  if (missing.length) return { rows: [], error: `Missing column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. Use the template.` };
  const g = (r: string[], n: string) => (at(n) >= 0 ? (r[at(n)] ?? '').trim() : '');
  return { rows: t.slice(1).map((r) => ({
    statement: g(r, 'statement'), options: ['option_a', 'option_b', 'option_c', 'option_d', 'option_e'].map((n) => g(r, n)), correct: g(r, 'correct'),
    explanation: g(r, 'explanation') || undefined, difficulty: g(r, 'difficulty') || undefined, topic: g(r, 'topic') || undefined, marks: g(r, 'marks') ? Number(g(r, 'marks')) : undefined,
  })) };
}
