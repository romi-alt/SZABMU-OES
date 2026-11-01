# 04 — Navigation, status and routing (UI-006, 007, 008, 031-part)
- Campus Admin menu now includes **Live monitor** (`nav.ts`); API campus scoping unchanged and covered by `campus-monitor.test.ts` (7).
- One shared status presentation model (`packages/shared/src/exam-status.ts`) derived only from authoritative state; dashboard, schedule and entry page consume it (additive API fields `controlMode`, `attempt.deadlineAt`, `openNow`, `scheduled`).
- Staff notifications ("Results ready for review", "Results awaiting publication") now link to the exam page; a source-scan test forbids `LINKS.results` in any `notifyRole` call.
- **Not done:** UI-018/019 (central route-permission guard, `can()`-gated buttons), UI-021 (menu label vs page title), UI-022 (hidden routes — policy decision).
