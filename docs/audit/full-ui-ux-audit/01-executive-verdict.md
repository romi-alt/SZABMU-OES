# 01 — Executive verdict

**Scope:** every implemented route, every implemented role (7), desktop/tablet/phone, in a real browser on a disposable seeded stack (80 students, 110 questions, 7 exams in 6 states, a published result with a passing candidate and a certificate). Branch `claude/oes-platform-foundation` @ `7f4c6dd`. **No application source was changed by this audit** (the logo alignment fix requested in the same message was committed *before* the audit started as `7f4c6dd`). Nothing was deployed; the shared development database was not touched.

## Verdict in one paragraph
The portal looks professional and its **core examination loop is the strongest part**: server-confirmed autosave, offline resilience, an always-visible timer and submit button, a protected two-step submission, and a control centre with reasons, previews and clear consequences. Around that core the product is **uneven**: a primary Campus Admin page crashes for every role (UI-001), an ordinary "Deactivate" click silently rewrites an institution's affiliation (UI-002), the student's first screen shows wrong exam timing and an indirect Start path (UI-007/008), and under failing or hung networks the player can leave a candidate staring at "Saving…" or locked out of review for 20 s (UI-003/004). **52 issues: P0 0, P1 8, P2 31, P3 13.** No case was found where a student cannot complete an exam, where a save is falsely reported as stored, or where unauthorised data is shown (backend refusals were enforced with HTTP 403 in every probe).

## Answers to the 30 final-verdict questions

1. **Professionally designed?** The visual system is restrained and coherent (palette matches the brief, one component kit, no gimmicks). The *product* design is uneven: the exam core is strong, the supporting portals are thin and a primary campus page crashes.
2. **Navigation intuitive?** For Student and Invigilator yes; for Examiner, CCE and Campus Admin not yet (label drift, hidden functions, a crashing item, missing monitor entry).
3. **Confusing navigation items:** Question review, Schedule & approve, Papers & results, Eligibility, Enrolment & eligibility, Staff & accounts / Users, Live monitor (list vs screen) — doc 03.
4. **Redundant sections:** Students vs Staff & accounts (same people); Users vs Staff & accounts (same page); "View exam schedule" vs "Go to schedule"; two Sign out buttons on Profile.
5. **Missing important sections:** Campus Admin Live monitor entry; student record + attendance register; Lecturer My courses/grading/materials; permissions & settings; eligibility explanation for students; help/search.
6. **Ambiguous button labels:** "End", "+ Time", "Report", "Close" (confirm), "Reconcile attempts", "Initiate scoring", "Save & next", "Go to schedule", "Starts in".
7. **Buttons to wrong/unsatisfying destinations:** "Go to schedule" (should start), Examiner notification "Results ready for review" → candidate-only page, "Eligibility"/"Enrolment & eligibility" → error card.
8. **Workflows with unnecessary steps:** student start (3 clicks), exam creation (≥ 8 steps/3 roles), 100-click paper build, distant-question jump on phones (3–4), locate-student-and-confirm-attendance (impossible).
9. **Visually overloaded screens:** none overloaded; the control centre is dense but organised; the New examination modal has 14 undivided fields.
10. **Screens wasting space:** dashboards for Examiner/Invigilator/Campus Admin/Lecturer (≈ 70 % empty).
11. **Dashboards with unnecessary information:** Lecturer "Students at campus"; Super Admin "Users 91" (includes students).
12. **Dashboards lacking essential information:** live exam cards (Student, Campus Admin, Invigilator), approval lists (Examiner), system health (Super Admin).
13. **Is the student exam interface safe?** For normal conditions yes (no P0 found). Under failing/hung saves and on laptops with 100+ MCQs it is **not yet safe enough for a high-stakes mass exam** until UI-003/004/005 are fixed.
14. **Sidebar usable with 100+ MCQs?** Desktop ≥ 864 px high: yes (90–96/100 visible); 720–768 px high: 66–72/100 visible, requires page scroll; phones: sheet, 3–4 interactions. 200 MCQs not tested.
15. **Timer clearly visible?** Yes — sticky, boxed, `role=timer`, turns crimson < 5 min, no flashing.
16. **Answer-save feedback trustworthy?** Mostly: "✓ Saved" appears only after server confirmation and failures say "Not yet saved — retrying". Exception: a hung request stays "Saving…" forever (UI-003).
17. **Final submission protected?** Yes — review screen + dialog with explicit counts + checkbox + disabled confirm; only focus management is missing (UI-013).
18. **Mobile exam usable?** Yes for answering; navigation to far questions and the 168 px header are the weak points.
19. **Lecturer portal logically organised?** The parts that exist are; the portal lacks assigned-courses, grading and materials.
20. **Can an examiner schedule efficiently?** Not efficiently: 14-field modal, 110-row checklist, no guidance across the multi-role pipeline.
21. **Can a campus admin find students quickly?** Search is fast (≈ 1 s, 4 results for "Hira"), but a found student leads nowhere (UI-034) and attendance is blocked (UI-001).
22. **Institution/campus contexts understandable?** Passive text only (sidebar foot, subtitles); the monitor text is wrong for university roles; terminology varies (doc 04).
23. **Forms, filters, tables consistent?** Tables yes; forms consistent but weak on validation; filters consistent but stateless.
24. **Error and recovery states clear?** Good for 500/offline/404; inconsistent for permissions; missing for hung requests.
25. **Top 20 confirmed UX defects:** see §C.
26. **Top 10 navigation problems:** see §D.
27. **Five screens requiring major redesign:** Enrolment & eligibility (crash + missing attendance workflow), Student dashboard "Next examination", Examiner paper builder, Campus Admin dashboard + student record, Lecturer portal landing (assigned courses).
28. **Patterns to preserve:** read-only-with-reason control centre, preview-before-apply extension, incident dialog naming the candidate, offline banner wording, two-step submission, sticky exam header, status chips, mono numerals, friendly 500 card, deep-linked CCE tiles.
29. **Recommended navigation structure:** doc 23.
30. **Exact next work:** doc 25 (Themes A–D), sequenced in doc 24.


## Direct answers to the headline questions
- Is the application ready for supervised institutional use from a UI/UX standpoint? **No** — fix themes A and B of the roadmap first. This audit makes no pilot-readiness claim.
- Largest risks by user harm: exam-player network-failure behaviour (UI-003/004), data-integrity bug (UI-002), crashed eligibility page (UI-001), misleading student exam status (UI-007/008/051).
- Largest strengths to protect: doc 21 §"patterns to preserve" (also in answer 28).
