import { createHash } from 'node:crypto';
import type { Prisma } from '../generated/prisma/client';
import type { PrismaService } from '../infra/prisma.service';
import { CURRICULUM_LINKS } from './curriculum-links';
import { CURRICULUM_PROGRAM, DATASET_VERSION, HISTORICAL_NAMES, INSTITUTIONS, PROGRAMS, SOURCES, VERIFIED_ON, type InstitutionDef, type SourceKey } from './baseline';
import { parseInstitutesText, type ParsedInstitution } from './parse-institutes';
import { OUR_INSTITUTES_SNAPSHOT } from './snapshot-institutes';
import { verifyDataset } from './verify';

type Tx = Prisma.TransactionClient;
export interface PlanLine { entity: string; key: string; action: 'create' | 'reuse' | 'update' | 'preserve-manual' | 'skip'; detail?: string }
export interface ImportReport {
  version: string; mode: 'DRY_RUN' | 'APPLY'; datasetSha256: string; runId?: string;
  counts: Record<string, { create: number; reuse: number; update: number; preserved: number; skipped: number }>;
  lines: PlanLine[]; ambiguous: string[]; reviewExisting: string[]; discrepancies: string[]; unresolved: string[];
}
export interface ImportOptions { mode: 'DRY_RUN' | 'APPLY'; actor: string; /** Explicit links from a baseline key to an existing institution code, for ambiguous matches an administrator has decided. */ link?: Record<string, string> }

class DryRunRollback extends Error { constructor(readonly report: ImportReport) { super('dry run'); } }
export class ImportInProgress extends Error { constructor() { super('Another directory import is running. Try again when it has finished.'); } }

const norm = (s: string) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const at = (d: string) => new Date(`${d}T00:00:00.000Z`);
const locked = (row: { lockedFields: unknown }, field: string) => Array.isArray(row.lockedFields) && (row.lockedFields as string[]).includes(field);

export function datasetHash() {
  return createHash('sha256').update(JSON.stringify({ v: DATASET_VERSION, INSTITUTIONS, PROGRAMS, CURRICULUM_PROGRAM, CURRICULUM_LINKS })).digest('hex');
}

/** Executes (APPLY) or simulates (DRY_RUN) the import. A dry run performs the same operations inside a transaction that is always rolled back, so its report cannot differ from what apply would do. */
export async function runImport(prisma: PrismaService, opts: ImportOptions): Promise<ImportReport> {
  const sha = datasetHash();
  const run = await prisma.directoryImportRun.create({ data: { version: DATASET_VERSION, mode: opts.mode, actor: opts.actor, datasetSha256: sha } });
  try {
    const report = await prisma.$transaction((tx) => execute(tx, opts, run.id, sha), { timeout: 180_000, maxWait: 30_000 }).catch((e) => { if (e instanceof DryRunRollback) return e.report; throw e; });
    report.runId = run.id;
    await prisma.directoryImportRun.update({ where: { id: run.id }, data: { status: 'COMPLETED', finishedAt: new Date(), summary: { counts: report.counts, ambiguous: report.ambiguous.length, reviewExisting: report.reviewExisting.length, discrepancies: report.discrepancies.length } as never } });
    return report;
  } catch (e) {
    await prisma.directoryImportRun.update({ where: { id: run.id }, data: { status: 'FAILED', finishedAt: new Date(), error: String((e as Error).message).slice(0, 4000) } });
    throw e;
  }
}

