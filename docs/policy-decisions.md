# Institutional policy decisions requiring approval

The platform implements the **defaults** below so that it works end to end in development. Each default is a *proposal* and must be
approved (or changed) by the named authority before production use. IDs are referenced in code comments.

| ID | Decision | Implemented default | Approving authority | Where in code |
| --- | --- | --- | --- | --- |
| P-01 | Examiner vs. CCE responsibilities | Examiner builds/approves papers and gives first result approval (university-wide); CCE publishes. **Both are university-wide roles.** | Vice Chancellor / CCE | `packages/shared/src/permissions.ts` |
| P-02 | Single role per account | One role per user; staff holding two roles need two accounts | Registrar / IT | `users.role` |
| P-03 | Password policy | ≥10 chars, 3 of 4 character classes, no common words/own name, last 5 not reusable, 5 failed logins ⇒ 15-min lock, session TTL 12 h | Information Security Officer | `shared/password.ts`, `auth.service.ts` |
| P-04 | Two-factor authentication | **Not implemented.** Deck shows SMS 2FA on profile. Needs SMS/TOTP provider decision. Recovery OTP is email-only | IT / Security | — |
| P-05 | Save grace period at deadline | 5 s after the server deadline in-flight saves are still accepted; later writes rejected | CCE | `SAVE_GRACE_SECONDS` |
| P-06 | Eligibility threshold | **75 % attendance** ⇒ `ELIGIBLE`; below ⇒ `INELIGIBLE`; only CCE/Super Admin may condone (with written note) | Academic Council | `ATTENDANCE_THRESHOLD` |
| P-07 | Question ownership | Questions belong to the authoring institution; lecturers see only their campus's bank; Examiner/CCE see all. Cross-campus shared banks are *not* modelled | Academic Council | `questions.institutionId` |
| P-08 | Result visibility | Students and campus admins see **published** results only; lecturers see their campus during review; the answer key and individual responses are never released to candidates | CCE / Academic Council | `results.service.ts` |
| P-09 | Result approval chain | Lecturer review (mandatory) → Examiner approval → CCE publication; approver ≠ publisher; open incidents block approval | CCE | `results.service.ts` |
| P-10 | Question-key corrections | Only Examiner/Super Admin may void a question (full marks to all sitters) or change the key; returns batch to review; fully audited. After examiner approval no changes | Examination Board | `ResultsService.keyAction` |
| P-11 | Negative marking | Configurable per exam (0–100 % of the question's marks); default 0 | Examination Board | `exams.negativeMarking` |
| P-12 | Pass mark | Per exam (default 50 %); one threshold for the whole exam | Examination Board | `exams.passPercent` |
| P-13 | Time extension | Invigilator may add 1–60 min per candidate with reason; accommodations (extra time) set before start by campus admin | CCE | `invigilation.service.ts` |
| P-14 | Proctoring posture | Tab-hide, offline and paste events are *recorded and shown to invigilators*; **no automatic penalty**, no webcam/screen capture, no forced full-screen (accessibility, privacy) | Examination Board / Legal | `attempt_events` |
| P-15 | Late start | A candidate may start any time within the window; their own duration still applies, capped at window close | CCE | `computeDeadline` |
| P-16 | Single sitting | One attempt per candidate per exam. Re-sits require a new exam record. No "pause/resume" clock | Examination Board | `attempts unique(examId, studentId)` |
| P-17 | Certificate content & serials | Serial `SZABMU/<year>/<seq>`, public verification needs serial **and** code and reveals only masked name, exam, issue date. Wording/layout/signatories need approval; PDF generation not implemented | Registrar | `results.service.ts`, `/certificate/[id]` |
| P-18 | Data retention | Nothing is deleted. Retention periods for answers, journals, audit and incident records are undecided | Registrar / Legal | — |
| P-19 | Personal data & consent | Student DOB, phone, address, guardian contact are stored. A data-protection impact assessment and lawful-basis statement are required before real data is loaded | Legal / DPO | `students` |
| P-20 | Subjective / viva grading | **Not implemented.** Deck's manual grading of short answers is out of scope; platform is MCQ/clinical-MCQ (single best answer) only | Examination Board | — |
| P-21 | Multi-select / EMQ / image questions | Not implemented (single best answer, 4–5 options, text only) | Examination Board | `validateQuestion` |
| P-22 | Language & accessibility | English UI, Asia/Karachi display time. Urdu UI, screen-reader audit and accommodations workflow beyond extra time need decisions | Academic Council | — |
| P-23 | Outage / mass-disconnect procedure | System records everything and lets candidates continue offline-tolerant, but no *exam-wide pause or extension* tool exists yet. Procedure needed | CCE | — |
| P-24 | Roster approval | Roster versions are created and approved by the actor who schedules the exam (permission `exam.schedule`). A separate second approver (four-eyes) for rosters is **not** enforced. Decision needed | Examination Board | `ExamsService.refreshRoster` |
| P-25 | Suspending a live attempt | Only *force-submit* (audited) exists. A reversible suspension state, who may invoke it and resumption rules need approval | CCE | `ExamsService.overrideEligibility` |
| P-26 | Eligibility at admission (**decided 2026-10-31**) | Roster is built from local enrolment data; a *new* attempt is admitted only after local re-validation (student, account, assignment, revocation, window, restrictions); the decision is frozen on the attempt; manual overrides by CCE/Super Admin with mandatory reason | Controller of Examinations (user decision) | `DeliveryService.admit` |
| P-27 | Answer-key protection at rest | Keys are plaintext in PostgreSQL and in backups; protected only by access control. Options: separate `exam_keys` table with a restricted DB role; envelope encryption with a key released at grading time. Decision needed before real papers are loaded | Examination Board / IT Security | `exam_questions.correctLabel` |
| P-28 | Rate limiting during Redis outage | Auth counters fail open (availability over brute-force protection); account lockout (DB) still applies. Confirm or require fail-closed | IT Security | `RedisService.hit` |

