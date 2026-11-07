/**
 * Version-controlled baseline of the SZABMU institution and programme directory.
 * Encoded by hand from the supplied baseline (checked against https://www.szabmu.edu.pk/our-institutes by `directory verify`, offline against the
 * committed snapshot and live on demand). Internal keys/codes are system identifiers, NOT official SZABMU identifiers.
 * Unknown values are null: no address, contact person, phone, affiliation certificate number, regulator approval date, current intake session,
 * subject code, credit hours, semester curriculum, enrolment count or training-site allocation is invented anywhere in this file.
 */
export const DATASET_VERSION = '2026-11-06.1';
export const VERIFIED_ON = '2026-11-06';

export type Shift = 'UNSPECIFIED' | 'MORNING' | 'EVENING';
export type SourceKey = 'institutes' | 'qec' | 'postgraduate' | 'dpt' | 'ahs' | 'bms' | 'dph' | 'curriculums' | 'news' | 'pmdc' | 'pnmc' | 'brief';

/** Pages consulted. `retrieved` is a date (the time of day was not recorded); hashes are of the normalised page text that was read. */
export const SOURCES: Record<SourceKey, { url: string; title: string; retrieved: string; sha256: string | null; note?: string }> = {
  institutes: { url: 'https://www.szabmu.edu.pk/our-institutes', title: 'SZABMU — Our Institutes', retrieved: '2026-11-06', sha256: 'b04d8f637340491a707b80468b3bc6db5e69b9ada1818456d6e6b97719ab631e' },
  qec: { url: 'https://www.szabmu.edu.pk/qec/institutes', title: 'SZABMU Quality Enhancement Cell — Institutes', retrieved: '2026-11-06', sha256: 'd7acc989224f3f6c007c6b4027f68335263af788b7c10651c280d7fcae0b3ff7' },
  postgraduate: { url: 'https://www.szabmu.edu.pk/admission/postgraduate-admission', title: 'SZABMU — Postgraduate admission', retrieved: '2026-11-06', sha256: '02a58fa1cfc5c37b8715622dcb23b6eb490d6baf7105db2107175e443db0f1e9' },
  dpt: { url: 'https://www.szabmu.edu.pk/admission/dpt-admission', title: 'SZABMU — DPT admission', retrieved: '2026-11-06', sha256: '26728b24659d9fdef1a247b626de415d9ff3d953c24545119ea99bf1a594136a' },
  ahs: { url: 'https://www.szabmu.edu.pk/admission/ahs-admission', title: 'SZABMU — Allied Health Sciences admission', retrieved: '2026-11-06', sha256: '79089b058ac3807d62329e28bf7b4f56b8e7ec725a000ecdd73b923209c71321' },
  bms: { url: 'https://www.szabmu.edu.pk/program/basic-medical-sciences', title: 'SZABMU — Basic Medical Sciences (Non Clinical) programmes', retrieved: '2026-11-06', sha256: '63d19b9d36dc5c9cd94958600aba6b2e0e2d8d1cde4b5b3a7baa1736618050be' },
  dph: { url: 'https://www.szabmu.edu.pk/dph/programs', title: 'SZABMU — Department of Public Health programmes', retrieved: '2026-11-06', sha256: 'ad394ed12d4aa2a185896a1ab5c7d1fbd86f397dc72cacdfd9c4f5f226abc097' },
  curriculums: { url: 'https://www.szabmu.edu.pk/curriculums', title: 'SZABMU — Curriculums', retrieved: '2026-11-06', sha256: 'ed55161eb974709f57a9b1a8ecbca8572fae96abaa57ff742053c839f70cbc05' },
  news: { url: 'https://www.szabmu.edu.pk/news/admission-updates', title: 'SZABMU — Admission updates', retrieved: '2026-11-06', sha256: 'b9950115f17dc5a10fbf59f2990a211f124242a98ca6232fb5f943f053fc7b1e' },
  pmdc: { url: 'https://pmdc.pk/colleges', title: 'PM&DC — Colleges', retrieved: '2026-11-06', sha256: 'fbb5d5cfb2257f87477a15ebcd79a6346bd2c8d32ff6fcc081ecf89e3dc48f0e', note: 'The page loads its list dynamically: the fetched text contains no college records, so nothing on it could be verified.' },
  pnmc: { url: 'https://pnmc.gov.pk/recognized-institutes/', title: 'PNMC — Recognized institutes', retrieved: '2026-11-06', sha256: '8b762e6022637b9781ccfa084fa18608fc45f36beabe9c4bc9dda58b4ea2453c' },
  brief: { url: 'urn:supplied-baseline:2026-11-07', title: 'Supplied baseline (implementation request, "checked 7 November 2026")', retrieved: '2026-11-06', sha256: null, note: 'Statements taken from the supplied brief that could not be re-verified from an official page in this environment. The brief states a check date of 7 Nov 2026; the pages here were read on 6 Nov 2026.' },
};

