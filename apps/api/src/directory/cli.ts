import 'reflect-metadata';
import { loadConfig } from '../config';
import { PrismaService } from '../infra/prisma.service';
import { runImport, type ImportReport } from './importer';
import { rollbackRun } from './rollback';
import { htmlToText, institutesSection, parseInstitutesText } from './parse-institutes';
import { OUR_INSTITUTES_SNAPSHOT } from './snapshot-institutes';
import { verifyDataset } from './verify';
import { createHash } from 'node:crypto';

/**
 *  node apps/api/dist/directory/cli.js import   [--apply] [--actor NAME] [--link directoryKey=INSTITUTION_CODE ...] [--json]   (default: dry run)
 *  node apps/api/dist/directory/cli.js rollback RUN_ID  [--apply] [--actor NAME]                                                   (default: report only)
 *  node apps/api/dist/directory/cli.js verify   [--live]        checks the baseline dataset against the committed snapshot, or the live official page
 */
const args = process.argv.slice(2); const cmd = args[0]; const flag = (n: string) => args.includes(n); const val = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };

function print(r: ImportReport, json: boolean) {
  if (json) { console.log(JSON.stringify(r, null, 2)); return; }
  console.log(`\nDirectory import ${r.version} — ${r.mode}${r.runId ? ` (run ${r.runId})` : ''}\n`);
  for (const [e, c] of Object.entries(r.counts)) console.log(`  ${e.padEnd(11)} create ${String(c.create).padStart(4)}  reuse ${String(c.reuse).padStart(4)}  update ${String(c.update).padStart(3)}  kept-manual ${c.preserved}  skipped ${c.skipped}`);
  const sec = (t: string, xs: string[]) => { if (xs.length) { console.log(`\n${t} (${xs.length})`); xs.forEach((x) => console.log(`  - ${x}`)); } };
  sec('Ambiguous matches (nothing merged automatically)', r.ambiguous); sec('Existing relationships that need review', r.reviewExisting); sec('Source discrepancies / manual overrides kept', r.discrepancies);
  console.log(`\nUnresolved or discrepant claims recorded: ${r.unresolved.length}\n${r.mode === 'DRY_RUN' ? 'Dry run: nothing was written (the transaction was rolled back).' : 'Applied.'}`);
}

async function main() {
  if (cmd === 'verify') {
    let text = OUR_INSTITUTES_SNAPSHOT; let from = 'committed snapshot (2026-11-06)';
    if (flag('--live')) { const res = await fetch('https://www.szabmu.edu.pk/our-institutes', { signal: AbortSignal.timeout(30_000) }); if (!res.ok) throw new Error(`HTTP ${res.status}`); const page = htmlToText(await res.text()); text = institutesSection(page); from = `live page, section sha256 ${createHash('sha256').update(text).digest('hex')}`; }
    const parsed = parseInstitutesText(text); const bad = verifyDataset(parsed);
    console.log(`Checked ${parsed.length} institution entries from the ${from}.`); if (bad.length) { bad.forEach((b) => console.log(`  DIFFERENCE: ${b}`)); process.exitCode = 2; } else console.log('The baseline dataset agrees with the source: every institution, programme, seat figure, shift and intake-stop note.');
    return;
  }
  const prisma = new PrismaService(loadConfig());
  try {
    const actor = val('--actor') ?? `cli:${process.env.USER ?? 'unknown'}`;
    if (cmd === 'import') {
      const link: Record<string, string> = {}; args.forEach((a, i) => { if (a === '--link' && args[i + 1]?.includes('=')) { const [k, v] = args[i + 1]!.split('='); link[k!] = v!; } });
      print(await runImport(prisma, { mode: flag('--apply') ? 'APPLY' : 'DRY_RUN', actor, link }), flag('--json'));
    } else if (cmd === 'rollback') {
      const id = args[1]; if (!id) throw new Error('rollback needs a run id'); const r = await rollbackRun(prisma, id, { apply: flag('--apply'), actor });
      console.log(JSON.stringify(r, null, 2)); if (!r.apply) console.log('Report only: nothing was changed. Add --apply to roll back.');
    } else { console.log('Usage: import [--apply] | rollback RUN_ID [--apply] | verify [--live]'); process.exitCode = 1; }
  } finally { await prisma.$disconnect(); }
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
