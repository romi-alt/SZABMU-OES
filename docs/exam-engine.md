# Examination engine — answer-saving protocol

## Invariants
1. **"Saved" is shown only after a durable commit.** The browser marks a question *Saved* only when the API returned `saved: true` for a revision ≥ the question's latest local revision. The API returns that only after a single SQL statement (answer upsert + journal insert) has committed.
2. **No lost updates / out-of-order writes.** Each question has a client-monotonic `revision`. The upsert applies `WHERE attempt_answers.revision < EXCLUDED.revision`. Older or equal revisions are rejected (`409 STALE_REVISION` + server state) unless they are an exact replay of the stored value, which is acknowledged idempotently.
3. **Stale tabs cannot write.** `attempts.activeClientId` is claimed by the most recent `start`. A save from any other `clientId` gets `409 SESSION_SUPERSEDED`; the old window stops saving and offers takeover.
4. **A save can never slip in after the sheet is sealed.** Saves take `FOR KEY SHARE` on the attempt row; submit takes `FOR UPDATE`. A DB trigger additionally rejects any write to `attempt_answers` of a non-`IN_PROGRESS` attempt, even from outside the API.
5. **Submission is idempotent and verifiable.** `POST /attempts/:id/submit` locks the row, optionally checks the browser's `expected` (revision + label per question) against the database (`409 ANSWERS_OUT_OF_SYNC` if they differ), computes `answerDigest = SHA-256(canonical sheet)` and `receiptCode = HMAC(secret, attemptId | digest | submittedAt)`. A replay with any key returns the original receipt.
6. **Redis and localStorage are never authoritative.** Redis caches the immutable approved paper and heartbeats. The browser mirrors *unacknowledged* changes to `localStorage` only as a crash buffer; on resume the server state is loaded first and buffered newer revisions are re-sent.
7. **Every accepted write is journalled** in the append-only `answer_events` table (UPDATE/DELETE blocked by trigger) for dispute resolution.

## Save request
`PUT /api/attempts/:attemptId/answers/:examQuestionId`
```json
{ "clientId": "…", "revision": 7, "selectedLabel": "C" | null, "state": "ANSWERED|SKIPPED|CLEARED", "markedForReview": false, "visited": true }
```
Success: `{ "saved": true, "revision": 7, "savedAt": "…", "serverNow": "…" }` (+ `duplicate: true` for exact replays).

| Status / code | Meaning | Client behaviour |
| --- | --- | --- |
| 200 | Durably stored | mark Saved (if no newer local revision), resync clock |
| 409 `STALE_REVISION` | Server holds ≥ revision, different content | adopt server value |
| 409 `SESSION_SUPERSEDED` | Another window owns the attempt | stop; show takeover dialog |
| 409 `TIME_EXPIRED` / `ATTEMPT_CLOSED` | Deadline (+5 s grace) passed or sealed | stop; fetch receipt |
| 400 | Invalid label/state | mark *Could not save* (no retry loop) |
| network / 5xx / 429 | Transient | keep *Not saved*, exponential backoff 1→15 s with jitter, retry on `online` event |

## Connectivity interruption recovery
Offline: selection stays visible, indicator reads *Not saved — offline, will retry*, banner shows the unsaved count, nothing claims *Saved*.
Reconnect (`online` event or backoff timer): all pending questions are re-sent; each shows *Saved* only after acknowledgement.
Before **Review & submit**, `flushAll()` blocks until every change is acknowledged (or reports how many are not stored); the review screen is rendered from
`GET /attempts/:id/sheet` (the server's view) after reconciling.

## Capacity (honest status)
Measured locally (4 vCPU shared by API + PostgreSQL + Redis + load generator): see `docs/implementation-status.md` → *Load test results*.
**The 20,000-simultaneous-candidate target has NOT been demonstrated.** What the data supports: per-save cost (one indexed upsert + one journal insert) and the absence of
cross-candidate contention (all locks are per attempt row). Reaching the target requires a production-like environment: multiple API replicas, PgBouncer, tuned PostgreSQL
(WAL on NVMe, `max_wal_size`, checkpointing), and a distributed load generator. Plan: run `tests/load/exam-load.mjs` against staging at 2k → 5k → 10k → 20k.

## Time extension and grace
`SAVE_GRACE_SECONDS = 5` (policy P-05) tolerates in-flight saves at the deadline. Invigilators may add 1–60 minutes per candidate (reason required, audited); the browser picks up the new deadline on the next heartbeat (≤15 s).