export interface ProgramDef {
  key: string; name: string; level: string; years: number | null; months: number | null; scope: 'AFFILIATION' | 'UNIVERSITY_CATALOGUE';
  verification?: 'VERIFIED' | 'NEEDS_VERIFICATION'; sourceTitle?: string; source: SourceKey; aliases?: { alias: string; note: string; source: SourceKey }[]; note?: string;
}
const ug = (key: string, name: string, years: number | null, source: SourceKey = 'institutes', extra: Partial<ProgramDef> = {}): ProgramDef => ({ key, name, level: 'UNDERGRADUATE', years, months: years === null ? null : years * 12, scope: 'AFFILIATION', source, ...extra });
const pgSpec = (level: string, prefix: string, items: [string, string][], source: SourceKey): ProgramDef[] => items.map(([k, label]) => ({
  key: `${prefix}_${k}`, name: `${prefix === 'MPHIL' ? 'MPhil' : prefix} ${label}`, level, years: null, months: null, scope: 'UNIVERSITY_CATALOGUE', source, sourceTitle: `${prefix === 'MPHIL' ? 'M. Phil.' : prefix} (${label})`,
}));

export const PROGRAMS: ProgramDef[] = [
  // Reused by key when the legacy "MBBS" programme already exists (its name and duration are preserved).
  ug('MBBS', 'Bachelor of Medicine and Bachelor of Surgery', null, 'institutes', { sourceTitle: 'MBBS' }),
  ug('BDS', 'Bachelor of Dental Surgery', null, 'institutes', { sourceTitle: 'BDS' }),
  ug('DPT', 'Doctor of Physical Therapy', 5, 'institutes', { sourceTitle: 'DPT (05 Years)' }),
  ug('BSN_GENERIC', 'Generic Bachelor of Science in Nursing', 4, 'institutes', { sourceTitle: 'Generic BSN (04 Years)' }),
  ug('BSN_POST_RN', 'Post RN Bachelor of Science in Nursing', 2, 'institutes', { sourceTitle: 'Post RN BSN (02 Years)' }),
  ug('BS_ANESTHESIA', 'BS Anesthesia Technology', 4, 'institutes', { sourceTitle: 'BS - Anesthesia Technology', note: '4 years published for Midwest Institute of Sciences' }),
  ug('BS_MLT', 'BS Medical Laboratory Technology', 4, 'institutes', { sourceTitle: 'BS - Medical Laboratory Technology (04 Years)' }),
  ug('BS_VISION', 'BS Vision Sciences', null, 'institutes', { sourceTitle: 'BS - Vision Sciences' }),
  ug('BS_RADIOGRAPHY_IMAGING', 'BS Radiography and Imaging Technology', 4, 'institutes', { sourceTitle: 'BS - Radiography and Imaging Technology (04 Years)' }),
  ug('BS_DENTAL_TECH', 'BS Dental Technology', null, 'institutes', { sourceTitle: 'BS - Dental Technology',
    aliases: [{ alias: 'BS - Dental Hygiene Technology', note: 'Title used on the SZABMU Allied Health Sciences admission page; every other source says "Dental Technology". Whether it is the same curriculum is unresolved, so the two are not merged into one verified identity.', source: 'ahs' }] }),
  ug('BS_CARDIOVASCULAR_SCIENCES', 'BS Cardiovascular Sciences', null, 'institutes', { sourceTitle: 'BS - Cardiovascular Sciences' }),
  ug('BS_CARDIAC_PERFUSION', 'BS Cardiac Perfusion', null, 'institutes', { sourceTitle: 'BS - Cardiac Perfusion' }),
  ug('BS_EMERGENCY_CLINICAL_MEDICINE', 'BS Emergency and Clinical Medicine', null, 'institutes', { sourceTitle: 'BS - Emergency and Clinical Medicine' }),
  ug('BS_SURGICAL_TECH', 'BS Surgical Technology', null, 'institutes', { sourceTitle: 'BS - Surgical Technology' }),
  { key: 'PGD_SPEECH_LANGUAGE_THERAPY', name: 'Postgraduate Diploma in Speech and Language Therapy', level: 'POSTGRADUATE_DIPLOMA', years: null, months: null, scope: 'AFFILIATION', source: 'institutes', sourceTitle: 'Postgraduate Diploma in Speech and Language Therapy' },
  // Fall 2026 merit lists use a combined title; the exact degree identity is not established, so it stays a catalogue entry that needs review.
  { key: 'BS_MOLECULAR_BIOLOGY_BIOTECH', name: 'BS Molecular Biology / Biotechnology', level: 'UNDERGRADUATE', years: null, months: null, scope: 'UNIVERSITY_CATALOGUE', verification: 'NEEDS_VERIFICATION', source: 'news',
    sourceTitle: 'BS - Molecular Biology / Biotechnology', note: 'Appears only as a combined title in the Fall 2026 provisional merit list notice (5 Oct 2026). Whether it is one degree or two, and which unit offers it, is not established.' },
  // Basic Medical Sciences (Non Clinical) catalogue page
  ...([['CHEMICAL_PATHOLOGY', 'Chemical Pathology'], ['HAEMATOLOGY', 'Haematology'], ['HISTOPATHOLOGY', 'Histopathology'], ['MICROBIOLOGY', 'Microbiology'], ['PHYSIOLOGY', 'Physiology'], ['PHARMACOLOGY', 'Pharmacology'], ['MOLECULAR_BIOLOGY', 'Molecular Biology']] as [string, string][])
    .map(([k, label]): ProgramDef => ({ key: `MPHIL_${k}`, name: `MPhil ${label}`, level: 'MPHIL', years: 2, months: 24, scope: 'UNIVERSITY_CATALOGUE', source: 'bms', sourceTitle: `M. Phil. (${label})` })),
  { key: 'PHD_MOLECULAR_BIOLOGY', name: 'PhD Molecular Biology', level: 'DOCTORAL', years: 3, months: 36, scope: 'UNIVERSITY_CATALOGUE', source: 'bms', sourceTitle: 'Ph. D (Molecular Biology)', note: 'Duration is the one published on the programme page; the current regulations were not read.' },
  { key: 'MSPH', name: 'Master of Science in Public Health', level: 'MASTERS', years: 2, months: 24, scope: 'UNIVERSITY_CATALOGUE', source: 'dph', sourceTitle: 'Master of Science in Public Health (MSPH) – 2 Years degree program' },
  { key: 'MHPE', name: 'Master of Health Professions Education', level: 'MASTERS', years: 2, months: 24, scope: 'UNIVERSITY_CATALOGUE', source: 'bms', sourceTitle: 'MHPE (Master of Health Professions Education)' },
  { key: 'CHPE', name: 'Certificate in Health Professions Education', level: 'CERTIFICATE', years: null, months: 6, scope: 'UNIVERSITY_CATALOGUE', source: 'bms', sourceTitle: 'CHPE (06 Months)' },
  // University-wide postgraduate residency catalogue (no institution offering is created: training-site approval is not established)
  ...pgSpec('POSTGRADUATE_RESIDENCY', 'MD', [['ANESTHESIA', 'Anesthesia'], ['CARDIOLOGY', 'Cardiology'], ['CRITICAL_CARE_MEDICINE', 'Critical Care Medicine'], ['DERMATOLOGY', 'Dermatology'], ['EMERGENCY_MEDICINE', 'Emergency Medicine'], ['GASTROENTEROLOGY', 'Gastroenterology'], ['HISTOPATHOLOGY', 'Histopathology'], ['INTERNAL_MEDICINE', 'Internal Medicine'], ['NEONATOLOGY', 'Neonatology'], ['NEPHROLOGY', 'Nephrology'], ['NEUROLOGY', 'Neurology'], ['PAEDIATRIC_HAEMATOLOGY_ONCOLOGY', 'Paediatric Haematology and Oncology'], ['PAEDIATRIC_MEDICINE', 'Paediatric Medicine'], ['PSYCHIATRY', 'Psychiatry'], ['PULMONOLOGY', 'Pulmonology'], ['RADIOLOGY', 'Radiology'], ['RHEUMATOLOGY', 'Rheumatology']], 'postgraduate'),
  ...pgSpec('POSTGRADUATE_RESIDENCY', 'MS', [['BURN_SURGERY', 'Burn Surgery'], ['CARDIAC_SURGERY', 'Cardiac Surgery'], ['ENT', 'ENT'], ['GENERAL_SURGERY', 'General Surgery'], ['NEUROSURGERY', 'Neurosurgery'], ['OBSTETRICS_GYNAECOLOGY', 'Obstetrics and Gynaecology'], ['OPHTHALMOLOGY', 'Ophthalmology'], ['ORTHOPAEDIC_SURGERY', 'Orthopaedic Surgery'], ['PAEDIATRIC_SURGERY', 'Paediatric Surgery'], ['PLASTIC_SURGERY', 'Plastic Surgery'], ['UROLOGY', 'Urology']], 'postgraduate'),
  ...pgSpec('POSTGRADUATE_RESIDENCY', 'MDS', [['OPERATIVE_DENTISTRY', 'Operative Dentistry'], ['ORAL_MAXILLOFACIAL_SURGERY', 'Oral and Maxillofacial Surgery'], ['ORTHODONTICS', 'Orthodontics'], ['PAEDIATRIC_DENTISTRY', 'Paediatric Dentistry'], ['PROSTHODONTICS', 'Prosthodontics']], 'postgraduate'),
];

