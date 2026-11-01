# 15 — Feature completion matrix

Legend: VW=VERIFIED_WORKING (demonstrated today by test run or live probe) · PW=PARTIALLY_WORKING · UI=UI_ONLY · MD=MOCK_DATA · BR=BROKEN · NI=NOT_IMPLEMENTED · NT=NOT_TESTED. No feature is classed UI_ONLY or MOCK_DATA: every page binds to a real endpoint (grep for mock/placeholder markers: none).

| # | Feature | Frontend | Backend | DB | Evidence (TODAY) | Status |
|---|---|---|---|---|---|---|
| 1 | Sign-in / sign-out / session | `login/page.tsx` | `auth/login, logout, me` | `sessions` | e2e ×3, auth tests | VW |
| 2 | Password recovery | `forgot/` | `auth/forgot, verify-code, reset` | `password_resets` | e2e PASS | VW |
| 3 | Staff TOTP MFA + recovery codes | `mfa/`, profile card | `auth/mfa/*` | `users`, `mfa_recovery_codes` | 10 tests + e2e | VW (forced-enrol screen API-tested only) |
| 4 | Institution/department/program/course admin | `institutions`, `programs` | `org` | yes | tests | PW (UI paths not browser-tested) |
| 5 | User & student provisioning, bulk import | `users`, `students` | `org` | yes | e2e add student; API tests | PW (import UI NT) |
| 6 | Enrolment & attendance % | `enrolment` | `enrollments/*` | `enrollments` | tests | PW (attendance = course %, not exam-day) |
| 7 | Lecturer↔course assignments | `assignments` | `course-assignments` | `course_assignments` | 13 tests + e2e | VW |
| 8 | Question authoring (MCQ) | `questions` | `questions` | `questions, question_options` | e2e lecturer flow | VW |
| 9 | Question review/approval (SoD) | `questions` | `questions/:id/review` | | e2e | VW |
| 10 | Question images/attachments | – | – | no field | schema | **NI** |
| 11 | Non-MCQ types / manual grading / rubrics | – | – | enum only | source | **NI** |
| 12 | Paper build + approval (SoD) | `exams/[id]` | `exams/:id/paper*` | `exam_questions` (frozen snapshot) | workflow test | VW (API); no browser spec |
| 13 | Exam create/schedule/cancel | `exams`, `exams/[id]` | `exams` | | workflow test | VW (API) |
| 14 | Roster versions + admission overrides | `exams/[id]` | `exams/:id/roster*, override` | `exam_roster_versions, eligibility_overrides` | 15 tests + e2e | VW |
| 15 | Student schedule + eligibility display | `schedule` | `me/exams` | | e2e | VW |
| 16 | Exam player (navigation, skip, mark, clear, palette, filters) | `exam/[id]` | `attempts/*` | `attempt_answers` | 4 e2e + engine tests | VW |
| 17 | Durable save / revision / multi-tab / offline | same | `saveAnswer` CTE | `answer_events` | e2e + fault | VW |
| 18 | Server timer, clock-manipulation resistance | same | DB clock | | e2e | VW |
| 19 | Submit, receipt, idempotency | same | `finalize` | | engine, contention | VW |
| 20 | Auto-submit at deadline | – | sweeper `tick` | | e2e deadline spec | VW (sweeper up); **NT with sweeper down** |
| 21 | Live monitor | `monitor/[id]` | `invigilation/exams/:id/monitor` | | probe 200, scoped rows | PW (polling; not load-tested; spec blocked by MFA pollution) |
| 22 | Per-candidate time extension | `+ Time` | `invigilation/attempts/:id/extend` | | API tests | PW |
| 23 | Force-submit | button | `force-submit` | | API tests | PW |
| 24 | **Suspend / resume / open / close / exam-wide extension** | – | – | – | 404 probes | **NI** |
| 25 | Incidents (report/notes/resolve) | `incidents` | `incidents` | | tests | VW |
| 26 | Exam-day attendance, rooms, seats | – | – | none | schema | **NI** |
| 27 | Auto grading (MCQ, negative marking, key actions) | `results` | `results.service`, queue | `results, key_actions` | workflow | VW |
| 28 | Result approval → publication → certificates | `results` | `results/exams/:id/*` | `result_batches, certificates` | workflow | VW (API) |
| 29 | Post-publication correction | – | – | – | source | **NI** |
| 30 | Student result view / certificate / public verify | `results, certificate, verify` | `me/results, public/verify` | | tests; e2e rejects unknown serial | PW |
| 31 | Campus results (published only) | `results` | `results/exams/:id` | | probes (pre-publish 403) | PW (post-publish NT in browser) |
| 32 | CSV export | link | `reports/exams/:id/csv` | | tests | VW; no PDF (NI) |
| 33 | Reports/dashboard | `dashboard`, `performance` | `reports/*`, `dashboard` | | loads; **D-09** | PW |
| 34 | Notifications (in-app + email outbox) | bell | `notifications*` | `notifications, outbound_messages` | loads | PW (dead deep links; no broadcast UI) |
| 35 | Audit log + chain verification | `audit` | `audit`, `audit/verify` | `audit_logs` | e2e PASS | VW |
| 36 | Metrics/alerts | – | `/api/metrics`, alerts.yml | | 8 tests | PW (alerts never fired) |
| 37 | Backup + verified restore | – | `scripts/db-backup.mjs` | | 3 tests | VW (manual only) |
| 38 | Mobile/tablet staff UI | – | – | | screenshots | PW (U-1/U-2) |
| 39 | Accessibility | – | – | | partial automated checks | NT |
