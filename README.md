# Promptfolio

Promptfolio is a library-first, AI-powered conversational professional portfolio. The reusable
`@promptfolio/*` packages are stack-agnostic building blocks; `apps/portfolio` is a
profile-independent, full-stack reference application built with them.

Status: early development. See [`PROMPTFOLIO_SPEC.md`](PROMPTFOLIO_SPEC.md) for requirements,
[`docs/ROADMAP.md`](docs/ROADMAP.md) for the milestone plan and progress, and
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the architecture and decision records.

## Repository layout

| Path             | Package             | Purpose                                                       |
| ---------------- | ------------------- | ------------------------------------------------------------- |
| `packages/core`  | `@promptfolio/core` | Canonical profile model and framework-agnostic core logic.    |
| `apps/portfolio` | `portfolio`         | Reference Next.js application; consumes the packages.         |
| `docs/`          | —                   | Roadmap, architecture decision records, and background notes. |

Dependency direction: apps depend on packages; packages never depend on apps.

The reference app's chat UI uses [assistant-ui](https://www.assistant-ui.com/) with Tailwind CSS
and shadcn/ui. Component code copied by their CLIs lives in `apps/portfolio/src/components/ui/`,
`apps/portfolio/src/components/assistant-ui/`, and `apps/portfolio/src/hooks/`; it is treated as
vendored and excluded from linting (see
[ADR 0007](docs/adr/0007-chat-ui-assistant-ui.md)).

While the app has no model connected, replies are labelled placeholders. Send `/fail` to simulate
a failed response and test retry.

## Requirements

- Node.js 24 or later (see `.node-version`)
- pnpm 11 (the exact version is pinned in `package.json` under `packageManager`; `corepack enable` selects it automatically)

## Setup

```sh
pnpm install
```

## Commands

Run from the repository root:

| Command          | Description                                              |
| ---------------- | -------------------------------------------------------- |
| `pnpm dev`       | Start the reference app at http://localhost:3000.        |
| `pnpm build`     | Build all workspace projects that define `build`.        |
| `pnpm typecheck` | Type-check all workspace projects.                       |
| `pnpm test`      | Run all workspace tests.                                 |
| `pnpm lint`      | Check linting, formatting, and import order (read-only). |
| `pnpm lint:fix`  | Apply safe lint fixes and formatting.                    |
| `pnpm verify`    | Run lint, typecheck, test, and build in order.           |

Linting and formatting use [Biome](https://biomejs.dev/) (`biome.json`). Biome does not depend on
the TypeScript compiler, so it works with TypeScript 7, which typescript-eslint does not support yet.
React, Next.js, and test rules are enabled explicitly per path in `biome.json`, because Biome does
not detect them from nested `package.json` files when run from the repository root. Biome is pinned
to an exact version; upgrade it deliberately.

## Profile data

The reference app loads a profile JSON file from `apps/portfolio/profile/` and validates it with
`loadStructuredProfile` from `@promptfolio/core`. By default it loads `example.profile.json`, which
contains fictional sample data.

To use your own profile:

1. Copy `apps/portfolio/profile/example.profile.json` to `apps/portfolio/profile/profile.local.json`
   and edit it. Files matching `*.local.json` are not committed.
2. Copy `apps/portfolio/.env.example` to `apps/portfolio/.env.local`. It sets
   `PROMPTFOLIO_PROFILE_FILE=profile.local.json`.
3. Run `pnpm dev`. The page lists any validation issues with their paths.

Everything in the profile is treated as public, because it may be shown to visitors or sent to a
model. Do not include private information.

## Workspace conventions

- Packages expose their public API only through the `exports` field in `package.json`; importing
  package internals (for example, `@promptfolio/core/src/...`) is not supported.
- Packages are currently consumed from TypeScript source without a build step. A compiled build
  will be added before any package is published.
- Shared dependency versions are defined once in the `catalog` section of `pnpm-workspace.yaml`
  and referenced as `"catalog:"`.
- Commits follow Conventional Commits; see `CLAUDE.md`.
