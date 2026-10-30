# Source adapters and snapshots

First appears in: **M8** (GitHub source adapter). Status: **in use**.

## 1. What it is

A **source adapter** turns one external source into the common profile model. It works in
separate steps:

1. **Fetch:** talk to the source over the network (the only step with I/O and its failures).
2. **Validate:** check that each response has the shape the adapter expects.
3. **Normalize:** map the source's shape to canonical, source-neutral records.
4. **Merge:** add those records to the profile with their provenance.

A **snapshot** is the validated result of one fetch, saved to a file with the time it was
retrieved. It separates *when data is fetched* from *when it is used*.

## 2. Why it matters in Promptfolio

GitHub data should be current without anyone maintaining a list, but visitors must never wait
for GitHub or see its failures. GitHub allows 60 unauthenticated requests per hour per IP
address, and serverless functions keep no memory between requests
([ADR 0001](../adr/0001-reference-app-framework.md)). Fetching per request would break on both
counts. Instead a command (`pnpm --filter portfolio refresh`) fetches when the owner or a
scheduled job runs it, and every
request reads the snapshot like the profile file
([ADR 0009](../adr/0009-github-source-as-fetched-snapshot.md)).

## 3. How it works

```mermaid
flowchart LR
    cfg["profile/*.github.json<br/>user, exclude"] --> fetch["fetchGitHubSnapshot<br/>fetch + validate"]
    fetch -- "complete or partial" --> carry["carryForward<br/>keep previous entries of unread repositories"]
    carry -- "new profile version" --> snap[("profile/*.github-snapshot.json<br/>retrievedAt per repository")]
    fetch -- "failed" --> keep["old snapshot kept, exit 1"]
    snap --> norm["normalizeGitHubSnapshot<br/>pure, every request"]
    cfg --> norm
    norm --> merge["addObservedRecords<br/>@promptfolio/core"]
    merge --> profile["Profile.repositories"]
```

- **Automatic selection.** The owner gives only a username. The fetcher takes the owner's public,
  non-fork repositories: pinned ones first (pinned items exist only in GitHub's GraphQL API, which
  needs a token), then by last push, 12 without a token and 20 with one. `exclude` hides a
  repository; it applies at load time too, so hiding needs no refetch.
- **Last known good, per repository (M9).** M8 wrote all or nothing: one failed README blocked
  every update. Now the fetch is `complete`, `partial`, or `failed`. If the account, the list, the
  token, or the rate limit fails, nothing is written. If only some repositories' languages or
  README cannot be read, `carryForward` keeps their whole previous entry with its own
  `retrievedAt` (snapshot format version 2), so the record's `observedAt` shows its real age. A
  repository that fails and was never in a snapshot is left out until the next run. A missing
  README is not a failure. The file is written to a temporary name and renamed, so a reader
  never sees half a file. See [refresh status and last known good](refresh-status-and-last-known-good.md).
- **Written only for a new version (M9).** The snapshot is rewritten only when the profile's
  content fingerprint changes, so a run that finds nothing new leaves it unchanged.
- **Source keys and the owner's notes.** Each repository's id is `github.com/<owner>/<repo>`.
  The owner can describe a repository by writing a project with that same id: the profile
  follows the source, not the other way. The two records keep their own provenance, and a
  lookup returns both.
- **Less churn on purpose.** Dates are kept by month and star counts are left out, because any
  content change invalidates every prepared answer
  ([prepared answers and invalidation](prepared-answers-and-invalidation.md)). `retrievedAt` is not
  content, so a refetch that finds nothing new keeps the answers current.

## 4. Where it lives in the code

- Package: [packages/source-github/src/](../../packages/source-github/src/) — `config.ts`,
  `select.ts`, `fetch.ts` (the only I/O), `snapshot.ts`, `normalize.ts`, `carry-forward.ts`
- Merge and the `Repository` record: [packages/core/src/profile/observed.ts](../../packages/core/src/profile/observed.ts),
  [types.ts](../../packages/core/src/profile/types.ts)
- Reading the files at request time: [apps/portfolio/src/server/github-source.ts](../../apps/portfolio/src/server/github-source.ts)
- The command: [apps/portfolio/scripts/refresh.ts](../../apps/portfolio/scripts/refresh.ts), which
  runs [apps/portfolio/src/server/refresh.ts](../../apps/portfolio/src/server/refresh.ts)
- Tests: `fetch.test.ts`, `normalize.test.ts`, `select.test.ts`, `carry-forward.test.ts` in the
  package, [observed.test.ts](../../packages/core/src/profile/observed.test.ts),
  [profile.test.ts](../../apps/portfolio/src/server/profile.test.ts),
  [refresh.test.ts](../../apps/portfolio/src/server/refresh.test.ts)
- Scheduled refresh: a template in [docs/guides/scheduled-refresh.md](../guides/scheduled-refresh.md),
  **planned** to run in the deployment repository (M12). Work in other owners' repositories:
  [contributions and evidence](contributions-and-evidence.md) (M8.1)

## 5. Common pitfalls and misconceptions

- "The adapter verifies the profile." It shows what GitHub shows. A repository under the owner's
  account does not prove who wrote its code.
- Mixing fetch and normalize makes every test need the network and every request pay for GitHub.
  Keep the I/O in one function and test the rest with fixtures.
- Writing whatever came back, even partially, replaces good data with incomplete data. Validate
  everything first, then replace the file in one step.
- Changing source data more often than needed is not free: here it invalidates prepared answers.

## 6. Further reading

- [GitHub REST API: repositories](https://docs.github.com/en/rest/repos/repos)
- [GitHub GraphQL API: users (pinnedItems)](https://docs.github.com/en/graphql/reference/users)
