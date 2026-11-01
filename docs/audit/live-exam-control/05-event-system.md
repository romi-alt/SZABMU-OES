# 05 — Event system: transactional outbox, SSE, catch-up

## Write path (durable)

`finishTransition()` runs inside every command/reconciler transition: version bump → `INSERT INTO exam_events` (same transaction) → audit append. If the transaction rolls back there is no event; if it commits the event exists, even if the process dies a microsecond later. Events carry: `id` (monotonic cursor), `eventId`, `examId`, `institutionId` (NULL = exam-wide), `studentId` (NULL = everyone in scope), `aggregateVersion`, `type`, `payload`, commit timestamp, `deliveryStatus`, `retryCount`.

Types: `ADMISSION_OPENED, ADMISSION_CLOSED, EXAM_STARTED, EXAM_SUSPENDED, EXAM_RESUMED, DEADLINE_EXTENDED, EXAM_CLOSING, EXAM_CLOSED, SCORING_STARTED, RESULTS_PENDING, POLICY_CHANGED`. Payloads are deliberately small and public-safe: scope, minutes, policy, candidate ids when ≤ 500 — **never the internal reason text** (asserted by test).

## Publish path (Redis accelerator)

`publishPending()` claims PENDING rows with `FOR UPDATE SKIP LOCKED` (several workers never publish the same row concurrently), `PUBLISH`es to `oes:exam:<id>`, and marks DELIVERED in the same transaction. A failed publish increments `retryCount`; after 10 attempts the row becomes `FAILED` (visible in the health card and `oes_exam_events_publish_failed_total`). While Redis is known down the publisher does nothing and rows stay PENDING. It runs after each command (non-blocking) and on every reconciler pass. Consumers tolerate duplicates: every SSE frame has the outbox `id` and the hub skips ids ≤ the subscriber's last.

## Read path (SSE)

Staff: `GET /invigilation/exams/:id/stream`; candidates: `GET /me/exams/:id/stream`. Both: replay-then-live without gaps (subscribe & buffer → replay from PostgreSQL after the cursor → drain buffer → replay again → live). The cursor is the browser's `Last-Event-ID` (automatic on reconnect) or `?after=` taken from a snapshot. If more than 500 events were missed the stream sends `resync` and the client refetches a snapshot.

- Scoping is applied to **live and replayed** events by the same function (`visibleTo`): staff see exam-wide events and events of their campuses; a candidate sees exam-wide events, their campus's events and events naming them.
- Staff streams also receive `stats` (aggregate snapshot) at most every ~1.5 s when something changed, and every 15 s regardless; the per-exam aggregate is computed once per process and shared.
- Headers: `text/event-stream`, `Cache-Control: no-cache, no-transform`, keep-alive comment every 15 s. Caps: 4 streams per user, 20,000 per process (HTTP 429).
- **Multiple API processes** each subscribe to Redis and each also run a per-exam database catch-up poll (10 s when Redis is healthy, 1 s when it is not), so every process delivers the same authoritative event sequence.

## What a missed event does

Nothing breaks. The candidate player treats an event only as a prompt to call the heartbeat (which reads suspension, deadline and exam state from PostgreSQL); the 15-second heartbeat covers a dead stream; a reload calls `start` which returns `control{…}`. The lobby polls `/me/exams/:id/state` every 10 s as a fallback. SSE failure never touches answer saving (separate endpoints, separate failure domain).

## Degraded monitoring is explicit

`snapshot.freshness.degraded` and `reasons[]` state when Redis heartbeat counts are unavailable (`online`/`disconnected` become `null`, never guessed) or the event channel is down (updates come from the database with a short delay). The control centre shows the degradation instead of hiding it.
