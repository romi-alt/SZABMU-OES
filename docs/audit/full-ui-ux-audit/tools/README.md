# Audit tooling (read-only, disposable stack only)

Playwright + axe-core scripts used to produce `../data/*.json` and the screenshots. None of them modify application source.
They assume the disposable stack (`/tmp/stab-stack.sh`: PostgreSQL :54397, Redis :6397), seeded with `SEED_STUDENTS_PER_CAMPUS=40`, API on :4000 and web on :3000.
Run order: `prepare-fixtures.mjs` → `publish-results-fixture.mjs` → `crawl-all-roles.mjs <role>` (×7) → `player-measure.mjs desktop|small|long` → `player-extra.mjs` → `player-review-block.mjs` → `interact-1..4.mjs` → `public-and-incident.mjs`.
axe-core was installed **outside the repository** (`npm i axe-core` in /tmp/axe); no dependency was added to the project. Scripts hard-code `/tmp` paths and the synthetic demo password; they must never be pointed at the shared development database or any real data.
