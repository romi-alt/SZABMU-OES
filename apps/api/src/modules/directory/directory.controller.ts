import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, Ip, Perm, type AuthUser } from '../../common/auth';
import { page, parse, uuid } from '../../common/validate';
import { DirectoryService } from './directory.service';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');
const listQuery = page.extend({
  search: z.string().trim().max(100).optional(), sector: z.enum(['PUBLIC', 'PRIVATE']).optional(), affiliation: z.enum(['CONSTITUENT', 'AFFILIATED']).optional(), kind: z.enum(['INSTITUTION', 'ACADEMIC_UNIT']).optional(),
  type: z.string().max(40).optional(), region: z.string().max(100).optional(), city: z.string().max(100).optional(), listingStatus: z.enum(['LISTED', 'NEEDS_VERIFICATION', 'HIDDEN']).optional(),
  operationalStatus: z.enum(['OPERATING', 'UNKNOWN', 'CLOSED']).optional(), restricted: bool.optional(), demo: z.enum(['exclude', 'include', 'only']).optional(),
});
const offeringPatch = z.object({ intakeStatus: z.enum(['UNRESTRICTED', 'STOPPED']).optional(), intakeStoppedFromBatchYear: z.number().int().min(1990).max(2100).nullable().optional(), verificationStatus: z.enum(['VERIFIED', 'NEEDS_VERIFICATION', 'LEGACY_UNVERIFIED', 'UNLISTED']).optional() });
const sessionBody = z.object({ admissionsStatus: z.enum(['OPEN', 'CLOSED']), seatLimit: z.number().int().min(1).max(100000).nullable().optional(), label: z.string().trim().max(100).nullable().optional(), note: z.string().trim().max(1000).nullable().optional() });
const importBody = z.object({ apply: z.boolean(), datasetSha256: z.string().regex(/^[0-9a-f]{64}$/).optional() });
const reassign = z.object({ toInstitutionId: uuid, toProgramId: uuid, studentIds: z.array(uuid).min(1).max(200), shift: z.enum(['MORNING', 'EVENING']).optional(), reason: z.string().trim().min(10).max(500) });

/** Institution & programme directory (administration). Reads: institution.read (scoped); writes: institution.manage, audited. */
@Controller('directory')
export class DirectoryController {
  constructor(private readonly d: DirectoryService) {}
  @Perm('institution.read') @Get('facets') facets(@CurrentUser() u: AuthUser) { return this.d.facets(u); }
  @Perm('institution.read') @Get('institutions') list(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>) { return this.d.list(u, parse(listQuery, q)); }
  @Perm('institution.read') @Get('institutions/:id') detail(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.d.detail(u, id); }
  @Perm('institution.manage') @Patch('offerings/:id') offering(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown, @Ip() ip: string) { return this.d.updateOffering(u, id, parse(offeringPatch, b), ip); }
  @Perm('institution.manage') @Put('offerings/:id/sessions/:batchYear') setSession(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('batchYear', ParseIntPipe) y: number, @Body() b: unknown, @Ip() ip: string) { return this.d.setSession(u, id, y, parse(sessionBody, b), ip); }
  @Perm('institution.manage') @Delete('offerings/:id/sessions/:batchYear') clearSession(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('batchYear', ParseIntPipe) y: number, @Ip() ip: string) { return this.d.clearSession(u, id, y, ip); }
  @Perm('institution.manage') @Post('import') @HttpCode(200) importDirectory(@CurrentUser() u: AuthUser, @Body() b: unknown, @Ip() ip: string) { return this.d.importDirectory(u, parse(importBody, b), ip); }
  @Perm('institution.manage') @Post('reassign-students') @HttpCode(200) reassign(@CurrentUser() u: AuthUser, @Body() b: unknown, @Ip() ip: string) { return this.d.reassignStudents(u, parse(reassign, b), ip); }
}
