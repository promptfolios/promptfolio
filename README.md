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
| `packages/ai`    | `@promptfolio/ai`   | Server-only chat handler: validation, limits, streaming.      |
| `apps/portfolio` | `portfolio`         | Reference Next.js application; consumes the packages.         |
| `docs/`          | —                   | Roadmap, architecture decision records, and background notes. |

Dependency direction: apps depend on packages; packages never depend on apps.

The reference app's chat UI uses [assistant-ui](https://www.assistant-ui.com/) with Tailwind CSS
and shadcn/ui. Component code copied by their CLIs lives in `apps/portfolio/src/components/ui/`,
`apps/portfolio/src/components/assistant-ui/`, and `apps/portfolio/src/hooks/`; it is treated as
vendored and excluded from linting (see
[ADR 0007](docs/adr/0007-chat-ui-assistant-ui.md)).

Replies come from a model through the app's own `/api/chat` route, using the
[Vercel AI SDK](https://ai-sdk.dev/) with Google Gemini or Anthropic Claude. In this
milestone the model only knows the owner's name, headline, and summary; other questions get "this
information is not available here" until profile lookups arrive in M5.

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
to an exact version; upgrade it deliberately. `.claude/` (Claude Code tool configuration, which
tools may rewrite) is excluded from Biome.

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

## Model access

The app supports two providers. Configure them in `apps/portfolio/.env.local` (see
`.env.example`):

| Provider         | `PROMPTFOLIO_MODEL` value              | Key variable                   |
| ---------------- | -------------------------------------- | ------------------------------ |
| Google Gemini    | `google:gemini-3.8-flash` (default)    | `GOOGLE_GENERATIVE_AI_API_KEY` |
| Anthropic Claude | `anthropic:claude-haiku-5-5` (default) | `ANTHROPIC_API_KEY`            |

`PROMPTFOLIO_MODEL` is `provider:model`; `provider` alone uses its default model. Keep both keys in
the file and switch providers by changing that one line. If it is unset, the first provider in the
table whose key is set is used. Never prefix a key with `NEXT_PUBLIC_`: keys are read only on the
server. Set a monthly spend limit with
your provider, and check its data terms (some free tiers allow the provider to use prompts).

Without a key the app still builds and renders, but chat replies show an error. The endpoint has
input limits but no rate limiting yet (planned for M11), so **do not deploy it publicly** before
then.

## Workspace conventions

- Packages expose their public API only through the `exports` field in `package.json`; importing
  package internals (for example, `@promptfolio/core/src/...`) is not supported.
- Packages are currently consumed from TypeScript source without a build step. A compiled build
  will be added before any package is published.
- Shared dependency versions are defined once in the `catalog` section of `pnpm-workspace.yaml`
  and referenced as `"catalog:"`.
- Commits follow Conventional Commits; see `CLAUDE.md`.
- Text files use LF line endings. `.gitattributes` sets `eol=lf`, so Git checks them out with LF
  even on Windows, where the default would be CRLF; Biome's formatter rejects CRLF. If an older
  checkout still has CRLF files, delete and re-check them out (`git checkout -- <file>`) or run
  `pnpm lint:fix`.
