# ADR 0010: Refresh status, per-repository last known good, and content versions

- **Status:** Accepted
- **Date:** 2026-10-30

## Context

M8 fetches GitHub data with an owner-run command that writes a snapshot only when every request
succeeded ([ADR 0009](0009-github-source-as-fetched-snapshot.md)). The spec (3.4) asks for more:
a refresh that is observable, distinguishes success, partial failure, and previous known-good
data, never presents stale data as current, publishes a new profile version only on a meaningful
change, and invalidates dependent cached answers. The app is serverless, so nothing in memory
survives between requests ([ADR 0001](0001-reference-app-framework.md)), and where a real profile
is deployed from is still open ([ADR 0006](0006-profile-data-location.md)).

## Decision

1. **A refresh command.** `pnpm --filter portfolio refresh` replaces `fetch-github`. It updates
   the fetched sources of the configured profile (today: GitHub) and exits 0 (success),
   2 (partial: written, some earlier data kept), or 1 (failed: nothing written).
2. **Per-repository last known good.** If a repository's languages or README cannot be read, its
   whole previous entry is kept with the time it was read; the snapshot (format version 2) has a
   `retrievedAt` per repository, which becomes that record's `observedAt`. Which repositories
   appear still comes from the new run. Errors that make the selection itself unreliable
   (account, list, token, rate limit, budget), or a partial run with no previous snapshot, fail
   the run.
3. **A status file.** `profile/<profile>.refresh-status.json` records the last attempt, its
   outcome, the last success, what was carried over or not added, and sanitized errors. It is
   written on every run, never fails the profile load, and only produces owner warnings in the
   server log. Visitors see no failure messages; they see the correct observation date of each
   record.
4. **The content fingerprint is the profile version.** The SHA-256 of `canonicalProfileContent`
   (observation times excluded), already used by prepared answers, is the version id. There is
   no counter. A version is published by deploying the files that produce it. The snapshot is
   rewritten only when the version changes, so a refresh that finds nothing new changes no data
   file.
5. **No automatic answer regeneration.** The refresh reports how many prepared answers belong
   to the new version; stale ones are answered live until the owner regenerates and reviews
   them ([ADR 0008](0008-prepared-answers-as-files.md)).
6. **Scheduling is documented, not active here.** A daily GitHub Actions workflow (built-in
   `GITHUB_TOKEN`, commit on a new version, optional deploy hook) is a template in
   [docs/guides/scheduled-refresh.md](../guides/scheduled-refresh.md), activated in the
   deployment repository (M12).

Alternatives considered: keeping all or nothing (one flaky README blocks every update); mixing
fresh metadata with a carried README in one record (two observation times in one record);
status inside the snapshot (a failed run would have to rewrite the data file); a hosted
key-value store for status and versions (a new service and secret for data only the owner
reads); a version counter (needs agreed storage, adds nothing a hash does not give); always
rewriting the snapshot (a commit and redeploy every day without any data change); an active
workflow in this repository (it would fail or idle every day on the example profile).

## Consequences

- A refresh is idempotent: twice in a row with no change on GitHub leaves the data files
  byte-for-byte unchanged, so a scheduled job commits with a plain `git diff`.
- The snapshot's dates mean "first observed in this form": they can be older than the last
  check, which understates freshness and never overstates it. The status file has the last
  check.
- A repository that keeps failing stays in the profile with its old date for as long as it is
  selected; there is no maximum carry-over age.
- `@promptfolio/source-github` returns `status: complete | partial | failed` instead of `ok`,
  and exports `carryForward`; `@promptfolio/core` accepts an optional `observedAt` per observed
  repository; `@promptfolio/ai` exports `profileFingerprint`.
- The refresh status schema lives in the app; it moves to a package only if a second consumer
  needs it (M12).
- Details: [M9 plan](../plans/m9-refresh-pipeline-and-versions.md), learning notes on
  [refresh status and last known good](../learning/refresh-status-and-last-known-good.md) and
  [scheduled jobs](../learning/scheduled-jobs.md).

*Update (M12.5):* prepared answers were removed, so the reporting in decision 5 is gone. The content fingerprint remains the profile version, now in `@promptfolio/core`.
