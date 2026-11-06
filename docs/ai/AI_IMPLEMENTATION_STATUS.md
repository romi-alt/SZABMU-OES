# AI implementation status

| Feature | Status | Evidence | Notes |
|---|---|---|---|
| F5 Item statistics (deterministic) | **Verified** | `packages/shared/src/psychometrics.ts` + tests; `apps/api/test/item-statistics.test.ts`; `tests/e2e/item-statistics.spec.ts` | not an AI model; numbers are exact; flags are prompts only |
| F2a Duplicate detection (deterministic text similarity) | **Verified** | `packages/shared/src/similarity.ts` + tests; `apps/api/test/question-duplicates.test.ts` (scope: a lecturer of another course does not see the pair; students 403; no key fields); `tests/e2e/question-duplicates.spec.ts` (dialog + axe) | word 3-gram Jaccard over vignette+stem+options (option order ignored), threshold 0.6; review prompt only |
| F1 MCQ drafting assistant | Not started — **blocked on approval** | — | needs provider decision, credentials, data-processing agreement (`AI_GOVERNANCE_AND_PRIVACY.md` §2) |
| F2b LLM quality review | Not started — blocked on approval | — | rule-based checks can be built first |
| F3 Bloom classification | Not started | — | after F1/F2b |
| F4 Blueprint assistant | Not started | — | deterministic coverage report first |
| F6–F9 | Deferred | — | see assessment |

No AI provider is configured, no credentials exist in the repository or environment, and no question, student or result data has been sent to any model.