export interface OfferingDef { program: string; seats: number | Partial<Record<'MORNING' | 'EVENING', number>> | null; stopped?: boolean }
export interface ClaimDef { type: string; text: string; source: SourceKey; status: 'VERIFIED' | 'UNRESOLVED' | 'DISCREPANCY'; session?: string; entity?: 'INSTITUTION' | 'RELATIONSHIP' | 'RESTRICTION' }
export interface InstitutionDef {
  key: string; code: string; name: string; abbreviation?: string; sector: 'PUBLIC' | 'PRIVATE' | null; affiliation: 'CONSTITUENT' | 'AFFILIATED'; kind?: 'INSTITUTION' | 'ACADEMIC_UNIT';
  type: string; city: string; region: string; campusLabel?: string; group: 'CONSTITUENT' | 'GOVERNMENT' | 'PRIVATE' | 'UNIT'; offerings: OfferingDef[]; claims?: ClaimDef[];
}
const ICT = 'Islamabad Capital Territory'; const AJK = 'Azad Jammu and Kashmir';
const o = (program: string, seats: OfferingDef['seats'], stopped = false): OfferingDef => ({ program, seats, ...(stopped ? { stopped } : {}) });
const SH = (m: number, e: number) => ({ MORNING: m, EVENING: e });
const c = (type: string, text: string, source: SourceKey, status: ClaimDef['status'] = 'VERIFIED', extra: Partial<ClaimDef> = {}): ClaimDef => ({ type, text, source, status, ...extra });
const NA = 'The official page lists this institution with no programme or seat table; no programme is attached until one is verified.';

