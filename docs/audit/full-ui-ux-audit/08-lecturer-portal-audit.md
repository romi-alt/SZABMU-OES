# 08 — Lecturer portal

Account lecturer.a (Demo Medical College A). Evidence `evidence/lecturer/`.

**Status of reference pages:** Dashboard ✔ (thin) · My courses ✘ **MISSING REQUIRED UI** · Question bank ✔ · Manual grading ✘ **MISSING REQUIRED UI** (grading in this system is automatic MCQ scoring with a "lecturer review" step on the exam record) · Course materials ✘ **MISSING REQUIRED UI**. Lecturer-to-course authorisation is enforced (the question form offers only the two assigned courses — good) but never *shown* as a list.

| Question from the brief | Finding |
|---|---|
| Can lecturers tell which courses they may manage? | Only indirectly: the Course dropdown in the question form lists MBBS-PATH-4 and MBBS-PHARM-4. No "My courses" page; dashboard shows "Students at campus 40" instead (UI-035) |
| Assigned courses easy to find? | No dedicated place |
| Question bank filters useful? | Status (All/Draft/Submitted/Approved/Rejected/Retired), Course, free-text search. No difficulty/type/author/date filters; no counts per status; 132 rows paginated 25/page |
| Draft/Pending/Approved/Rejected understandable? | Status chips (green "Approved", etc.) fine; "Submitted" vs "Pending Review" naming differs between filter ("SUBMITTED") and dashboard chips ("submitted") — consistent; no rejection reason column |
| Locate the correct question without extra navigation? | Search by text works; results keep order newest-first |
| Question editor too complicated? | One modal 769 px tall: Course, Type (Single best answer MCQ / Clinical MCQ), Stem, five option rows each with a radio "correct" marker + text, Difficulty, Explanation. Reasonable; taller than a 768 px laptop viewport (UI-026) |
| Correct answer selection obvious? | A radio next to each option — obvious |
| Saved vs submitted clear? | **Partly**: the modal only offers "Save draft" (disabled until valid); submitting is a separate green button on the row ("Submit") that appears only for DRAFT/REJECTED — undiscoverable from inside the editor (recommendation: add "Save & submit for review") |
| Reviewer feedback easy to find? | Not observed — no rejection note visible in the list |
| Destructive actions protected? | Retire/delete not exercised; "Edit" is the only row action visible |
| Grading queues by urgency? | not applicable (no manual grading UI) |
| Validation messages | none inline; the button is disabled with no explanation (UI-026); Escape discards typed text silently |

**Other lecturer-visible screens:** `/exams` (all exams incl. drafts, with copy "Build papers, approve, schedule…" that does not apply, UI-049), `/students` (own campus), `/schedule`, `/results` (dead-end text "This page is for candidates." with no heading, UI-018), `/institutions`, `/programs` (hidden-but-reachable, UI-022). Bell: 130 unread (volume artefact of the 110-question fixture, UI-031).
