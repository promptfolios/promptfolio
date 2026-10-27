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
| `@promptfolio/source-github` | M8      | GitHub fetching and normalization (planned; decided at M8).       |
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
