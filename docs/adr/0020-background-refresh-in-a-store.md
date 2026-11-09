# ADR 0020: Background GitHub refresh in a store, as an opt-in mode

- **Status:** Accepted
- **Date:** 2026-11-09
- **Revisits:** [ADR 0009](0009-github-source-as-fetched-snapshot.md), which rejected "a hosted key-value store written by a
  cron route", and the scheduling in [ADR 0010](0010-refresh-status-and-content-versions.md)

## Context

The documented refresh is a daily GitHub Actions job that commits the snapshot ([the guide](../guides/scheduled-refresh.md)).
That adds a data commit for every change, needs a deploy for new data to appear, and in a public repository GitHub disables
the schedule after 60 quiet days. A consumer app instead keeps the snapshot in Redis and refreshes it after a chat response,
and asked for that pattern in the libraries.

ADR 0009 rejected a store because it was "a new service and secret". Since then, deployed apps need a store anyway: chat
limits ([ADR 0013](0013-chat-daily-limits.md)) and server-side history ([ADR 0018](0018-server-side-conversation-history.md))
both take one the application implements.

## Decision

`@promptfolio/source-github` exports `createBackgroundGitHubSource`, next to the file-based functions, which stay unchanged.

- **The application implements `GitHubSnapshotStore`:** `get` and `set` for two keys (`snapshot`, `refresh-after`), and a
  `lock` that returns a token with an `unlock(token)` that releases only that holder's lock. The package names no store,
  like `ChatTurnLimiter` and `ChatStore`. `createMemorySnapshotStore` is for tests and local development.
- **Visitor requests replace the cron job.** `loadProfile` reads the stored snapshot and hands a refresh check to
  `runAfterResponse` (Next.js `after`, or a platform's `waitUntil`). It never calls GitHub, so visitors never wait for it.
- **Rules.** After a complete refresh the next one waits 6 hours; after a partial or failed one, 1 hour. One run at a time,
  by the lock, which expires after 120 seconds so a crashed run cannot block later ones. The stored snapshot is replaced
  only after `carryForward` succeeds and `mergeGitHubSnapshot` accepts the result. All three numbers are options.
- **Failures never reach the visitor.** An unreadable store or an invalid stored snapshot gives the owner profile alone, with
  warnings; the next refresh overwrites a bad snapshot. Store errors are logged without their message, which could repeat a
  credential.
- **Opt-in.** The committed snapshot and the scheduled job remain the default, and the reference app keeps them.
- **In `source-github`, not a new package or `core`.** The refresh only composes this package's functions; `core` has no
  I/O, and `ai` must not know about GitHub. A scheduler shared by several sources waits for a second source.

## Alternatives

- **Keep only the committed snapshot.** Data commits and the 60-day rule stay; the data is reviewed in git.
- **A cron route that writes the store** (ADR 0009's alternative). Still possible: call `refreshIfDue` from it. It needs a
  scheduler and a secret for the route; traffic-driven refresh needs neither.
- **Refresh inside the request.** Visitors would wait for GitHub and see its failures.
- **A refresh-status record in the store** ([ADR 0010](0010-refresh-status-and-content-versions.md)'s status file). Left out:
  the server log has the outcome, and only the owner reads it.

## Consequences

- No data commits, no redeploy for new data, no 60-day rule. The data is no longer reviewed in git.
- Freshness depends on traffic: a site nobody visits does not refresh, and its first visitor after a quiet stretch gets the old
  snapshot. A cron route calling `refreshIfDue` fixes that if needed.
- The work after the response must finish within the host's request time limit; the lock time should be longer than that.
- Each chat request reads the store once more, and a check reads `refresh-after` after the response.
- Details: [M21 plan](../plans/m21-background-refresh-in-a-store.md), learning note on
  [background work after the response](../learning/background-work-after-response.md).