export const INSTITUTIONS: InstitutionDef[] = [
  // ── Group A: constituent entries ──
  { key: 'college-of-medical-technology', code: 'SZ-A01', name: 'College of Medical Technology', sector: 'PUBLIC', affiliation: 'CONSTITUENT', type: 'ALLIED_HEALTH', city: 'Islamabad', region: ICT, group: 'CONSTITUENT',
    offerings: [o('BS_ANESTHESIA', 25), o('BS_MLT', 25), o('BS_VISION', 25), o('BS_RADIOGRAPHY_IMAGING', 25), o('BS_DENTAL_TECH', 25), o('BS_CARDIOVASCULAR_SCIENCES', 25)],
    claims: [c('PIMS_ASSOCIATION', 'The SZABMU Allied Health Sciences admission page names this college as "College of Medical Technology, PIMS" (Public Sector).', 'ahs', 'VERIFIED', { entity: 'RELATIONSHIP' })] },
  { key: 'college-of-nursing', code: 'SZ-A02', name: 'College of Nursing', sector: 'PUBLIC', affiliation: 'CONSTITUENT', type: 'NURSING_COLLEGE', city: 'Islamabad', region: ICT, group: 'CONSTITUENT', offerings: [o('BSN_POST_RN', 50), o('BSN_GENERIC', 50)],
    claims: [c('SEPARATE_IDENTITY', 'Kept separate from "School of Nursing": the official page lists them as two entries with different programmes.', 'institutes', 'VERIFIED', { entity: 'RELATIONSHIP' })] },
  { key: 'federal-medical-college-islamabad', code: 'SZ-A03', name: 'Federal Medical College, Islamabad', sector: 'PUBLIC', affiliation: 'CONSTITUENT', type: 'MEDICAL_COLLEGE', city: 'Islamabad', region: ICT, group: 'CONSTITUENT', offerings: [o('MBBS', 100)] },
  { key: 'pakistan-institute-of-medical-sciences', code: 'SZ-A04', name: 'Pakistan Institute of Medical Sciences', abbreviation: 'PIMS', sector: 'PUBLIC', affiliation: 'CONSTITUENT', type: 'TEACHING_HOSPITAL', city: 'Islamabad', region: ICT, group: 'CONSTITUENT', offerings: [],
    claims: [c('NO_PROGRAMME_TABLE', NA + ' Clinical-training relationships and postgraduate specialties are not assigned to PIMS automatically.', 'institutes', 'UNRESOLVED', { entity: 'RELATIONSHIP' })] },
  { key: 'school-of-dentistry-szabmu', code: 'SZ-A05', name: 'School of Dentistry, SZABMU', sector: 'PUBLIC', affiliation: 'CONSTITUENT', type: 'DENTAL_COLLEGE', city: 'Islamabad', region: ICT, group: 'CONSTITUENT', offerings: [o('BDS', 50)],
    claims: [c('PLANNED_INTAKE_MENTION', 'Some descriptive school material mentions a planned 100-seat intake (from the supplied brief; not re-verified). The directory allocation of 50 is kept unless a newer applicable approval establishes a change.', 'brief', 'UNRESOLVED', { entity: 'RESTRICTION' })] },
  { key: 'school-of-nursing', code: 'SZ-A06', name: 'School of Nursing', sector: 'PUBLIC', affiliation: 'CONSTITUENT', type: 'NURSING_SCHOOL', city: 'Islamabad', region: ICT, group: 'CONSTITUENT', offerings: [o('BSN_GENERIC', 50)] },
  // ── Group B: government-sector affiliates ──
  { key: 'capital-hospital-islamabad', code: 'SZ-B01', name: 'Capital Hospital, Islamabad', sector: 'PUBLIC', affiliation: 'AFFILIATED', type: 'HOSPITAL', city: 'Islamabad', region: ICT, group: 'GOVERNMENT', offerings: [],
    claims: [c('NO_PROGRAMME_TABLE', NA, 'institutes', 'UNRESOLVED', { entity: 'RELATIONSHIP' })] },
  { key: 'college-of-medical-lab-technology-nih', code: 'SZ-B02', name: 'College of Medical Lab Technology, NIH Islamabad', sector: 'PUBLIC', affiliation: 'AFFILIATED', type: 'ALLIED_HEALTH', city: 'Islamabad', region: ICT, group: 'GOVERNMENT', offerings: [o('BS_MLT', 30)],
    claims: [c('SEPARATE_IDENTITY', 'Kept separate from the PIMS College of Medical Technology.', 'institutes', 'VERIFIED', { entity: 'RELATIONSHIP' })] },
  { key: 'federal-government-polyclinic-islamabad', code: 'SZ-B03', name: 'Federal Government Polyclinic, Islamabad', sector: 'PUBLIC', affiliation: 'AFFILIATED', type: 'HOSPITAL', city: 'Islamabad', region: ICT, group: 'GOVERNMENT', offerings: [o('BSN_GENERIC', 50)],
    claims: [c('PNMC_LISTS_MORE', 'PNMC lists "F.G Polyclinic Hospital SON" with Generic BSN and BSN (Post RN); SZABMU lists only Generic BSN (50). Only the SZABMU offering is recorded. Postgraduate (CPSP FCPS/MCPS) training needs its own awarding-body representation and is not verified.', 'pnmc', 'DISCREPANCY', { entity: 'RELATIONSHIP' })] },
  { key: 'national-institute-of-rehabilitation-medicine', code: 'SZ-B04', name: 'National Institute of Rehabilitation Medicine (NIRM), Islamabad', abbreviation: 'NIRM', sector: 'PUBLIC', affiliation: 'AFFILIATED', type: 'REHABILITATION_INSTITUTE', city: 'Islamabad', region: ICT, group: 'GOVERNMENT', offerings: [o('PGD_SPEECH_LANGUAGE_THERAPY', 25)],
    claims: [c('SEPARATE_IDENTITY', 'Kept distinct from the SZABMU Institute of Rehabilitation Sciences.', 'institutes', 'VERIFIED', { entity: 'RELATIONSHIP' })] },
  // ── Group C: private-sector affiliates ──
  { key: 'advance-institute-of-health-sciences', code: 'SZ-C01', name: 'Advance Institute of Health Sciences, Islamabad', sector: 'PRIVATE', affiliation: 'AFFILIATED', type: 'HEALTH_SCIENCES_INSTITUTE', city: 'Islamabad', region: ICT, group: 'PRIVATE',
    offerings: [o('DPT', 25), o('BS_DENTAL_TECH', 25), o('BS_MLT', 25), o('BS_RADIOGRAPHY_IMAGING', 25), o('BSN_GENERIC', 50)] },
  { key: 'aman-medical-institute', code: 'SZ-C02', name: 'Aman Medical Institute, Islamabad', sector: 'PRIVATE', affiliation: 'AFFILIATED', type: 'HEALTH_SCIENCES_INSTITUTE', city: 'Islamabad', region: ICT, group: 'PRIVATE', offerings: [o('BSN_GENERIC', 50), o('DPT', 25, true)] },
  { key: 'bashir-college-of-dentistry', code: 'SZ-C03', name: 'Bashir College of Dentistry, Islamabad', sector: 'PRIVATE', affiliation: 'AFFILIATED', type: 'DENTAL_COLLEGE', city: 'Islamabad', region: ICT, group: 'PRIVATE', offerings: [o('BDS', 50)],
    claims: [c('SESSION_ADMISSION_CONDITION', 'PM&DC\'s published record reviewed during research mentions admissions allowed for 2026-27 under the court order dated 7 October 2026, W.P. No. 5204/2026. Session-specific, not an indefinite approval. The PM&DC page loads its list dynamically, so this could not be re-verified here.', 'brief', 'UNRESOLVED', { entity: 'RESTRICTION', session: '2026-27' })] },
  { key: 'bashir-institute-of-health-sciences', code: 'SZ-C04', name: 'Bashir Institute of Health Sciences, Islamabad', sector: 'PRIVATE', affiliation: 'AFFILIATED', type: 'HEALTH_SCIENCES_INSTITUTE', city: 'Islamabad', region: ICT, group: 'PRIVATE',
    offerings: [o('DPT', 25), o('BS_ANESTHESIA', 25), o('BS_CARDIAC_PERFUSION', 25), o('BS_DENTAL_TECH', 25), o('BS_EMERGENCY_CLINICAL_MEDICINE', 25), o('BS_MLT', 25), o('BS_VISION', 25), o('BS_RADIOGRAPHY_IMAGING', 25), o('BS_SURGICAL_TECH', 25), o('BSN_GENERIC', 50), o('BSN_POST_RN', 50)],
    claims: [c('RELATED_NAME_UNRESOLVED', 'PNMC lists "Bashir Institute of Nursing" (Federal, Islamabad, Private, Generic BSN and Post RN BSN) as a separate recognised institute. Its organisational relationship to Bashir Institute of Health Sciences is not established, so no separate institution is created and the records are not merged.', 'pnmc', 'UNRESOLVED', { entity: 'RELATIONSHIP' })] },
  { key: 'dakson-institute-of-health-sciences', code: 'SZ-C05', name: 'DAKSON Institute of Health Sciences, Islamabad', sector: 'PRIVATE', affiliation: 'AFFILIATED', type: 'HEALTH_SCIENCES_INSTITUTE', city: 'Islamabad', region: ICT, group: 'PRIVATE', offerings: [o('DPT', 25), o('BSN_GENERIC', 50)],
    claims: [c('NAMED_UNIT', 'The official entry names "Nazar College of Physiotherapy, DAKSON Institute of Health Sciences, Islamabad" beside the DPT row; the name is associated with the DPT offering only. The nursing offering is not assigned to that unit by inference.', 'institutes', 'VERIFIED', { entity: 'RELATIONSHIP' })] },
  { key: 'fellow-college-of-professional-studies', code: 'SZ-C06', name: 'Fellow College of Professional Studies, Islamabad', sector: 'PRIVATE', affiliation: 'AFFILIATED', type: 'COLLEGE', city: 'Islamabad', region: ICT, group: 'PRIVATE', offerings: [o('BSN_GENERIC', 50)] },
  { key: 'ghazala-akram-college-of-nursing', code: 'SZ-C07', name: 'Ghazala Akram College of Nursing, Mirpur, AJK', sector: 'PRIVATE', affiliation: 'AFFILIATED', type: 'NURSING_COLLEGE', city: 'Mirpur', region: AJK, group: 'PRIVATE', offerings: [o('BSN_GENERIC', 50)] },
  { key: 'hbs-medical-and-dental-college', code: 'SZ-C08', name: 'HBS Medical & Dental College, Islamabad', sector: 'PRIVATE', affiliation: 'AFFILIATED', type: 'MEDICAL_DENTAL_COLLEGE', city: 'Islamabad', region: ICT, group: 'PRIVATE',
    offerings: [o('MBBS', 150), o('BDS', 75), o('DPT', 25), o('BS_ANESTHESIA', 25), o('BS_DENTAL_TECH', 25), o('BS_MLT', 25), o('BS_VISION', 25), o('BS_RADIOGRAPHY_IMAGING', 25), o('BSN_GENERIC', SH(100, 100)), o('BSN_POST_RN', 50)] },
  { key: 'institute-of-health-and-management-sciences', code: 'SZ-C09', name: 'Institute of Health & Management Sciences, Islamabad', sector: 'PRIVATE', affiliation: 'AFFILIATED', type: 'HEALTH_SCIENCES_INSTITUTE', city: 'Islamabad', region: ICT, group: 'PRIVATE', offerings: [o('DPT', 25, true)] },
  { key: 'islamabad-medical-and-dental-college', code: 'SZ-C10', name: 'Islamabad Medical & Dental College, Islamabad', abbreviation: 'IMDC', sector: 'PRIVATE', affiliation: 'AFFILIATED', type: 'MEDICAL_DENTAL_COLLEGE', city: 'Islamabad', region: ICT, group: 'PRIVATE',
    offerings: [o('MBBS', 100), o('BDS', 50), o('DPT', 50), o('BSN_GENERIC', 55), o('BS_MLT', 25), o('BS_ANESTHESIA', 25), o('BS_DENTAL_TECH', 25), o('BS_RADIOGRAPHY_IMAGING', 25), o('BSN_POST_RN', 30)],
    claims: [c('RELATED_NAME_UNRESOLVED', '"Islamabad Nursing College" appears as its own entry in the SZABMU Quality Enhancement Cell list and in PNMC (as "Islamabad Nursing College (Medical and Dental Collage Islamabad)"). Whether it is an academic unit of IMDC or a separate institution is not established, so no extra institution is created.', 'qec', 'UNRESOLVED', { entity: 'RELATIONSHIP' })] },
  { key: 'khyber-pakhtunkhwa-institute-of-medical-sciences', code: 'SZ-C11', name: 'Khyber Pakhtunkhwa Institute of Medical Sciences, Islamabad', sector: 'PRIVATE', affiliation: 'AFFILIATED', type: 'HEALTH_SCIENCES_INSTITUTE', city: 'Islamabad', region: ICT, group: 'PRIVATE', offerings: [o('BSN_GENERIC', 50)],
    claims: [c('LOCATION_NOTE', 'The official entry places it in Islamabad; the institution\'s name does not establish a Khyber Pakhtunkhwa location.', 'institutes', 'VERIFIED', { entity: 'INSTITUTION' })] },
  { key: 'kulsum-institute-of-health-sciences', code: 'SZ-C12', name: 'Kulsum Institute of Health Sciences, Islamabad', sector: 'PRIVATE', affiliation: 'AFFILIATED', type: 'HEALTH_SCIENCES_INSTITUTE', city: 'Islamabad', region: ICT, group: 'PRIVATE', offerings: [o('DPT', 25), o('BS_MLT', 25), o('BSN_GENERIC', 50), o('BSN_POST_RN', 50, true)] },
  { key: 'midwest-institute-of-sciences', code: 'SZ-C13', name: 'Midwest Institute of Sciences, Islamabad', sector: 'PRIVATE', affiliation: 'AFFILIATED', type: 'HEALTH_SCIENCES_INSTITUTE', city: 'Islamabad', region: ICT, group: 'PRIVATE', offerings: [o('DPT', 25), o('BSN_GENERIC', 100), o('BS_MLT', 25), o('BS_RADIOGRAPHY_IMAGING', 25), o('BS_ANESTHESIA', 25)] },
  { key: 'mirpur-institute-of-medical-sciences', code: 'SZ-C14', name: 'Mirpur Institute of Medical Sciences, Mirpur AJK', sector: 'PRIVATE', affiliation: 'AFFILIATED', type: 'HEALTH_SCIENCES_INSTITUTE', city: 'Mirpur', region: AJK, group: 'PRIVATE', offerings: [o('BS_DENTAL_TECH', 35)],
    claims: [c('SEPARATE_IDENTITY', 'Kept separate from Ghazala Akram College of Nursing (also Mirpur).', 'institutes', 'VERIFIED', { entity: 'RELATIONSHIP' })] },
  { key: 'ncs-institute-of-sciences-quaid-e-azam-campus', code: 'SZ-C15', name: 'NCS Institute of Sciences, Quaid-e-Azam Campus, Islamabad', sector: 'PRIVATE', affiliation: 'AFFILIATED', type: 'HEALTH_SCIENCES_INSTITUTE', city: 'Islamabad', region: ICT, campusLabel: 'Quaid-e-Azam Campus', group: 'PRIVATE', offerings: [o('BSN_GENERIC', 40)],
    claims: [c('CAMPUS_SCOPE', 'The affiliation evidence names the Quaid-e-Azam Campus only; it is not extended to any other NCS campus.', 'institutes', 'VERIFIED', { entity: 'RELATIONSHIP' })] },
  { key: 'nova-institute-of-modern-studies', code: 'SZ-C16', name: 'Nova Institute of Modern Studies, Islamabad', sector: 'PRIVATE', affiliation: 'AFFILIATED', type: 'INSTITUTE', city: 'Islamabad', region: ICT, group: 'PRIVATE', offerings: [o('BSN_GENERIC', 80), o('BSN_POST_RN', 25), o('BS_MLT', 25)] },
  { key: 'pace-and-kedge-institute-of-health-sciences', code: 'SZ-C17', name: 'PACE and KEDGE Institute of Health Sciences, Islamabad', sector: 'PRIVATE', affiliation: 'AFFILIATED', type: 'HEALTH_SCIENCES_INSTITUTE', city: 'Islamabad', region: ICT, group: 'PRIVATE', offerings: [o('BSN_POST_RN', 50), o('BSN_GENERIC', 75), o('BS_MLT', 25)] },
  { key: 'phr-institute-of-health-sciences', code: 'SZ-C18', name: 'PHR Institute of Health Sciences, Islamabad', sector: 'PRIVATE', affiliation: 'AFFILIATED', type: 'HEALTH_SCIENCES_INSTITUTE', city: 'Islamabad', region: ICT, group: 'PRIVATE', offerings: [o('DPT', 25), o('BSN_GENERIC', 50)] },
  { key: 'prime-institute-of-health-sciences', code: 'SZ-C19', name: 'Prime Institute of Health Sciences, Islamabad', sector: 'PRIVATE', affiliation: 'AFFILIATED', type: 'HEALTH_SCIENCES_INSTITUTE', city: 'Islamabad', region: ICT, group: 'PRIVATE', offerings: [o('BS_ANESTHESIA', 25), o('BS_MLT', 25), o('BS_RADIOGRAPHY_IMAGING', 25), o('BS_SURGICAL_TECH', 25)] },
  { key: 'rawal-institute-of-health-sciences', code: 'SZ-C20', name: 'Rawal Institute of Health Sciences, Islamabad', sector: 'PRIVATE', affiliation: 'AFFILIATED', type: 'HEALTH_SCIENCES_INSTITUTE', city: 'Islamabad', region: ICT, group: 'PRIVATE',
    offerings: [o('MBBS', 100), o('BDS', 75), o('DPT', 40), o('BSN_GENERIC', SH(100, 100)), o('BSN_POST_RN', 40)],
    claims: [c('RELATED_NAME_UNRESOLVED', '"Rawal College of Nursing" appears in the SZABMU Quality Enhancement Cell list; it was not found in the PNMC list fetched here. Its organisational relationship to Rawal Institute of Health Sciences is not established, so no separate institution is created.', 'qec', 'UNRESOLVED', { entity: 'RELATIONSHIP' })] },
  // ── University academic units (kind = ACADEMIC_UNIT): verified from the programme pages, no address or contact invented ──
  { key: 'unit-institute-of-rehabilitation-sciences', code: 'SZ-U01', name: 'Institute of Rehabilitation Sciences (IRS), SZABMU', abbreviation: 'IRS', sector: null, affiliation: 'CONSTITUENT', kind: 'ACADEMIC_UNIT', type: 'INSTITUTE', city: 'Islamabad', region: ICT, group: 'UNIT', offerings: [o('DPT', null)],
    claims: [c('UNIT_SOURCE', 'The SZABMU DPT admission page states that the Institute of Rehabilitation Sciences (IRS), SZAB Medical University is offering Doctor of Physical Therapy; a curriculum (IRS-DPT.pdf) is linked. Seats are not published there.', 'dpt', 'VERIFIED', { entity: 'RELATIONSHIP' })] },
  { key: 'unit-department-of-public-health', code: 'SZ-U02', name: 'Department of Public Health, SZABMU', sector: null, affiliation: 'CONSTITUENT', kind: 'ACADEMIC_UNIT', type: 'INSTITUTE', city: 'Islamabad', region: ICT, group: 'UNIT', offerings: [o('MSPH', null)] },
  { key: 'unit-health-professions-education', code: 'SZ-U03', name: 'Health Professions Education, SZABMU', sector: null, affiliation: 'CONSTITUENT', kind: 'ACADEMIC_UNIT', type: 'INSTITUTE', city: 'Islamabad', region: ICT, group: 'UNIT', offerings: [o('MHPE', null), o('CHPE', null)],
    claims: [c('UNIT_NAME', 'Named "Health Professions Education" on the programme page that lists MHPE and CHPE; the exact organisational name was not found on a dedicated page.', 'bms', 'UNRESOLVED', { entity: 'RELATIONSHIP' })] },
  { key: 'unit-basic-medical-sciences', code: 'SZ-U04', name: 'Basic Medical Sciences (Non Clinical), SZABMU', sector: null, affiliation: 'CONSTITUENT', kind: 'ACADEMIC_UNIT', type: 'INSTITUTE', city: 'Islamabad', region: ICT, group: 'UNIT',
    offerings: ['MPHIL_CHEMICAL_PATHOLOGY', 'MPHIL_HAEMATOLOGY', 'MPHIL_HISTOPATHOLOGY', 'MPHIL_MICROBIOLOGY', 'MPHIL_PHYSIOLOGY', 'MPHIL_PHARMACOLOGY', 'MPHIL_MOLECULAR_BIOLOGY', 'PHD_MOLECULAR_BIOLOGY'].map((k) => o(k, null)),
    claims: [c('HISTORICAL_LISTINGS', 'The programme page lists Chemical Pathology and Haematology (and Histopathology, Microbiology) beside the current programmes. The supplied brief calls Chemical Pathology and Haematology "historical"; no source here says which are admitting in the current session, so intake is left as not configured.', 'bms', 'UNRESOLVED', { entity: 'RELATIONSHIP' })] },
];

