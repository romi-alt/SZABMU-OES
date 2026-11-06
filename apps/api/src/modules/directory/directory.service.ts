import { Inject, Injectable } from '@nestjs/common';
import { can } from '@oes/shared';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infra/prisma.service';
import { KvService } from '../../infra/kv.service';
import { AuditService } from '../audit/audit.service';
import { dropUserSessions, scope, type AuthUser } from '../../common/auth';
import { AppError, badRequest, notFound } from '../../common/errors';
import { paginate } from '../../common/validate';
import { CONFIG, type Config } from '../../config';
import { assertEnrollmentAllowed } from '../../directory/rules';

export interface ListQuery { page: number; pageSize: number; search?: string; sector?: string; affiliation?: string; kind?: string; type?: string; region?: string; city?: string; listingStatus?: string; operationalStatus?: string; restricted?: boolean; demo?: 'exclude' | 'include' | 'only' }

/**
 * The institution & programme directory for administrators. Read access is institution.read (campus administrators see only their own institutions);
 * every write needs institution.manage and is audited. Counts come from the database (students, offerings); unknown values are returned as null,
 * never as zero, and a published seat figure is reference data, never a count of students.
 */
@Injectable()
export class DirectoryService {
  constructor(private readonly prisma: PrismaService, private readonly kv: KvService, private readonly audit: AuditService, @Inject(CONFIG) private readonly cfg: Config) {}

  private demoVisible() { return this.cfg.DEMO_INSTITUTIONS_VISIBLE === 'true'; }
  /** Demo/archive rows: a scoped user always sees their own institutions; a university-wide user sees demo rows only where the site shows them or when a manager asks. */
  private demoFilter(u: AuthUser, demo: ListQuery['demo']): Prisma.InstitutionWhereInput {
    const manager = can(u.role, 'institution.manage');
    if (u.institutionIds !== null) return {};
    if (demo === 'only' && manager) return { isDemo: true };
    if (demo === 'include' && manager) return {};
    if (demo === 'exclude') return { isDemo: false };
    return this.demoVisible() ? {} : { isDemo: false };
  }

  async facets(u: AuthUser) {
    const where: Prisma.InstitutionWhereInput = { id: scope.filter(u), ...this.demoFilter(u, 'exclude') };
    const [regions, cities, types] = await Promise.all([
      this.prisma.institution.findMany({ where, distinct: ['region'], select: { region: true }, orderBy: { region: 'asc' } }),
      this.prisma.institution.findMany({ where, distinct: ['city'], select: { city: true }, orderBy: { city: 'asc' } }),
      this.prisma.institution.findMany({ where, distinct: ['type'], select: { type: true } }),
    ]);
    return { regions: regions.map((r) => r.region).filter(Boolean), cities: cities.map((c) => c.city).filter(Boolean), types: types.map((t) => t.type), canViewDemo: can(u.role, 'institution.manage') && u.institutionIds === null };
  }

