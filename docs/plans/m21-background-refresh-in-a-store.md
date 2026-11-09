# M21 plan: background GitHub refresh in a store (opt-in)

- **Status:** Plan approved (2026-11-09), to be implemented now rather than after production time in the consumer app. Done, in review.
- **Date:** 2026-11-09
- **Roadmap:** not listed before. Requested by a consumer app that keeps the snapshot in Redis and refreshes it with `after()`.

## Objective

Move that refresh into `@promptfolio/source-github`, store-agnostic and opt-in, so the committed snapshot stays the default.

**Excluded:** switching the reference app; a scheduler shared by several sources in `core`; a refresh-status record; timeouts
on store calls; a Redis adapter.

## Design

- **Owner: `source-github`.** It already owns fetch, `carryForward`, and `mergeGitHubSnapshot`; `core` has no I/O and `ai`
  must not know GitHub. No new package.
- **`GitHubSnapshotStore`:** `get`/`set` for `snapshot` and `refresh-after`, `lock(ttlSeconds)` returning a token, and
  `unlock(token)`. The token keeps a run that outlived its lock from releasing a later run's lock.
- **`createBackgroundGitHubSource`** returns `loadProfile(owner)` (stored snapshot merged, refresh check handed to
  `runAfterResponse`, never calls GitHub) and `refreshIfDue(profile)` (never rejects).
- **Rules:** 6 h after complete, 1 h after partial or failed, 120 s lock; replace the snapshot only after `carryForward`
  and `mergeGitHubSnapshot` succeed; store errors logged without their message.
- Diagram and trade-offs: [ADR 0020](../adr/0020-background-refresh-in-a-store.md),
  [learning note](../learning/background-work-after-response.md).

## Acceptance criteria

- Tests cover: complete, not due, lock held, partial, fetch failure, snapshot that does not fit, invalid stored snapshot,
  store `get`/`set`/`lock` failures, fetch that throws, lock release, lock expiry and stale tokens, `loadProfile` never fetching.
- The public-API test lists the two new runtime exports; existing exports are unchanged.
- ADR 0020, notes in ADRs 0009 and 0010, guide section, package README, learning note, changeset.

## Afterwards in the consumer app (after a release)

Replace its refresh and source modules with a Redis `GitHubSnapshotStore` (`SET NX EX` with a random token, compare-and-delete
unlock) and `createBackgroundGitHubSource({ runAfterResponse: after, ... })`, keeping its keys so the stored snapshot carries
over. The release also carries the breaking server-side history change.

## Verification

`pnpm verify`, `pnpm test:tarballs`.
