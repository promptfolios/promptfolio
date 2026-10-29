# ADR 0009: GitHub as a fetched snapshot, with source keys as record ids

- **Status:** Accepted
- **Date:** 2026-10-29

## Context

M8 adds public GitHub data as the second source of profile facts. The owner wants to configure
only a GitHub username, with no list of repositories or record links to maintain, and wants the
data refreshed automatically later. Until now every record was written by the owner, with an
author-assigned slug id ([ADR 0005](0005-profile-model-and-provenance.md)).

Constraints: the app is serverless, so nothing in memory survives between requests
([ADR 0001](0001-reference-app-framework.md)); GitHub allows 60 unauthenticated requests per hour
per IP address (5,000 with a personal token, 1,000 per repository with the `GITHUB_TOKEN` of
GitHub Actions); pinned repositories are only available through the GraphQL API, which needs a
token; `core` must stay free of network access ([ADR 0002](0002-library-first-monorepo-boundaries.md));
and the reference app must not contain a real person's data (spec 4.1,
[ADR 0006](0006-profile-data-location.md)).

## Decision

1. **A fetch command writes a snapshot file; requests read the file.** `pnpm --filter portfolio
   fetch-github` fetches, validates, and writes `profile/<profile>.github-snapshot.json` only when
   every request succeeded (all or nothing), replacing the old file in one step. The app reads the
   snapshot on every request like the profile and never calls GitHub. The command needs no
   arguments and exits 0 or 1, so a scheduled job can run it; the schedule itself is part of M9.
2. **Configuration is the username.** `profile/<profile>.github.json` holds `user` and an optional
   `exclude` list. Repositories are selected automatically: the owner's public, non-fork
   repositories, pinned ones first (token only), then by last push; 12 without a token, 20 with one.
   Forks and contributions to other repositories are a separate milestone (M8.1).
3. **Kept data:** repository metadata, top 5 languages by share, topics, created and last-push
   month, license, and a README excerpt of up to 3,000 characters. No stars or other counts, no
   GitHub identity fields. Private and internal repositories are never stored.
4. **Source keys as record ids.** A repository's id is `github.com/<owner>/<repo>`, lowercased.
   Core accepts two id forms: slugs (owner-only records) and source keys (records that live in a
   source). Owners may give a project the same id as a repository; that project is the owner's
   description of the repository ("the profile follows the source"). Both records keep their own
   provenance, and a lookup returns them together.
5. **Package boundary.** `@promptfolio/source-github` (core and zod only) fetches, selects,
   validates, and normalizes. `@promptfolio/core` owns the source-neutral `Repository` record and
   `addObservedRecords`, which stamps `source-observed` provenance and merges without changing
   owner records. The app owns the files, the command, and the optional `GITHUB_TOKEN`.
6. **Invalid files fail loudly.** An invalid configuration or snapshot fails the profile load,
   like an invalid profile file; a configuration without a snapshot loads with a warning.

Alternatives considered: fetching per request (rate limits, latency, and failures in front of
visitors, nothing to cache in on serverless); fetching at build time (builds depend on GitHub); an
explicit repository list with `projectId` links (must be maintained by hand; the owner rejected
it); derived slugs such as `github-<name>` (collide, and the owner's file could not refer to them
naturally); GitHub's numeric ids (survive renames but are unreadable in citations); a hosted
key-value store written by a cron route (a new service and secret); Octokit (several packages for
five endpoints and one query); committing the developer's real profile as the example (violates
the profile-independent reference app).

## Consequences

- Visitors never wait for GitHub, and a failed fetch never replaces good data. The data is as
  fresh as the last successful run, which is shown by `retrievedAt` in the source.
- Renaming a repository changes its id: an owner annotation under the old id stops matching (a
  warning in the log), and old citations in saved browser threads point nowhere.
- READMEs and refreshes change the profile content more often, so prepared answers
  ([ADR 0008](0008-prepared-answers-as-files.md)) are invalidated more often; regenerating them
  after a refresh is part of M9.
- The scheduled refresh (recommended: a daily GitHub Actions workflow that commits the snapshot)
  and refresh status are decided in M9; where a real profile is deployed from is still open
  (ADR 0006).
- Details: [M8 plan](../plans/m8-github-source-adapter.md), learning notes on
  [source adapters and snapshots](../learning/source-adapters-and-snapshots.md) and
  [calling external APIs](../learning/calling-external-apis.md).