  async list(u: AuthUser, q: ListQuery) {
    const and: Prisma.InstitutionWhereInput[] = [{ id: scope.filter(u) }, this.demoFilter(u, q.demo)];
    const eq = <K extends keyof Prisma.InstitutionWhereInput>(k: K, v: unknown) => { if (v) and.push({ [k]: v } as Prisma.InstitutionWhereInput); };
    eq('sector', q.sector); eq('affiliation', q.affiliation); eq('kind', q.kind); eq('type', q.type); eq('region', q.region); eq('city', q.city); eq('listingStatus', q.listingStatus); eq('operationalStatus', q.operationalStatus);
    if (q.restricted) and.push({ offerings: { some: { intakeStatus: 'STOPPED' } } });
    if (q.search) { const s = q.search; and.push({ OR: [{ name: { contains: s } }, { abbreviation: { contains: s } }, { code: { contains: s } }, { city: { contains: s } }, { region: { contains: s } }] }); }
    const where: Prisma.InstitutionWhereInput = { AND: and };
    const [rows, total] = await Promise.all([this.prisma.institution.findMany({ where, orderBy: [{ kind: 'asc' }, { name: 'asc' }], ...paginate(q) }), this.prisma.institution.count({ where })]);
    const ids = rows.map((r) => r.id);
    const [offs, studs] = await Promise.all([
      this.prisma.institutionProgramOffering.groupBy({ by: ['institutionId', 'verificationStatus', 'intakeStatus'], where: { institutionId: { in: ids } }, _count: { _all: true } }),
      this.prisma.student.groupBy({ by: ['institutionId'], where: { institutionId: { in: ids } }, _count: { _all: true } }),
    ]);
    const manage = can(u.role, 'institution.manage');
    return {
      total,
      items: rows.map((r) => {
        const o = offs.filter((x) => x.institutionId === r.id); const n = (f: (x: (typeof o)[number]) => boolean) => o.filter(f).reduce((a, b) => a + b._count._all, 0);
        return { id: r.id, code: r.code, name: r.name, abbreviation: r.abbreviation, kind: r.kind, type: r.type, sector: r.sector, affiliation: r.affiliation, city: r.city, region: r.region, campusLabel: r.campusLabel, active: r.active,
          listingStatus: r.listingStatus, operationalStatus: r.operationalStatus, isDemo: r.isDemo, lastVerifiedAt: r.lastVerifiedAt, directoryKey: r.directoryKey,
          offerings: { total: n(() => true), verified: n((x) => x.verificationStatus === 'VERIFIED'), needsVerification: n((x) => x.verificationStatus === 'NEEDS_VERIFICATION' || x.verificationStatus === 'LEGACY_UNVERIFIED'), stopped: n((x) => x.intakeStatus === 'STOPPED') },
          students: studs.find((s) => s.institutionId === r.id)?._count._all ?? 0, canEdit: manage };
      }),
    };
  }

  async detail(u: AuthUser, id: string) {
    const inst = await this.prisma.institution.findFirst({ where: { id, AND: [{ id: scope.filter(u) }, this.demoFilter(u, 'include')] } });
    if (!inst) throw notFound('Institution');
    const showDemoCourses = this.demoVisible();
    const [offerings, studentsByProgram, claims, selfDeclared, total] = await Promise.all([
      this.prisma.institutionProgramOffering.findMany({ where: { institutionId: id }, include: { program: true, awardingBody: true, allocations: true, sessions: { orderBy: { batchYear: 'desc' } } }, orderBy: { program: { name: 'asc' } } }),
      this.prisma.student.groupBy({ by: ['programId', 'shift'], where: { institutionId: id }, _count: { _all: true } }),
      this.prisma.directoryClaim.findMany({ where: { OR: [{ entityType: 'INSTITUTION', entityId: id }, { entityType: 'RELATIONSHIP', entityId: id }, { entityType: 'RESTRICTION', entityId: id }, { entityType: { in: ['OFFERING', 'RESTRICTION', 'ALLOCATION'] }, entityKey: { startsWith: `${inst.directoryKey ?? '\u0000'}/` } }] }, include: { source: true }, orderBy: { claimType: 'asc' } }),
      this.prisma.student.count({ where: { institutionId: id, selfDeclared: true } }),
      this.prisma.student.count({ where: { institutionId: id } }),
    ]);
    const progIds = offerings.map((o) => o.programId);
    const [courses, docs] = await Promise.all([
      this.prisma.course.groupBy({ by: ['programId'], where: { programId: { in: progIds }, ...(showDemoCourses ? {} : { isDemo: false }) }, _count: { _all: true } }),
      this.prisma.curriculumDocument.findMany({ where: { programId: { in: progIds } }, select: { programId: true, title: true, url: true, appliesTo: true }, orderBy: { title: 'asc' } }),
    ]);
    const claimOut = (c: (typeof claims)[number]) => ({ id: c.id, type: c.claimType, text: c.text, status: c.status, session: c.sessionLabel, effectiveFrom: c.effectiveFrom, retrievedAt: c.retrievedAt, source: { title: c.source.title, url: c.source.url, retrievedAt: c.source.retrievedAt } });
    return {
      id: inst.id, code: inst.code, name: inst.name, abbreviation: inst.abbreviation, kind: inst.kind, type: inst.type, sector: inst.sector, affiliation: inst.affiliation, city: inst.city, region: inst.region, campusLabel: inst.campusLabel,
      active: inst.active, listingStatus: inst.listingStatus, operationalStatus: inst.operationalStatus, isDemo: inst.isDemo, directoryKey: inst.directoryKey, sourceName: inst.sourceName, lastVerifiedAt: inst.lastVerifiedAt,
      lockedFields: Array.isArray(inst.lockedFields) ? inst.lockedFields : [], canEdit: can(u.role, 'institution.manage'),
      students: { total, pendingVerification: selfDeclared },
      offerings: offerings.map((o) => {
        const subjects = courses.find((c) => c.programId === o.programId)?._count._all ?? 0; const documents = docs.filter((d) => d.programId === o.programId);
        const mine = studentsByProgram.filter((s) => s.programId === o.programId); const key = `${inst.directoryKey ?? ''}/${o.program.directoryKey ?? ''}`;
        const restrictions = claims.filter((c) => c.entityType === 'RESTRICTION' && c.entityKey === key).map(claimOut);
        return {
          id: o.id, program: { id: o.program.id, code: o.program.code, directoryKey: o.program.directoryKey, name: o.program.name, level: o.program.level, durationMonths: o.program.durationMonths, durationYrs: o.program.durationYrs, sourceTitle: o.program.sourceTitle },
          awardingBody: { name: o.awardingBody.name, isSzabmu: o.awardingBody.isSzabmu }, sourceTitle: o.sourceTitle, verificationStatus: o.verificationStatus, intakeStatus: o.intakeStatus, intakeStoppedFromBatchYear: o.intakeStoppedFromBatchYear,
          allocations: o.allocations.map((a) => ({ shift: a.shift, annualSeats: a.annualSeats })), sessions: o.sessions.map((s) => ({ batchYear: s.batchYear, label: s.label, admissionsStatus: s.admissionsStatus, seatLimit: s.seatLimit, note: s.note })),
          enrolled: mine.reduce((a, b) => a + b._count._all, 0), enrolledByShift: Object.fromEntries(mine.filter((m) => m.shift).map((m) => [m.shift!, m._count._all])),
          curriculum: { readiness: subjects ? 'SUBJECTS_ENTERED' : documents.length ? 'DOCUMENT_LOCATED' : 'NO_EVIDENCE', subjects, documents },
          restrictions, locked: Array.isArray(o.lockedFields) ? o.lockedFields : [],
        };
      }),
      claims: claims.filter((c) => c.entityType === 'INSTITUTION' || c.entityType === 'RELATIONSHIP' || (c.entityType === 'RESTRICTION' && !offerings.some((o) => `${inst.directoryKey ?? ''}/${o.program.directoryKey ?? ''}` === c.entityKey))).map(claimOut),
    };
  }

