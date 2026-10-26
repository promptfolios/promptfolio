# Promptfolio

Promptfolio is a library-first, AI-powered conversational professional portfolio. The reusable
`@promptfolio/*` packages are stack-agnostic building blocks; `apps/portfolio` is a
profile-independent, full-stack reference application built with them.

Status: early development. See [`PROMPTFOLIO_SPEC.md`](PROMPTFOLIO_SPEC.md) for requirements and
[`docs/ROADMAP.md`](docs/ROADMAP.md) for the milestone plan.

## Repository layout

| Path             | Package             | Purpose                                                       |
| ---------------- | ------------------- | ------------------------------------------------------------- |
| `packages/core`  | `@promptfolio/core` | Canonical profile model and framework-agnostic core logic.    |
| `apps/portfolio` | `portfolio`         | Reference Next.js application; consumes the packages.         |
| `docs/`          | —                   | Roadmap, architecture decision records, and background notes. |

Dependency direction: apps depend on packages; packages never depend on apps.

## Requirements

- Node.js 24 or later (see `.node-version`)
- pnpm 11 (the exact version is pinned in `package.json` under `packageManager`; `corepack enable` selects it automatically)

## Setup

```sh
pnpm install
```

## Commands

Run from the repository root:

| Command          | Description                                         |
| ---------------- | --------------------------------------------------- |
| `pnpm dev`       | Start the reference app at http://localhost:3000.   |
| `pnpm build`     | Build all workspace projects that define `build`.   |
| `pnpm typecheck` | Type-check all workspace projects.                  |
| `pnpm test`      | Run all workspace tests.                            |

Linting and formatting are planned for milestone M1.1.

## Workspace conventions

- Packages expose their public API only through the `exports` field in `package.json`; importing
  package internals (for example, `@promptfolio/core/src/...`) is not supported.
- Packages are currently consumed from TypeScript source without a build step. A compiled build
  will be added before any package is published.
- Shared dependency versions are defined once in the `catalog` section of `pnpm-workspace.yaml`
  and referenced as `"catalog:"`.
- Commits follow Conventional Commits; see `CLAUDE.md`.
