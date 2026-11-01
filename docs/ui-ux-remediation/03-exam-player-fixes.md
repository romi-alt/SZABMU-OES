# 03 — Examination player (UI-003, 004, 005, 012, 014, 017)
- **Protocol (no server contract change):** per-question revisions; server idempotency (`duplicate:true`); `STALE_REVISION` returns the server copy; `/attempts/:id/sheet` is the committed state; submit `expected()` counts only confirmed revisions.
- **Client:** bounded request timeouts; a timeout is an *ambiguous* outcome and is reconciled against the server before it is declared lost; six save states (saved, saving, retrying, offline_pending, not_confirmed, reconciliation_required); persistent `role=alert` after 15 s; manual retry; localStorage crash buffer.
- **Review & Submit** lists unconfirmed questions and blocks submission until reconciled; Save & next does not advance on a known-failed save.
- **Palette:** list of real buttons, roving tabindex, glyph + aria-label per state, jump-to-question, sticky aside (`--exam-bar-h`), filter group, phone sheet as a dialog with focus return.
- **Proof:** `exam-player-safety.spec.ts` injects real network-layer faults (drop, delay, server error) against the real server and asserts the **server's committed sheet**, not the UI. Fault suite 17 passed / 1 skipped.
- **Limitations:** localStorage (not IndexedDB) buffer; no real screen-reader pass; no multi-hour soak.
