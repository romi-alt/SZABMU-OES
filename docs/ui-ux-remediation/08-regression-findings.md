# 08 — Regressions and test-infra findings
- Login rate limits blocked a full Playwright run → limits made configurable (`LOGIN_RATE_IP_MAX/ID_MAX`), production start refuses non-default values (test in `config.test.ts`); raised only for the Playwright API server.
- `errors.spec` "expired session" raced the dashboard's new request → wait for network idle before clearing cookies (12/12 repeats).
- `exam-control.spec` "campus staff" read table rows before they loaded → waits for the first row (3/3 repeats, then full suite green).
- Spec account/data collisions (student passwords, attendance rows, "404" in random codes) → dedicated accounts, restored data, letters-only tags.
- Product regressions introduced by fixes: none found by the suites above.
