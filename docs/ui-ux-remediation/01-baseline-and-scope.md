# 01 — Baseline and scope
- Branch `claude/oes-platform-foundation`; baseline = audit commit `44c9461` (52 findings: 0 P0, 8 P1, 31 P2, 13 P3 per the issue register).
- Authorisation: implement **verified** issues only; no redesign; no backend/engine rewrite; API changes additive only; no branding change; no destructive data action; shared dev DB never reset (all tests ran on a disposable PostgreSQL/Redis).
- Delivery in batches (commits): A `4a2b8da`, `3cf762e`; B `85ff7a8`; C `8eabf65`, `d158f56`; D-part `b34b8ac`, `8b086db`, `2ee67ec`; config `6b489b7`.
- Pushed to the feature branch only (through `c6726b0`, on the stop-hook request); no PR, no merge, no deploy.
- Honest scope statement: this pass resolved the 8 P1 issues and a set of shared-root-cause P2 items. **At the time of this baseline, 1 finding was NOT_STARTED and 5 needed a policy/product decision (all closed 2026-11-07; see 11-issue-tracker.md).** The 52 findings are not all resolved.
