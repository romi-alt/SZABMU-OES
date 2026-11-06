import type { Prisma } from '../generated/prisma/client';
import type { PrismaService } from '../infra/prisma.service';
import { AppError, badRequest } from '../common/errors';

type Db = PrismaService | Prisma.TransactionClient;
export const SHIFTS = ['MORNING', 'EVENING'] as const;

/**
 * Server-side rules that decide whether an institution-programme combination may be used. Every entry point calls these (student profile, student
 * creation and import, register import, teacher and lecturer assignments, exam rosters), so a form cannot be bypassed by sending other identifiers.
 *
 * Kept separate on purpose: listing (is it in the directory) / verification (has a source confirmed it) / intake (may NEW students enrol) /
 * session admissions (is a given batch open or capped) / existing cohorts (never affected by intake) / examination eligibility (awarding body only).
 */

/** Where an institution-programme pair may appear in a selection list: not delisted, institution listed and active, awarded by SZABMU, demo only if visible. */
export function selectableWhere(demoVisible: boolean): Prisma.InstitutionProgramOfferingWhereInput {
  return {
    verificationStatus: { not: 'UNLISTED' }, awardingBody: { isSzabmu: true },
    institution: { active: true, listingStatus: { not: 'HIDDEN' }, ...(demoVisible ? {} : { isDemo: false }) },
    program: { active: true, verificationStatus: { not: 'UNLISTED' } },
  };
}

/** The offering for a pair, or a plain refusal. Used wherever someone is attached to an institution's programme (teachers, lecturers, students). */
export async function assertOffered(db: Db, institutionId: string, programId: string) {
  const o = await db.institutionProgramOffering.findUnique({ where: { institutionId_programId: { institutionId, programId } }, include: { institution: true, awardingBody: true, allocations: true, program: { select: { name: true } } } });
  if (!o || o.verificationStatus === 'UNLISTED') throw new AppError(400, 'NOT_OFFERED', 'That programme is not offered at the selected institution.');
  if (!o.institution.active || o.institution.listingStatus === 'HIDDEN') throw new AppError(400, 'INSTITUTION_NOT_LISTED', 'That institution is not available for selection.');
  if (!o.awardingBody.isSzabmu) throw new AppError(409, 'OUTSIDE_SZABMU', 'That programme is not awarded by SZABMU, so it cannot be used in SZABMU examinations.');
  return o;
}

/**
 * May a NEW enrolment be created into this offering? `trusted` means the placement is backed by an institution register (a register row, or an
 * administrator acting on the register) — such a student is an existing cohort member, not a new applicant, so a stopped intake does not bar them
 * unless a source says from which batch the stop applies. A self-declared student with no register match is a new enrolment.
 */
export async function assertEnrollmentAllowed(db: Db, p: { institutionId: string; programId: string; batchYear: number; shift?: string | null; trusted: boolean }) {
  const o = await assertOffered(db, p.institutionId, p.programId);
  if (o.intakeStatus === 'STOPPED') {
    const fromYear = o.intakeStoppedFromBatchYear;
    if (!p.trusted || (fromYear !== null && p.batchYear >= fromYear))
      throw new AppError(409, 'INTAKE_STOPPED', `${o.institution.name} is not admitting new students to ${o.program.name}. If you are an existing student, ask the college's examination office to add you to the student register.`);
  }
  const session = await db.offeringSession.findUnique({ where: { offeringId_batchYear: { offeringId: o.id, batchYear: p.batchYear } } });
  if (session) {
    if (session.admissionsStatus === 'CLOSED' && !p.trusted) throw new AppError(409, 'ADMISSIONS_CLOSED', 'Admissions for this batch are closed.');
    if (session.seatLimit !== null) {
      const taken = await db.student.count({ where: { institutionId: p.institutionId, programId: p.programId, batchYear: p.batchYear } });
      if (taken >= session.seatLimit) throw new AppError(409, 'SESSION_FULL', 'This batch has reached the seat limit set for it.');
    }
  }
  // Shifts: required, and valid, only where the offering has separate morning/evening allocations
  const shifts = o.allocations.map((a) => a.shift).filter((s) => s !== 'UNSPECIFIED');
  const shift = p.shift && p.shift !== 'UNSPECIFIED' ? p.shift : null;
  if (shifts.length > 1) { if (!shift) throw badRequest('Choose your shift (morning or evening).'); if (!shifts.includes(shift as never)) throw badRequest('That shift is not offered for this programme.'); }
  else if (shift) throw badRequest('This programme has no separate shifts.');
  return { offeringId: o.id, shift: shift as 'MORNING' | 'EVENING' | null };
}

/** Real registration (student profile, teacher requests) never places anyone in a synthetic demo institution unless this site shows demo records. */
export async function assertNotHiddenDemo(db: Db, institutionId: string, demoVisible: boolean) {
  if (demoVisible) return;
  const i = await db.institution.findUnique({ where: { id: institutionId }, select: { isDemo: true } });
  if (i?.isDemo) throw new AppError(400, 'INSTITUTION_NOT_LISTED', 'That institution is not available for selection.');
}

/** "institutionId|programId" for every offering awarded by someone other than SZABMU: its students are outside SZABMU examination eligibility. */
export async function outsideSzabmuPairs(db: Db): Promise<Set<string>> {
  const rows = await db.institutionProgramOffering.findMany({ where: { awardingBody: { isSzabmu: false } }, select: { institutionId: true, programId: true } });
  return new Set(rows.map((r) => `${r.institutionId}|${r.programId}`));
}