async function execute(tx: Tx, opts: ImportOptions, runId: string, sha: string): Promise<ImportReport> {
  const got = await tx.$queryRaw<{ got: number | bigint | null }[]>`SELECT GET_LOCK('szabmu_directory_import', 0) AS got`;
  if (Number(got[0]?.got) !== 1) throw new ImportInProgress();
  try {
    const rep: ImportReport = { version: DATASET_VERSION, mode: opts.mode, datasetSha256: sha, counts: {}, lines: [], ambiguous: [], reviewExisting: [], discrepancies: [], unresolved: [] };
    const bump = (entity: string, action: PlanLine['action'], key: string, detail?: string) => {
      const c = (rep.counts[entity] ??= { create: 0, reuse: 0, update: 0, preserved: 0, skipped: 0 });
      if (action === 'create') c.create++; else if (action === 'reuse') c.reuse++; else if (action === 'update') c.update++; else if (action === 'preserve-manual') c.preserved++; else c.skipped++;
      rep.lines.push({ entity, key, action, detail });
    };
    const log = (entity: string, entityId: string, action: string, before?: unknown, after?: unknown) =>
      tx.directoryImportChange.create({ data: { runId, entity, entityId, action, before: before as never, after: after as never } });

    // The label as published, per (institution source name, programme, shift), from the committed snapshot of the official page.
    const parsed = parseInstitutesText(OUR_INSTITUTES_SNAPSHOT);
    const labelFor = (inst: InstitutionDef, program: string, shift: string): string | null => {
      const p = parsed.find((x) => x.name === inst.name || norm(x.name) === norm(inst.name) || norm(x.name).startsWith(norm(inst.name.split(',')[0]!)));
      return p?.offerings.find((x) => x.programKey === program && x.shift === shift)?.label ?? p?.offerings.find((x) => x.programKey === program)?.label ?? null;
    };

    // ── sources ──
    const sourceId = {} as Record<SourceKey, string>;
    for (const [key, s] of Object.entries(SOURCES) as [SourceKey, (typeof SOURCES)[SourceKey]][]) {
      const cur = await tx.directorySource.findUnique({ where: { key } });
      if (!cur) { const c = await tx.directorySource.create({ data: { key, url: s.url, title: s.title, retrievedAt: at(s.retrieved), contentSha256: s.sha256, note: s.note } }); sourceId[key] = c.id; await log('source', c.id, 'CREATED'); bump('source', 'create', key); }
      else {
        sourceId[key] = cur.id; const upd: Record<string, unknown> = {};
        if (cur.url !== s.url) upd.url = s.url; if (cur.title !== s.title) upd.title = s.title; if (+cur.retrievedAt !== +at(s.retrieved)) upd.retrievedAt = at(s.retrieved); if ((cur.contentSha256 ?? null) !== s.sha256) upd.contentSha256 = s.sha256; if ((cur.note ?? null) !== (s.note ?? null)) upd.note = s.note ?? null;
        if (Object.keys(upd).length) { await tx.directorySource.update({ where: { id: cur.id }, data: upd }); await log('source', cur.id, 'UPDATED', Object.fromEntries(Object.keys(upd).map((k) => [k, (cur as never)[k]])), upd); bump('source', 'update', key); } else bump('source', 'reuse', key);
      }
    }
    const szabmu = await tx.awardingBody.findUnique({ where: { key: 'szabmu' } });
    if (!szabmu) throw new Error('The SZABMU awarding body is missing: apply migration 20261107000000_institution_program_directory first.');

    const claim = async (entityType: 'INSTITUTION' | 'PROGRAM' | 'OFFERING' | 'ALLOCATION' | 'RESTRICTION' | 'RELATIONSHIP' | 'CURRICULUM', entityId: string | null, entityKey: string, type: string, text: string, source: SourceKey, status: 'VERIFIED' | 'UNRESOLVED' | 'DISCREPANCY', session?: string) => {
      const claimKey = `${entityType}:${entityKey}:${type}`.slice(0, 191);
      const cur = await tx.directoryClaim.findUnique({ where: { claimKey } });
      const data = { entityType, entityId, entityKey, claimType: type, text, status, sourceId: sourceId[source], sessionLabel: session ?? null, retrievedAt: at(SOURCES[source].retrieved), importRunId: runId };
      if (!cur) { const c = await tx.directoryClaim.create({ data: { claimKey, ...data } }); await log('claim', c.id, 'CREATED'); bump('claim', 'create', claimKey); if (status !== 'VERIFIED') rep.unresolved.push(`${entityKey}: ${type} (${status.toLowerCase()})`); return; }
      const diff = (['text', 'status', 'sourceId', 'sessionLabel'] as const).filter((k) => !same((cur as never)[k], (data as never)[k]));
      if (diff.length || (entityId && cur.entityId !== entityId)) { await tx.directoryClaim.update({ where: { id: cur.id }, data: { ...data, importRunId: cur.importRunId } }); await log('claim', cur.id, 'UPDATED', Object.fromEntries(diff.map((k) => [k, (cur as never)[k]])), Object.fromEntries(diff.map((k) => [k, (data as never)[k]]))); bump('claim', 'update', claimKey); }
      else bump('claim', 'reuse', claimKey);
      if (status !== 'VERIFIED') rep.unresolved.push(`${entityKey}: ${type} (${status.toLowerCase()})`);
    };

    // ── programmes ──
    const programId: Record<string, string> = {};
    const existingPrograms = await tx.program.findMany({ select: { id: true, code: true, directoryKey: true, name: true, isDemo: true } });
    for (const d of PROGRAMS) {
      const cur = await tx.program.findFirst({ where: { OR: [{ directoryKey: d.key }, { code: d.key }] } });
      const verification = d.verification ?? 'VERIFIED';
      if (!cur) {
        for (const e of existingPrograms.filter((x) => !x.directoryKey && (norm(x.name).includes(norm(d.name)) || norm(d.name).includes(norm(x.name))) && norm(x.name).length > 5))
          rep.ambiguous.push(`Existing programme ${e.code} ("${e.name}") resembles ${d.key} ("${d.name}"). They are NOT merged; ${d.key} is created separately. Decide explicitly whether they are the same degree.`);
        const c = await tx.program.create({ data: { code: d.key, directoryKey: d.key, name: d.name, level: d.level, durationYrs: d.years ?? (d.months ? Math.ceil(d.months / 12) : 0), durationMonths: d.months, sourceTitle: d.sourceTitle ?? null, catalogScope: d.scope, verificationStatus: verification, active: true } });
        programId[d.key] = c.id; await log('program', c.id, 'CREATED'); bump('program', 'create', d.key); continue;
      }
      programId[d.key] = cur.id;
      if (!cur.directoryKey) {                                                         // an existing programme matched by its exact code: claim it, change nothing else it already owns
        // Its existing name, level and duration stay the system's own: they are locked so a later run reports a difference instead of overwriting them.
        const upd: Record<string, unknown> = { directoryKey: d.key, lockedFields: [...new Set([...(Array.isArray(cur.lockedFields) ? (cur.lockedFields as string[]) : []), 'name', 'level', 'durationMonths'])] }; if (!cur.sourceTitle && d.sourceTitle) upd.sourceTitle = d.sourceTitle; if (cur.verificationStatus === 'LEGACY_UNVERIFIED') upd.verificationStatus = verification;
        if (norm(cur.name) !== norm(d.name)) rep.discrepancies.push(`Programme ${d.key}: existing name "${cur.name}" differs from "${d.name}"; the existing name is kept.`);
        await tx.program.update({ where: { id: cur.id }, data: upd }); await log('program', cur.id, 'UPDATED', { directoryKey: null, sourceTitle: cur.sourceTitle, verificationStatus: cur.verificationStatus, lockedFields: cur.lockedFields }, upd); bump('program', 'update', d.key, 'matched existing programme by exact code'); continue;
      }
      const want: Record<string, unknown> = { name: d.name, level: d.level, durationMonths: d.months, sourceTitle: d.sourceTitle ?? null, catalogScope: d.scope, verificationStatus: verification };
      const upd: Record<string, unknown> = {}; const before: Record<string, unknown> = {}; let kept = false;
      for (const [k, v] of Object.entries(want)) if (!same((cur as never)[k], v)) { if (locked(cur, k)) kept = true; else { upd[k] = v; before[k] = (cur as never)[k]; } }
      if (Object.keys(upd).length) { await tx.program.update({ where: { id: cur.id }, data: upd }); await log('program', cur.id, 'UPDATED', before, upd); bump('program', 'update', d.key); } else bump('program', kept ? 'preserve-manual' : 'reuse', d.key);
    }
    for (const d of PROGRAMS) for (const a of d.aliases ?? []) {
      const cur = await tx.programAlias.findUnique({ where: { programId_alias: { programId: programId[d.key]!, alias: a.alias } } });
      if (!cur) { const c = await tx.programAlias.create({ data: { programId: programId[d.key]!, alias: a.alias, note: a.note, sourceId: sourceId[a.source] } }); await log('alias', c.id, 'CREATED'); bump('alias', 'create', `${d.key}:${a.alias}`); await claim('PROGRAM', programId[d.key]!, d.key, 'TITLE_ALIAS_UNRESOLVED', a.note, a.source, 'UNRESOLVED'); } else bump('alias', 'reuse', `${d.key}:${a.alias}`);
    }
    for (const d of PROGRAMS.filter((x) => x.note)) await claim('PROGRAM', programId[d.key]!, d.key, 'PROGRAMME_NOTE', d.note!, d.source, d.verification === 'NEEDS_VERIFICATION' ? 'UNRESOLVED' : 'UNRESOLVED');

    // ── institutions, offerings, allocations, restrictions ──
    const existingInst = await tx.institution.findMany({ select: { id: true, code: true, name: true, directoryKey: true, isDemo: true } });
    const OWNED = ['name', 'abbreviation', 'sector', 'affiliation', 'type', 'kind', 'city', 'region', 'campusLabel', 'sourceName'] as const;
    for (const d of INSTITUTIONS) {
      let cur = await tx.institution.findUnique({ where: { directoryKey: d.key } });
      const linkCode = opts.link?.[d.key];
      if (!cur && linkCode) { cur = await tx.institution.findUnique({ where: { code: linkCode } }); if (!cur) { rep.ambiguous.push(`--link ${d.key}=${linkCode}: no institution with that code.`); bump('institution', 'skip', d.key, 'link target not found'); continue; } await tx.institution.update({ where: { id: cur.id }, data: { directoryKey: d.key } }); await log('institution', cur.id, 'UPDATED', { directoryKey: null }, { directoryKey: d.key }); }
      if (!cur) {
        const codeClash = existingInst.find((e) => e.code === d.code); const nameMatches = existingInst.filter((e) => !e.isDemo && !e.directoryKey && norm(e.name) === norm(d.name));
        if (codeClash) { rep.ambiguous.push(`${d.key}: system code ${d.code} is already used by "${codeClash.name}". Not created.`); bump('institution', 'skip', d.key, 'code clash'); continue; }
        if (nameMatches.length) { rep.ambiguous.push(`${d.key}: an existing institution has the same name (${nameMatches.map((m) => m.code).join(', ')}). It is NOT merged and ${d.key} is NOT created until you decide: re-run with --link ${d.key}=<code>.`); bump('institution', 'skip', d.key, 'name matches an existing record'); continue; }
        cur = await tx.institution.create({ data: { code: d.code, name: d.name, type: d.type as never, affiliation: d.affiliation, city: d.city, active: true, abbreviation: d.abbreviation ?? null, sector: d.sector, kind: d.kind ?? 'INSTITUTION', region: d.region, campusLabel: d.campusLabel ?? null, listingStatus: 'LISTED', operationalStatus: 'UNKNOWN', isDemo: false, directoryKey: d.key, sourceName: d.name, lastVerifiedAt: at(VERIFIED_ON) } });
        await log('institution', cur.id, 'CREATED'); bump('institution', 'create', d.key);
      } else {
        const want: Record<string, unknown> = { name: d.name, abbreviation: d.abbreviation ?? null, sector: d.sector, affiliation: d.affiliation, type: d.type, kind: d.kind ?? 'INSTITUTION', city: d.city, region: d.region, campusLabel: d.campusLabel ?? null, sourceName: d.name, lastVerifiedAt: at(VERIFIED_ON) };
        const upd: Record<string, unknown> = {}; const before: Record<string, unknown> = {}; let kept = 0;
        for (const [k, v] of Object.entries(want)) { const curV = (cur as Record<string, unknown>)[k]; const tv = (x: unknown) => (x instanceof Date ? x.getTime() : x); if (same(tv(curV), tv(v))) continue; if (locked(cur, k)) { kept++; rep.discrepancies.push(`${d.key}: "${k}" was edited by an administrator and is kept (import value: ${JSON.stringify(v)}).`); } else { upd[k] = v; before[k] = curV; } }
        if (Object.keys(upd).length) { await tx.institution.update({ where: { id: cur.id }, data: upd as never }); await log('institution', cur.id, 'UPDATED', before, upd); bump('institution', 'update', d.key); } else bump('institution', kept ? 'preserve-manual' : 'reuse', d.key);
      }
      void OWNED;
      if (d.group !== 'UNIT') await claim('INSTITUTION', cur.id, d.key, 'LISTED_ON_OFFICIAL_DIRECTORY', `Listed on the SZABMU "Our Institutes" page (${d.group === 'CONSTITUENT' ? 'Constituent Institutes' : d.group === 'GOVERNMENT' ? 'Affiliated — Government Sector' : 'Affiliated — Private Sector'}).`, 'institutes', 'VERIFIED');
      for (const cl of d.claims ?? []) await claim(cl.entity ?? 'INSTITUTION', cur.id, d.key, cl.type, cl.text, cl.source, cl.status, cl.session);

      for (const od of d.offerings) {
        const pid = programId[od.program]; if (!pid) { rep.discrepancies.push(`${d.key}: programme ${od.program} is not in the dictionary.`); continue; }
        const shifts: [string, number | null][] = od.seats === null ? [['UNSPECIFIED', null]] : typeof od.seats === 'number' ? [['UNSPECIFIED', od.seats]] : (Object.entries(od.seats) as [string, number][]);
        let off = await tx.institutionProgramOffering.findUnique({ where: { institutionId_programId: { institutionId: cur.id, programId: pid } } });
        const label = labelFor(d, od.program, shifts[0]![0]);
        const intake = od.stopped ? 'STOPPED' : 'UNRESTRICTED'; const okey = `${d.key}/${od.program}`;
        if (!off) { off = await tx.institutionProgramOffering.create({ data: { institutionId: cur.id, programId: pid, awardingBodyId: szabmu.id, verificationStatus: 'VERIFIED', intakeStatus: intake, sourceTitle: label, createdByRunId: runId } }); await log('offering', off.id, 'CREATED'); bump('offering', 'create', okey); }
        else {
          const want: Record<string, unknown> = { verificationStatus: 'VERIFIED', intakeStatus: intake, sourceTitle: label }; const upd: Record<string, unknown> = {}; const before: Record<string, unknown> = {}; let kept = false;
          for (const [k, v] of Object.entries(want)) if (!same((off as never)[k], v)) { if (locked(off, k)) { kept = true; rep.discrepancies.push(`${okey}: "${k}" was edited by an administrator and is kept.`); } else { upd[k] = v; before[k] = (off as never)[k]; } }
          if (Object.keys(upd).length) { await tx.institutionProgramOffering.update({ where: { id: off.id }, data: upd as never }); await log('offering', off.id, 'UPDATED', before, upd); bump('offering', 'update', okey); } else bump('offering', kept ? 'preserve-manual' : 'reuse', okey);
        }
        for (const [shift, seats] of shifts) {
          const a = await tx.offeringAllocation.findUnique({ where: { offeringId_shift: { offeringId: off.id, shift: shift as never } } });
          if (!a) { const c = await tx.offeringAllocation.create({ data: { offeringId: off.id, shift: shift as never, annualSeats: seats, sourceId: sourceId.institutes } }); await log('allocation', c.id, 'CREATED'); bump('allocation', 'create', `${okey}/${shift}`, seats === null ? 'unknown' : `${seats}`); }
          else if (a.annualSeats !== seats) { await tx.offeringAllocation.update({ where: { id: a.id }, data: { annualSeats: seats } }); await log('allocation', a.id, 'UPDATED', { annualSeats: a.annualSeats }, { annualSeats: seats }); bump('allocation', 'update', `${okey}/${shift}`); }
          else bump('allocation', 'reuse', `${okey}/${shift}`);
        }
        if (od.stopped) await claim('RESTRICTION', off.id, okey, 'INTAKE_STOPPED', `${label ?? od.program}: the official page states "NEW ADMISSIONS & INTAKE STOP". Effective date and session are not stated; the retrieval date is not an effective date.`, 'institutes', 'VERIFIED');
        if (typeof od.seats === 'number' || (od.seats && typeof od.seats === 'object')) await claim('ALLOCATION', off.id, okey, 'PUBLISHED_ANNUAL_SEATS', `${label ?? od.program}: ${shifts.map(([s, n]) => `${n} seats per annum${s === 'UNSPECIFIED' ? '' : ` (${s.toLowerCase()} shift)`}`).join('; ')}. Reference data, not an enrolment limit.`, 'institutes', 'VERIFIED');
      }
    }
    for (const h of HISTORICAL_NAMES) await claim('RELATIONSHIP', null, `historical:${norm(h.name)}`, 'HISTORICAL_LISTING_NOT_CURRENT', h.text, 'brief', 'UNRESOLVED');

    // ── curriculum documents (located documents only: no subject is created) ──
    const progByKey = Object.fromEntries(Object.entries(programId));
    for (const l of CURRICULUM_LINKS) {
      const file = l.url.split('/').pop()!; const pk = CURRICULUM_PROGRAM[file]; const pid = pk ? progByKey[pk] ?? null : null;
      if (pk === undefined) rep.discrepancies.push(`Curriculum document ${file} ("${l.title}") has no programme mapping decision; stored without a programme.`);
      const applies = /\(([^)]*year[^)]*)\)/i.exec(l.title)?.[1] ?? null;
      const cur = await tx.curriculumDocument.findUnique({ where: { url: l.url } });
      if (!cur) { const c = await tx.curriculumDocument.create({ data: { programId: pid, title: l.title, url: l.url, appliesTo: applies, sourceId: sourceId.curriculums, retrievedAt: at(SOURCES.curriculums.retrieved) } }); await log('curriculum', c.id, 'CREATED'); bump('curriculum', 'create', file); }
      else if (cur.programId !== pid || cur.title !== l.title) { await tx.curriculumDocument.update({ where: { id: cur.id }, data: { programId: pid, title: l.title } }); await log('curriculum', cur.id, 'UPDATED', { programId: cur.programId, title: cur.title }, { programId: pid, title: l.title }); bump('curriculum', 'update', file); }
      else bump('curriculum', 'reuse', file);
    }

    // ── source check, ambiguities and existing relationships that need review ──
    for (const dsc of verifyDataset(parsed as ParsedInstitution[])) rep.discrepancies.push(`Source check: ${dsc}`);
    const baselineKeys = new Set(INSTITUTIONS.map((i) => i.key));
    const others = await tx.institution.findMany({ where: { OR: [{ directoryKey: null }, { directoryKey: { notIn: [...baselineKeys] } }] }, select: { id: true, code: true, name: true, isDemo: true, _count: { select: { students: true, courseAssignments: true, roster: true } } } });
    for (const o of others) rep.reviewExisting.push(`${o.isDemo ? 'Demo' : 'Existing'} institution ${o.code} "${o.name}": ${o._count.students} students, ${o._count.roster} register rows, ${o._count.courseAssignments} lecturer/teacher assignments. ${o.isDemo ? 'Flagged demo; kept and recoverable; not offered for real registration.' : 'Not in the baseline: review whether it is a real institution to add or a record to retire.'}`);
    const legacy = await tx.institutionProgramOffering.count({ where: { verificationStatus: 'LEGACY_UNVERIFIED' } });
    if (legacy) rep.reviewExisting.push(`${legacy} institution-programme relationship(s) exist only because students, register rows or assignments already use them (LEGACY_UNVERIFIED). They keep working; verify or retire them.`);
    const genuine = await tx.$queryRaw<{ n: number | bigint }[]>`SELECT COUNT(DISTINCT u.id) AS n FROM users u JOIN user_institutions ui ON ui.userId = u.id JOIN institutions i ON i.id = ui.institutionId WHERE i.isDemo = true AND u.email NOT LIKE '%@demo.szabmu.invalid'`;
    if (Number(genuine[0]?.n ?? 0)) rep.reviewExisting.push(`${Number(genuine[0]!.n)} user(s) with a non-demo email are attached to demo institutions: use the explicit reassignment workflow; nothing is moved automatically.`);

    if (opts.mode === 'DRY_RUN') throw new DryRunRollback(rep);
    return rep;
  } finally {
    await tx.$queryRaw`SELECT RELEASE_LOCK('szabmu_directory_import')`.catch(() => undefined);
  }
}