/** Historical or related names the brief mentions that the current official institute list does not contain. Reported, never imported as active. */
export const HISTORICAL_NAMES: { name: string; text: string }[] = [
  { name: 'Yusra Institute of Rehabilitation Sciences', text: 'Mentioned in the brief as a historical listing; not present in the current official institute list (checked 2026-11-06). Any existing linked student record is preserved.' },
  { name: 'Islamabad Institute of Health Sciences', text: 'Mentioned in the brief as a historical listing; not present in the current official institute list (checked 2026-11-06). Any existing linked student record is preserved.' },
];

/** Official curriculum documents located on the curriculums page, mapped to a programme key only where the match is unambiguous. */
export const CURRICULUM_PROGRAM: Record<string, string | null> = {
  'MBBS-1-2-years.pdf': 'MBBS', 'MBBS-3-year.pdf': 'MBBS', 'BDS-1st-year.pdf': 'BDS', 'BDS-2nd-year.pdf': 'BDS', 'BDS-3rd-year.pdf': 'BDS', 'IRS-DPT.pdf': 'DPT',
  'MDS-OMFS.pdf': 'MDS_ORAL_MAXILLOFACIAL_SURGERY', 'MDS-Pead-Dentistry.pdf': 'MDS_PAEDIATRIC_DENTISTRY', 'MDS-Operative-Dentistry.pdf': 'MDS_OPERATIVE_DENTISTRY', 'MDS-Prosthodontics.pdf': 'MDS_PROSTHODONTICS', 'MDS-Orthodontics.pdf': 'MDS_ORTHODONTICS',
  'MS-general-surgery.pdf': 'MS_GENERAL_SURGERY', 'MS-neurosurgery.pdf': 'MS_NEUROSURGERY', 'MS-ophthalmology.pdf': 'MS_OPHTHALMOLOGY', 'MS-orthopaedic.pdf': 'MS_ORTHOPAEDIC_SURGERY', 'MS-gynae-obs.pdf': 'MS_OBSTETRICS_GYNAECOLOGY', 'MS-plastic-surgery.pdf': 'MS_PLASTIC_SURGERY',
  'MS-burns-surgery.pdf': 'MS_BURN_SURGERY', 'MS-Cardiac-Surgery.pdf': 'MS_CARDIAC_SURGERY', 'MS-urology.pdf': 'MS_UROLOGY', 'MS-paed-surgery.pdf': 'MS_PAEDIATRIC_SURGERY', 'MS-ent.pdf': 'MS_ENT',
  'MD-CCM.pdf': 'MD_CRITICAL_CARE_MEDICINE', 'MD-Cardiology.pdf': 'MD_CARDIOLOGY', 'MD-Dermatology.pdf': 'MD_DERMATOLOGY', 'MD-Gastro.pdf': 'MD_GASTROENTEROLOGY', 'MD-Histopathology.pdf': 'MD_HISTOPATHOLOGY', 'MD-Internal-medicine.pdf': 'MD_INTERNAL_MEDICINE',
  'MD-Nephrology.pdf': 'MD_NEPHROLOGY', 'MD-Neanotology.pdf': 'MD_NEONATOLOGY', 'MD-Neurology.pdf': 'MD_NEUROLOGY', 'MD-pediatric-medicine.pdf': 'MD_PAEDIATRIC_MEDICINE', 'MD-Psychiatry.pdf': 'MD_PSYCHIATRY', 'MD-PULMONOLOGY.pdf': 'MD_PULMONOLOGY',
  'MD-Radiology.pdf': 'MD_RADIOLOGY', 'MD-Rhematology.pdf': 'MD_RHEUMATOLOGY', 'MD-Emergency-Medicine.pdf': 'MD_EMERGENCY_MEDICINE', 'MD-Anesthesia.pdf': 'MD_ANESTHESIA', 'MD-paeds-haem.pdf': 'MD_PAEDIATRIC_HAEMATOLOGY_ONCOLOGY',
  'PhD-Molecular-Biology-curriculum.pdf': 'PHD_MOLECULAR_BIOLOGY', 'MPhil-Molecular-Biology-curriculum.pdf': 'MPHIL_MOLECULAR_BIOLOGY', 'MSPH.pdf': 'MSPH', 'CHPE.pdf': 'CHPE',
  // listed on the curriculums page but not a programme in the supplied catalogue / admission pages: kept as documents with no programme link
  'Mphil-Dental-Materials.pdf': null, 'Mphil-community-dentistry.pdf': null, 'MSC-Oral-Medicine.pdf': null, 'MSC-Periodontology.pdf': null, 'DHRB.pdf': null, 'BMS.pdf': null,
};