  // ── writes (institution.manage; audited) ──
  async updateOffering(u: AuthUser, id: string, d: { intakeStatus?: 'UNRESTRICTED' | 'STOPPED'; intakeStoppedFromBatchYear?: number | null; verificationStatus?: 'VERIFIED' | 'NEEDS_VERIFICATION' | 'LEGACY_UNVERIFIED' | 'UNLISTED' }, ip?: string) {
    const cur = await this.prisma.institutionProgramOffering.findUnique({ where: { id } });
    if (!cur) throw notFound('Offering');
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const k of ['intakeStatus', 'intakeStoppedFromBatchYear', 'verificationStatus'] as const) { const v = d[k]; if (v === undefined) continue; if ((cur as Record<string, unknown>)[k] !== v) changes[k] = { from: (cur as Record<string, unknown>)[k], to: v }; }
    if (!Object.keys(changes).length) return { ok: true, changed: false };
    const locked = [...new Set([...(Array.isArray(cur.lockedFields) ? (cur.lockedFields as string[]) : []), ...Object.keys(changes)])];
    const data = Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.to]));
    await this.prisma.$transaction(async (tx) => {
      await tx.institutionProgramOffering.update({ where: { id }, data: { ...data, lockedFields: locked } as never });
      await this.audit.append(tx, { actor: u, action: 'directory.offering_update', entity: 'institution_program_offering', entityId: id, institutionId: cur.institutionId, meta: { programId: cur.programId, changes } as never, ip });
    });
    return { ok: true, changed: true };
  }

  async setSession(u: AuthUser, offeringId: string, batchYear: number, d: { admissionsStatus: 'OPEN' | 'CLOSED'; seatLimit?: number | null; label?: string | null; note?: string | null }, ip?: string) {
    const off = await this.prisma.institutionProgramOffering.findUnique({ where: { id: offeringId } });
    if (!off) throw notFound('Offering');
    await this.prisma.$transaction(async (tx) => {
      await tx.offeringSession.upsert({ where: { offeringId_batchYear: { offeringId, batchYear } }, create: { offeringId, batchYear, admissionsStatus: d.admissionsStatus, seatLimit: d.seatLimit ?? null, label: d.label ?? null, note: d.note ?? null, configuredById: u.id }, update: { admissionsStatus: d.admissionsStatus, seatLimit: d.seatLimit ?? null, label: d.label ?? null, note: d.note ?? null, configuredById: u.id } });
      await this.audit.append(tx, { actor: u, action: 'directory.session_set', entity: 'institution_program_offering', entityId: offeringId, institutionId: off.institutionId, meta: { batchYear, ...d } as never, ip });
    });
    return { ok: true };
  }
  async clearSession(u: AuthUser, offeringId: string, batchYear: number, ip?: string) {
    const off = await this.prisma.institutionProgramOffering.findUnique({ where: { id: offeringId } });
    if (!off) throw notFound('Offering');
    await this.prisma.$transaction(async (tx) => {
      await tx.offeringSession.deleteMany({ where: { offeringId, batchYear } });
      await this.audit.append(tx, { actor: u, action: 'directory.session_cleared', entity: 'institution_program_offering', entityId: offeringId, institutionId: off.institutionId, meta: { batchYear } as never, ip });
    });
    return { ok: true };
  }

  /**
   * Explicit, audited move of students to another institution/programme (the way genuine users attached to a demo institution are re-homed).
   * All-or-nothing; nothing moves unless every student passes: the target must be an offering the student may be placed in, and a student with any
   * examination history stays where their results are.
   */
  async reassignStudents(u: AuthUser, d: { toInstitutionId: string; toProgramId: string; studentIds: string[]; shift?: 'MORNING' | 'EVENING'; reason: string }, ip?: string) {
    const students = await this.prisma.student.findMany({ where: { id: { in: d.studentIds } }, include: { _count: { select: { attempts: true, results: true, candidacies: true } }, user: { select: { id: true, email: true } } } });
    if (students.length !== new Set(d.studentIds).size) throw badRequest('One of the students was not found.');
    const problems: string[] = [];
    for (const s of students) {
      if (s._count.attempts + s._count.results + s._count.candidacies > 0) problems.push(`${s.regNo}: has examination history (${s._count.candidacies} candidacies, ${s._count.attempts} attempts, ${s._count.results} results), so stays where those records are`);
      else if (s.institutionId === d.toInstitutionId && s.programId === d.toProgramId) problems.push(`${s.regNo}: is already there`);
    }
    if (problems.length) throw new AppError(400, 'REASSIGN_REFUSED', 'Nobody was moved.', { problems });
    for (const b of new Set(students.map((s) => s.batchYear))) await assertEnrollmentAllowed(this.prisma, { institutionId: d.toInstitutionId, programId: d.toProgramId, batchYear: b, shift: d.shift, trusted: true });
    await this.prisma.$transaction(async (tx) => {
      for (const s of students) {
        await tx.student.update({ where: { id: s.id }, data: { institutionId: d.toInstitutionId, programId: d.toProgramId, shift: d.shift ?? null } });
        await tx.userInstitution.deleteMany({ where: { userId: s.userId } });
        await tx.userInstitution.create({ data: { userId: s.userId, institutionId: d.toInstitutionId } });
        await this.audit.append(tx, { actor: u, action: 'student.reassigned', entity: 'student', entityId: s.id, institutionId: d.toInstitutionId, meta: { regNo: s.regNo, from: { institutionId: s.institutionId, programId: s.programId }, to: { institutionId: d.toInstitutionId, programId: d.toProgramId, shift: d.shift ?? null }, reason: d.reason } as never, ip });
      }
    });
    for (const s of students) await dropUserSessions(this.kv, s.userId);      // the cached session carries the old campus scope
    return { moved: students.length };
  }
}
