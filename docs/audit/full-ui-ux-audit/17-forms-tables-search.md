# 17 — Forms, tables, filters and search

## Forms (opened: New examination, New question, Edit question, New account, Register institution, Assign lecturer, Report incident, Profile, Password)
| Aspect | Finding |
|---|---|
| Label placement | labels above fields, consistently (good) |
| Required indicators | **none** — 0 controls with `required`/`aria-required`; no asterisks (UI-026) |
| Validation | none inline; the submit button is disabled until valid, silently; backend errors arrive as a toast (e.g. phone accepted without validation, UI-032) |
| Field grouping | New examination: one 14-field modal without sections; New question: logical order (course → type → stem → options → difficulty → explanation) |
| Defaults | term default "2026-SPRING"; negative marking 0; reasonable |
| Date/time inputs | native datetime fields (not inspected for locale); no timezone shown on exam windows |
| Searchable selectors | none: Course dropdown lists every course (fine at 7); Institutions are checkboxes |
| Save feedback | profile toast "Profile saved"; modals close on success; no "created, next step" guidance |
| Cancel behaviour | Cancel and ✕ everywhere; Escape closes **discarding typed text** with no warning (UI-026) |
| Unsaved-change protection | none |
| Multi-step progress | none (exam creation spans pages, doc 09) |
| Modal height | New question 769 px, New examination 666 px — scroll inside on 768 px laptops |

## Tables
- Shared `Table` component (101 on the audited pages): uppercase maroon header band, mono numerals right-aligned, status chips, row hover; becomes labelled cards on phones.
- Missing: sorting, column chooser, row selection (except control page), sticky header, captions/scope (UI-043).
- Pagination: bottom "N records · Page 1 of 4 · Previous/Next" (works; students 80 → 4 pages of 25). No page-size choice, no jump.
- Row actions are inline buttons (not three-dot menus) — good visibility; but destructive and benign actions share style (Deactivate beside Reset password, UI-024).
- Loading: three skeleton bars; error: friendly card with Try again; empty: grey sentence.
- Unnecessary columns: Question bank "KEY" (answer letter in the list — appropriate for authors/reviewers); Audit "Hash" (UI-038); Exams "MIN/QS" abbreviations.

## Filters and search
- Selected filters visible as the select value; **no "clear filters"**; counts update ("7 records").
- State **not in the URL** and lost on back navigation (UI-028).
- Search boxes: students ("Name or registration number"), users, questions ("Search question text…"), monitor ("Reg. no. or name") — placeholder states what is searchable (good); debounce ≈ 1 s; no-result message "No students." does not echo the query.
- No global search.
