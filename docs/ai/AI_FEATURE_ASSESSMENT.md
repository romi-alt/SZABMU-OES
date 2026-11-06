# AI feature assessment (2026-11)

Purpose: decide which AI-assisted capabilities are worth building for the SZABMU OES, in what order, and under which conditions.
Principle: AI assists academic and administrative staff **outside the live examination**; it never decides marks, results, eligibility or misconduct,
and nothing it produces reaches a live paper without approval by an authorised person. Governance rules: `AI_GOVERNANCE_AND_PRIVACY.md`.

Rating: value and risk High/Medium/Low; "data leaving" = what an external model provider would receive if one were used.

| # | Feature | Value | Risk | Data leaving the institution | Can be done without an external model? | Recommendation |
|---|---|---|---|---|---|---|
| F5 | Psychometric item analysis (difficulty, discrimination, item–rest r, KR-20) | High | Low | none | **Yes — deterministic statistics** | **Built** (T-PSY). An LLM may later *explain* the numbers; the numbers stay deterministic |
| F2a | Duplicate / near-duplicate question detection | High | Low | none | **Yes — text similarity** | Build first (no model needed) |
| F1 | MCQ drafting assistant (stem, distractors, objective, difficulty) | High | Medium–High (factual errors in clinical content; confidential bank sent out) | syllabus text; for "improve wording", the draft question | No | Pilot only after approval, drafts-only, author must edit and submit through the existing four-eyes review |
| F2b | Question quality review (ambiguity, clueing, weak distractors, formatting) | High | Medium | the question and its options (confidential until used) | Partly (rule checks: "all of the above", option length cues, negative stems) | Rule-based checks first; LLM review after approval |
| F3 | Bloom's taxonomy classification | Medium | Low–Medium | the question text | No | After F1/F2b; editable label, never treated as validated |
| F4 | Blueprint assistant (coverage vs. objectives, difficulty, cognitive level) | Medium | Low | bank metadata (topics, counts) — little or no question text | Mostly (deterministic coverage tables from tags) | Deterministic coverage report first; AI suggestions later |
| F6 | Operations summary for controllers (incidents, failed logins, interruptions) | Medium | Medium (personal data) | operational events, possibly student identifiers | Mostly (dashboards already show the facts) | Defer; existing monitor/incident views cover the need |
| F7 | Incident triage / anomaly signals | Low–Medium | **High** (risk of unfair suspicion) | behavioural data of candidates | Partly | Defer; only technical-incident grouping, never misconduct labels |
| F8 | Natural-language admin search | Medium | High (authorization bypass risk) | admin data | — | Defer until a permission-aware retrieval layer exists |
| F9 | Post-result learning insights for students | Medium | Medium (answer disclosure policy) | student results | Mostly (topic breakdown from tags) | Deterministic topic breakdown after a release-policy decision |

## Order of work
1. Deterministic, no data leaves: F5 (done), F2a duplicate detection, rule-based quality checks (part of F2b), coverage report (part of F4).
2. With written approval, a chosen provider and a data-processing agreement: F1 drafting assistant (pilot, one department), then LLM review (F2b).
3. Later or never: F6–F9 as described above.

## What "done" means for any AI feature
Feature flag off by default; permission-gated (author/examiner roles only); prompt-injection-resistant input handling (question text is data, not
instructions); output validated against a schema; every suggestion stored with provider, model and version; human accept/edit/reject recorded;
cost, latency and failure rate measured; failure never blocks any examination path; no student-facing AI during restricted examinations.
