import type { PrismaService } from '../infra/prisma.service';

export interface RollbackReport { runId: string; apply: boolean; deleted: string[]; delisted: string[]; reverted: string[]; keptEdited: string[] }
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Undoes one applied import run and nothing else. Anything the run created is deleted only if nothing depends on it now; otherwise it is delisted
 * and kept, so students, register rows, teachers, exams and questions added after the import keep their institution and programme. A field the run
 * changed is restored only if it still holds the value the run wrote (a later manual edit is kept).
 */
export async function rollbackRun(prisma: PrismaService, runId: string, opts: { apply: boolean; actor: string }): Promise<RollbackReport> {
  const run = await prisma.directoryImportRun.findUnique({ where: { id: runId } });
  if (!run || run.mode !== 'APPLY') throw new Error('Only an applied import run can be rolled back.');
  const rb = await prisma.directoryImportRun.create({ data: { version: run.version, mode: 'ROLLBACK', actor: opts.actor, summary: { of: runId, apply: opts.apply } as never } });
  const rep: RollbackReport = { runId, apply: opts.apply, deleted: [], delisted: [], reverted: [], keptEdited: [] };
  try {
    await prisma.$transaction(async (tx) => {
      const changes = await tx.directoryImportChange.findMany({ where: { runId } });
      const created = (entity: string) => changes.filter((c) => c.entity === entity && c.action === 'CREATED').map((c) => c.entityId);
      // 1. restore fields the run changed (only where still unchanged since)
      const model: Record<string, (id: string) => Promise<Record<string, unknown> | null>> = {
        institution: (id) => tx.institution.findUnique({ where: { id } }), program: (id) => tx.program.findUnique({ where: { id } }), offering: (id) => tx.institutionProgramOffering.findUnique({ where: { id } }),
        allocation: (id) => tx.offeringAllocation.findUnique({ where: { id } }), source: (id) => tx.directorySource.findUnique({ where: { id } }), claim: (id) => tx.directoryClaim.findUnique({ where: { id } }), curriculum: (id) => tx.curriculumDocument.findUnique({ where: { id } }),
      };
      const write: Record<string, (id: string, data: Record<string, unknown>) => Promise<unknown>> = {
        institution: (id, data) => tx.institution.update({ where: { id }, data: data as never }), program: (id, data) => tx.program.update({ where: { id }, data: data as never }),
        offering: (id, data) => tx.institutionProgramOffering.update({ where: { id }, data: data as never }), allocation: (id, data) => tx.offeringAllocation.update({ where: { id }, data: data as never }),
        source: (id, data) => tx.directorySource.update({ where: { id }, data: data as never }), claim: (id, data) => tx.directoryClaim.update({ where: { id }, data: data as never }), curriculum: (id, data) => tx.curriculumDocument.update({ where: { id }, data: data as never }),
      };
      for (const c of changes.filter((x) => x.action === 'UPDATED')) {
        const before = (c.before ?? {}) as Record<string, unknown>; const after = (c.after ?? {}) as Record<string, unknown>; const cur = await model[c.entity]?.(c.entityId); if (!cur) continue;
        const restore: Record<string, unknown> = {};
        for (const k of Object.keys(before)) { const now = cur[k] instanceof Date ? (cur[k] as Date).toISOString() : cur[k]; const wrote = after[k]; if (same(now, wrote) || same(cur[k], wrote)) restore[k] = before[k]; else rep.keptEdited.push(`${c.entity} ${c.entityId}: ${k} was changed after the import and is kept`); }
        if (Object.keys(restore).length) { rep.reverted.push(`${c.entity} ${c.entityId}: ${Object.keys(restore).join(', ')}`); if (opts.apply) await write[c.entity]!(c.entityId, restore); }
      }
      // 2. remove what the run created, if nothing depends on it
      for (const id of created('claim')) { rep.deleted.push(`claim ${id}`); if (opts.apply) await tx.directoryClaim.deleteMany({ where: { id } }); }
      for (const id of created('curriculum')) { rep.deleted.push(`curriculum ${id}`); if (opts.apply) await tx.curriculumDocument.deleteMany({ where: { id } }); }
      for (const id of created('alias')) { rep.deleted.push(`alias ${id}`); if (opts.apply) await tx.programAlias.deleteMany({ where: { id } }); }
      const offeringIds = created('offering'); const gone = new Set<string>();   // offerings deleted (or that would be deleted)
      for (const id of offeringIds) {
        const o = await tx.institutionProgramOffering.findUnique({ where: { id } }); if (!o) continue;
        const [st, ro, se] = await Promise.all([tx.student.count({ where: { institutionId: o.institutionId, programId: o.programId } }), tx.rosterEntry.count({ where: { institutionId: o.institutionId, programId: o.programId } }), tx.offeringSession.count({ where: { offeringId: id } })]);
        if (st + ro + se === 0) { gone.add(id); rep.deleted.push(`offering ${id}`); if (opts.apply) { await tx.offeringAllocation.deleteMany({ where: { offeringId: id } }); await tx.institutionProgramOffering.delete({ where: { id } }); } }
        else { rep.delisted.push(`offering ${id}: ${st} student(s), ${ro} register row(s), ${se} session setting(s) depend on it`); if (opts.apply) await tx.institutionProgramOffering.update({ where: { id }, data: { verificationStatus: 'UNLISTED' } }); }
      }
      for (const id of created('institution')) {
        const i = await tx.institution.findUnique({ where: { id }, include: { _count: { select: { students: true, users: true, roster: true, questions: true, exams: true, candidates: true, incidents: true, courseAssignments: true, departments: true } } } }); if (!i) continue;
        const pools = Number((await tx.$queryRaw<{ n: number | bigint }[]>`SELECT COUNT(*) AS n FROM question_pools WHERE institutionId = ${id}`)[0]?.n ?? 0);
        const remainingOfferings = (await tx.institutionProgramOffering.findMany({ where: { institutionId: id }, select: { id: true } })).filter((o) => !gone.has(o.id)).length;
        const deps = Object.values(i._count).reduce((a, b) => a + b, 0) + pools + remainingOfferings;
        if (deps === 0) { rep.deleted.push(`institution ${id} (${i.code})`); if (opts.apply) await tx.institution.delete({ where: { id } }); }
        else { rep.delisted.push(`institution ${id} (${i.code}): ${deps} dependent record(s) exist now`); if (opts.apply) await tx.institution.update({ where: { id }, data: { listingStatus: 'HIDDEN' } }); }
      }
      for (const id of created('program')) {
        const p = await tx.program.findUnique({ where: { id }, include: { _count: { select: { students: true, roster: true, courses: true, offerings: true } } } }); if (!p) continue;
        const left = (await tx.institutionProgramOffering.findMany({ where: { programId: id }, select: { id: true } })).filter((o) => !gone.has(o.id)).length;
        const deps = p._count.students + p._count.roster + p._count.courses + left;
        if (deps === 0) { rep.deleted.push(`program ${id} (${p.code})`); if (opts.apply) { await tx.programAlias.deleteMany({ where: { programId: id } }); await tx.curriculumDocument.updateMany({ where: { programId: id }, data: { programId: null } }); await tx.program.delete({ where: { id } }); } }
        else { rep.delisted.push(`program ${id} (${p.code}): ${deps} dependent record(s) exist now`); if (opts.apply) await tx.program.update({ where: { id }, data: { verificationStatus: 'UNLISTED' } }); }
      }
      for (const id of created('source')) { const n = await tx.directoryClaim.count({ where: { sourceId: id } }); if (n === 0 || opts.apply === false) { rep.deleted.push(`source ${id}`); if (opts.apply && n === 0) await tx.directorySource.delete({ where: { id } }); } }
    }, { timeout: 180_000, maxWait: 30_000 });
    await prisma.directoryImportRun.update({ where: { id: rb.id }, data: { status: 'COMPLETED', finishedAt: new Date(), summary: rep as never } });
    return rep;
  } catch (e) {
    await prisma.directoryImportRun.update({ where: { id: rb.id }, data: { status: 'FAILED', finishedAt: new Date(), error: String((e as Error).message).slice(0, 4000) } });
    throw e;
  }
}
