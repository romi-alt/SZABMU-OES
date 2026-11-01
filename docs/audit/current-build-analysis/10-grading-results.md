# 10 — Grading and results

Code: `results.service.ts`, `packages/shared` scoring, `results.controller.ts`. Tests TODAY: `workflow.test.ts`, `exam-engine.test.ts`, `course-access.test.ts` results paths, shared scoring (15) — all PASS.

| Area | Finding | Status |
|---|---|---|
| MCQ scoring | `scoreQuestion` from shared package; marks per question; `negativeMarkingFraction` per exam; unanswered/skipped score 0 | VERIFIED (unit + workflow) |
| Authoritative inputs | Grades from the **sealed attempt's answers** and the **frozen `exam_questions`** (key and snapshot), plus recorded key actions (`gradeAttempt`, `results.service.ts:18-45`) | VERIFIED by SOURCE + tests |
| Key actions | VOID question / CHANGE_KEY with mandatory reason, append-only `key_actions`, only while `RESULT_PENDING`/`CLOSED` and before approval (`:121-`); triggers `regradeExam` | VERIFIED (workflow) |
| Duplicate grading jobs | `jobId: grade-<attemptId>`; `gradeAttempt` is an upsert on `(examId, studentId)` ⇒ idempotent in value; `gradedAt` is rewritten | SAFE; no guard against touching a `PUBLISHED` batch (B5) |
| Manual grading / rubrics / grading assignments | **Not implemented** (MCQ-only; `QuestionType` enum exists but only MCQ is delivered) | NOT_IMPLEMENTED |
| Scoring versions | No versioned scoring records; key actions are the only mutation log | NOT_IMPLEMENTED |
| Absentees | tick marks absent candidates `ABSENT` with 0 once graded (`:70-76`) | VERIFIED in workflow |
| Moderation / approval | Examiner approve (`result.approve_examiner`) → CCE publish (`result.publish`), publisher ≠ approver | VERIFIED (workflow + roles) |
| Publication | One tx: batch `PUBLISHED`, exam `PUBLISHED`, certificates issued for passes with sequence serial and verify code (`:156-173`) | VERIFIED (workflow) |
| Unpublished leak | Students: `[]` before publish; campus admin: 403 on results and 404 on CSV before publish (TODAY probes + tests) | VERIFIED |
| Post-publication correction | **No path exists** to change a published result (key actions blocked, no correction endpoint). That prevents silent change but also means errors cannot be corrected formally | NOT_IMPLEMENTED (formal correction workflow) |
| Campus reports reconcile with individual results | Item analysis/CSV/report all aggregate `results` rows filtered by campus; reconciliation is not asserted by any test | NOT_TESTED |
| PDF reports / certificate | `/certificate/[id]` HTML page; public verify by serial+code, rate-limited; **no server PDF**; certificate download is browser-print | PARTIALLY_WORKING |
| Dependency on sweeper | RESULT_PENDING, absentees and the grading backstop all run inside `tick()`; if workers are not running the pipeline from CLOSED onwards does not progress (`D-02`) | RISK |

Scale note (extrapolated): `tick` grades ≤500 attempts per 10 s sequentially after the 16-way queue; the queue path is the fast path, the tick the backstop.
