# Source verification, discrepancies and open items

Retrieved **2026-11-06** (a retrieval date is not an effective date; no approval, certificate or intake effective date was invented – every such field is `NULL`). Content hashes and URLs are stored in `directory_sources`; claims in `directory_claims`.

## Sources used

| Key | Source | Used for |
|---|---|---|
| institutes | https://www.szabmu.edu.pk/our-institutes | the 30 institution entries, groups, programme tables, seat figures, the three stopped intakes (verified live and against the committed snapshot: no differences) |
| qec | https://www.szabmu.edu.pk/qec/institutes | cross-check of institution names (Islamabad Nursing College, Rawal College of Nursing) |
| postgraduate / dpt / ahs / bms / dph | SZABMU admission and programme pages | university academic units (IRS DPT, Public Health MSPH, Health Professions Education MHPE/CHPE, Molecular Biology / BMS MPhil-PhD), MD/MS/MDS catalogue, AHS naming |
| curriculums | https://www.szabmu.edu.pk/curriculums | 49 official curriculum PDF links (documents located, **not** subjects entered) |
| news | https://www.szabmu.edu.pk/news/admission-updates | reviewed for restrictions; no change to the baseline was derived from it |
| pmdc | https://pmdc.pk/colleges | list loads dynamically – could not be machine-verified |
| pnmc | https://pnmc.gov.pk/recognized-institutes/ | nursing recognition cross-check |
| brief | supplied baseline (“checked 7 November 2026”) | everything above that the official pages confirm; items only in the brief are marked `UNRESOLVED` |

## Baseline coverage

30/30 entries present with the supplied programmes and seats: A01–A06 (6 constituent), B01–B04 (4 government affiliates), C01–C20 (20 private affiliates); HBS Medical & Dental College and Rawal Institute of Health Sciences Generic BSN = morning 100 + evening 100; stopped intakes only at Aman DPT, IHMS DPT and Kulsum Post RN BSN. Additional units: IRS (DPT), Department of Public Health (MSPH), Health Professions Education (MHPE 2 years, CHPE 6 months), Molecular Biology / BMS MPhil-PhD, and the MD/MS/MDS university catalogue (33 residency programmes).

## Discrepancies and how each was handled

1. **MBBS name** – existing programme “Bachelor of Medicine, Bachelor of Surgery” vs official “Bachelor of Medicine and Bachelor of Surgery”. Existing name kept and locked; reported on every import.
2. **F.G Polyclinic Hospital SON** – PNMC also lists BSN (Post RN); SZABMU lists only Generic BSN (50). Only the SZABMU offering is recorded; FCPS/MCPS training is not represented (needs a separate awarding body) – `DISCREPANCY` claim.
3. **Nursing school planned intake** – the brief mentions a planned 100-seat intake not found on the official page. Directory allocation (50) kept; `UNRESOLVED` claim.
4. **Bashir College of Dentistry 2026-27** – the brief cites a PM&DC court-order condition (W.P. No. 5204/2026, 7 Oct 2026). PM&DC page is dynamic, not re-verified; recorded as a session-specific `UNRESOLVED` restriction claim (visible in the institution detail), **not** applied as a block or an approval.
5. **Related names not merged** – “Bashir Institute of Nursing” (PNMC), “Islamabad Nursing College” (QEC/PNMC) and “Rawal College of Nursing” (QEC): relationship to the listed institution is not established, so no extra institution is created and nothing is merged (`RELATED_NAME_UNRESOLVED`).
6. **PIMS (A04)** – no programme table is published; no offerings are created and clinical-training / postgraduate relationships are not assigned by inference (`NO_PROGRAMME_TABLE`).
7. **Chemical Pathology / Haematology** – listed beside current BMS programmes; whether they admit in the current session is not stated. Intake left unconfigured (`UNRESOLVED`).
8. **“Health Professions Education”** – exact organisational name not found on a dedicated page (`UNRESOLVED`).
9. **Operational status** – left `UNKNOWN` for every institution: no source states it. Listing on the official page is recorded as `listingStatus = LISTED` only.

## Curriculum and postgraduate items awaiting evidence

* Subjects, credit hours and subject codes: **none entered** for any new offering. Only programmes that already had courses (the demo MBBS) show “Subjects entered”. 49 official curriculum document links are stored; a programme with a linked document and no subjects shows “Official document located; subjects not entered”, one with neither shows “No curriculum evidence”. Nothing is generated.
* Postgraduate: enrolment counts, training-site allocations, seat numbers per specialty and the CPSP awarding-body representation are not published → `NULL`/absent.
* Current admission session intake status for every programme other than the three stopped ones: not published → not configured (administrators can set it per session).
* Official identifiers, addresses, contact details, certificate numbers and approval dates: not recorded anywhere.

## What was checked in this implementation

API suite (real MariaDB): directory import (10), rollback (2), flows (13), API (10), hidden-demo (3) plus the pre-existing suites; lint, typecheck, shared and web builds; browser tests `tests/e2e/directory.spec.ts` (list/search/filter/page, detail with provenance, manager edit with confirmation + audit, campus-admin scope, phone layout, student form warning/server refusal/shift, teacher programme filtering, axe scans). See the completion report in the session summary for the final run results.
