# Working on this repository from more than one session

Several people or Claude Code sessions may work here at once. This page says who owns what and how to avoid stepping on each other.
Update the table when ownership changes.

## Ownership

| Area | Owner | Branches |
|---|---|---|
| UI/UX remediation: web shell, pages, `ui.tsx`, `globals.css`, exam player, exam-control backend, `docs/ui-ux-remediation` | UI/UX session | `claude/oes-platform-foundation` |
| Hosting track: remove Redis/BullMQ → MySQL → Node 24 and two-site split → Hostinger deploy guide | Hosting session | `claude/hosting-*` |
| Accessible notification menu, shared DTO types, `loading.tsx`, `tests/e2e/a11y.spec.ts` | Hosting session (PR #2) | `claude/frontend-hardening` |
| `.github/workflows/ci.yml`, `package.json` and `package-lock.json`, `docs/implementation-status.md` | **shared**: tell the other session before changing | — |

## Rules

1. **Sync before you work and before you push.** `git fetch && git merge origin/claude/oes-platform-foundation`. Resolve conflicts by merging, never by rebasing or force-pushing a shared branch.
2. **No new Redis or queue usage.** Background work goes through the database (see `modules/control/lifecycle.service.ts`). The hosting target has no Redis, and every new dependency on it must be removed again.
3. **Prisma migrations: announce them.** Two sessions adding migrations collide on ordering. While the MySQL port (hosting stage 2) is running, the schema is frozen: no schema or migration changes from other sessions.
4. **One session per pull request.** PR events (CI, reviews) are delivered to one watcher; a second one duplicates fixes.
5. **Keep changes in your own area.** If you need a change in a file the other session owns, ask, or make the smallest possible change and say so in the commit message.
6. **Small, frequent merges.** Long-lived branches drift: the foundation branch has already moved under an open PR twice.
7. **CI must pass before it counts as done.** CI runs on pull requests, on `main`, and on every `claude/**` branch push.

## Known overlap to watch

- The UI/UX tracker lists a notification-panel batch. The accessible notification menu already exists in PR #2 (`apps/web/src/app/(app)/layout.tsx`); whichever lands first, the other rebases onto it instead of building a second one.
- Redis is still used by the exam-control event channel and live monitor (`modules/control/events.service.ts`, `monitor.service.ts`). Hosting stage 1 replaces it; until then, treat those files as owned by the hosting session for anything Redis-related.
