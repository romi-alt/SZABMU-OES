import { INSTITUTIONS } from './baseline';
import type { ParsedInstitution } from './parse-institutes';

const norm = (s: string) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');
/** Names as the official page spells them where they differ from the dataset's display name (compared after normalising). */
const MATCH = (page: string, ds: string) => norm(page) === norm(ds) || norm(page).startsWith(norm(ds.split(',')[0]!)) || norm(ds).startsWith(norm(page.split(',')[0]!));

/** Compares the baseline dataset with the parsed official page. An empty list means every institution, programme, seat figure, shift and intake note agrees. */
export function verifyDataset(page: ParsedInstitution[]): string[] {
  const out: string[] = []; const used = new Set<ParsedInstitution>();
  for (const d of INSTITUTIONS.filter((i) => i.group !== 'UNIT')) {
    const p = page.find((x) => !used.has(x) && MATCH(x.name, d.name));
    if (!p) { out.push(`${d.key}: not found on the official page`); continue; }
    used.add(p);
    const exp = d.offerings.flatMap((o) => (o.seats === null ? [{ program: o.program, shift: 'UNSPECIFIED', seats: null as number | null, stopped: !!o.stopped }] : typeof o.seats === 'number' ? [{ program: o.program, shift: 'UNSPECIFIED', seats: o.seats, stopped: !!o.stopped }] : Object.entries(o.seats).map(([s, n]) => ({ program: o.program, shift: s, seats: n as number | null, stopped: !!o.stopped }))));
    for (const e of exp) {
      const got = p.offerings.find((x) => x.programKey === e.program && x.shift === e.shift);
      if (!got) out.push(`${d.key}: ${e.program}${e.shift === 'UNSPECIFIED' ? '' : ` (${e.shift.toLowerCase()})`} is in the dataset but not on the page`);
      else { if (got.seats !== e.seats) out.push(`${d.key}: ${e.program} seats ${e.seats} in the dataset, ${got.seats} on the page`); if (got.intakeStop !== e.stopped) out.push(`${d.key}: ${e.program} intake-stop ${e.stopped} in the dataset, ${got.intakeStop} on the page`); }
    }
    for (const g of p.offerings) if (!exp.some((e) => e.program === g.programKey && e.shift === g.shift)) out.push(`${d.key}: page lists "${g.label}" (${g.programKey ?? 'unmapped'}) which is not in the dataset`);
  }
  for (const p of page) if (!used.has(p)) out.push(`Page lists "${p.name}" which is not in the dataset`);
  return out;
}
