# ADR 0002: Library-first monorepo and package boundaries

- **Status:** Accepted
- **Date:** 2026-10-27

## Context

Promptfolio's reusable packages are the product; the portfolio application is their first
consumer. Packages must be usable with any UI framework, server, or hosting platform, and a second
profile or consumer must work through configuration and public APIs without editing package code.

The specification allows several package boundaries (domain, sources, AI, UI, persistence) but
warns against creating thin packages before a boundary has a concrete benefit.

## Decision

Use a PNPM TypeScript workspace with `apps/*` and `packages/*`, and create packages only when the
milestone that needs them arrives:

| Package                      | Created | Responsibility                                                    |
| ---------------------------- | ------- | ----------------------------------------------------------------- |
| `@promptfolio/core`          | M1/M2   | Canonical profile model, validation, provenance, and pure logic.  |
| `@promptfolio/ai`            | M4      | Server-only model orchestration and tools (planned).              |
| `@promptfolio/source-github` | M8      | GitHub fetching, selection, validation, and normalization.        |
| `@promptfolio/react`         | Maybe   | Reusable UI only if a clear boundary emerges (decided after M3).  |

Rules:

- **Dependency direction:** apps depend on packages; packages never import apps. Every package
  may depend on `core`; `core` depends on nothing in the workspace.
- **`core` stays runtime-neutral:** no Node.js, browser, React, Next.js, or AI SDK dependencies,
  and no filesystem or network access. Its TypeScript configuration includes no Node or DOM types,
  so accidental use fails type checking.
- **Explicit public APIs:** each package exposes only what its `exports` entry (`src/index.ts`)
  exports. Imports of package internals fail type checking.
- **Source-consumed packages:** packages are consumed from TypeScript source without a build step.
  A compiled build will be added before anything is published.
- **Persistence and caching** start as small modules (interfaces in a package, implementations in
  the app), not as packages, until multiple real implementations exist.
- **Shared dependency versions** live in the pnpm catalog in `pnpm-workspace.yaml`.

## Consequences

- Few packages to understand at any time; each new package must justify its boundary.
- Consumers outside this monorepo cannot use the packages until a build step is added.
- `core` cannot read files or call APIs itself; applications and adapters supply data to it.
- *Update (M8):* `@promptfolio/source-github` was created as planned: it depends on `core` and
  zod only, uses the global `fetch`, and keeps all GitHub-specific knowledge. `core` gained the
  source-neutral `Repository` record and `addObservedRecords`; the app owns the files and the
  fetch command ([ADR 0009](0009-github-source-as-fetched-snapshot.md)).
- *Update (M10):* `@promptfolio/contact` was added: it depends on zod only, because contact needs no
  model or AI SDK, and it does not depend on `core`. It owns the `ContactSender` and `ContactSendLimiter`
  interfaces; the app owns the configuration and the Resend and Redis adapters
  ([ADR 0012](0012-contact-workflow.md)).
