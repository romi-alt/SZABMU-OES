/**
 * Reads the text of the official "Our Institutes" page into institutions, programme rows, seats, shifts and intake-stop notes.
 * It is used (a) offline against the committed snapshot and (b) against the live page by `directory verify --live`, so the baseline dataset is
 * checked against the source rather than trusted. The page text is untrusted data: it is only ever split and compared, never executed.
 */
export type SourceGroup = 'CONSTITUENT' | 'GOVERNMENT' | 'PRIVATE';
export interface ParsedOffering { label: string; programKey: string | null; seats: number | null; shift: 'UNSPECIFIED' | 'MORNING' | 'EVENING'; intakeStop: boolean }
export interface ParsedInstitution { name: string; group: SourceGroup; offerings: ParsedOffering[]; subUnits: string[] }

/** Program label as published → internal programme key. Unmapped labels return null and are reported, never guessed. */
export function programKeyFromLabel(raw: string): string | null {
  const t = raw.replace(/NEW ADMISSIONS?\s*(&|AND)\s*INTAKE\s*STOP/i, '').replace(/\([^)]*\)/g, ' ').replace(/&/g, ' and ').replace(/\s+/g, ' ').replace(/\s*-\s*/g, ' ').trim().toLowerCase();
  const table: [RegExp, string][] = [
    [/^mbbs$/, 'MBBS'], [/^bds$/, 'BDS'], [/^dpt$/, 'DPT'], [/^post rn bsn$/, 'BSN_POST_RN'], [/^generic bsn$/, 'BSN_GENERIC'],
    [/^bs anesthesia technology$/, 'BS_ANESTHESIA'], [/^bs medical lab(oratory)? technology$/, 'BS_MLT'], [/^bs vision sciences$/, 'BS_VISION'],
    [/^bs radiography and imaging technology$/, 'BS_RADIOGRAPHY_IMAGING'], [/^bs dental technology$/, 'BS_DENTAL_TECH'], [/^bs cardiovascular sciences$/, 'BS_CARDIOVASCULAR_SCIENCES'],
    [/^bs cardiac perfusion$/, 'BS_CARDIAC_PERFUSION'], [/^bs emergency and clinical medicine$/, 'BS_EMERGENCY_CLINICAL_MEDICINE'], [/^bs surgical technology$/, 'BS_SURGICAL_TECH'],
    [/^postgraduate diploma in speech and language therapy$/, 'PGD_SPEECH_LANGUAGE_THERAPY'],
  ];
  return table.find(([re]) => re.test(t))?.[1] ?? null;
}

const SKIP = new Set(['Sr. #', 'Program Offered', 'Number of Seats', 'Institution offering Degree Program']);
const SEATS = /^(\d+)\s*seats per annum(?:\s*\((morning|evening) shift\))?$/i;
const GROUPS: Record<string, SourceGroup> = { 'Constituent Institutes': 'CONSTITUENT', 'Government Sector Institutes': 'GOVERNMENT', 'Private Sector Institutes': 'PRIVATE' };

export function parseInstitutesText(text: string): ParsedInstitution[] {
  const tokens: string[] = [];
  for (const line of text.split('\n')) for (const cell of line.split('|')) { const t = cell.replace(/\s+/g, ' ').trim(); if (t && !SKIP.has(t) && !/^\d+$/.test(t)) tokens.push(t); }
  const out: ParsedInstitution[] = []; let group: SourceGroup = 'CONSTITUENT'; let cur: ParsedInstitution | null = null;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (GROUPS[t]) { group = GROUPS[t]!; cur = null; continue; }
    if (t === 'Affiliated Institutes' || t === 'Quick Links') { if (t === 'Quick Links') break; continue; }
    const seats = SEATS.exec(t);
    if (seats) continue;                                                     // a seats cell is consumed together with its programme label below
    const next = tokens[i + 1];
    if (next && SEATS.test(next)) {                                          // programme label + seats
      const m = SEATS.exec(next)!;
      cur?.offerings.push({ label: t, programKey: programKeyFromLabel(t), seats: Number(m[1]), shift: m[2] ? (m[2].toLowerCase() === 'morning' ? 'MORNING' : 'EVENING') : 'UNSPECIFIED', intakeStop: /INTAKE\s*STOP/i.test(t) });
      i++; continue;
    }
    if (next === t) { cur = { name: t, group, offerings: [], subUnits: [] }; out.push(cur); i++; continue; }   // the page repeats an institution name as heading + title
    if (programKeyFromLabel(t)) continue;
    if (cur) cur.subUnits.push(t);                                           // e.g. a named unit inside an institution entry
  }
  return out;
}

/** Plain text of an HTML page: scripts/styles removed, block ends and table cells become separators. */
export function htmlToText(html: string): string {
  const entities: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };
  return html.replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d|table|section)>/gi, '\n').replace(/<\/t[dh]>/gi, ' | ')
    .replace(/<[^>]+>/g, '').replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => entities[m] ?? m).split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n');
}
/** The institutes section of the page text (from "Constituent Institutes" to "Quick Links"). */
export function institutesSection(pageText: string): string {
  const a = pageText.indexOf('Constituent Institutes'); const b = pageText.indexOf('Quick Links', a); return a < 0 ? '' : pageText.slice(a, b < 0 ? undefined : b);
}
