# M13 plan: library readiness

- **Status:** Plan approved (2026-11-02). M13.1 is done and approved (2026-11-02). M13.2 is done and approved (2026-11-02). M13.3 is done and approved (2026-11-02). M13.4 is done and approved (2026-11-02). M13.5 is done and approved (2026-11-02), so M13's steps are complete. Publishing is a later milestone.
- **Date:** 2026-11-02
- **Roadmap:** [M13](../ROADMAP.md#m13--library-readiness).

## Objective

Get `@promptfolio/core`, `@promptfolio/ai`, and `@promptfolio/source-github` ready to publish, without publishing them.
A readiness review found that a published install would not load, so packaging comes after the API fixes that would
otherwise have to be released twice.

## Decisions

- **Version:** the first release is `0.0.1`, for all three. `^0.0.1` matches only that version, so consumers upgrade by
  hand. Move to `0.1.0` when the first outside project adopts them.
- **License:** MIT. The developer chose the name on the copyright line.
- **npm scope:** the developer controls `@promptfolio`.
- **Peer dependencies:** a heavy dependency that a consumer certainly depends on directly is a peer. So `ai` is a peer.
  `zod` stays a regular dependency, because a consumer of `core` or `source-github` never touches it and `ai` accepts
  zod 3 or 4 while the packages use zod 4. `@promptfolio/core` stays a regular dependency, because it is small and passes
  plain data, so a duplicate copy does no harm.
- **One SDK for now:** the packages support the Vercel AI SDK only. Supporting others is possible and is recorded as a
  future idea in M13.5, with nothing built for it.

## Steps

Each step is implemented and reviewed separately.

| Step | Scope | Main files |
| ---- | ----- | ---------- |
| M13.1 `ai` API | Independence from the app, configuration, error handling, peer dependency, evaluation subpath | `packages/ai/**`, chat routes, `chat-limit.ts`, `minimal-consumer`, chat limit guide |
| M13.2 Small fixes | Stop exporting `ProfileInput`; token message that names no variable | `core/index.ts`, `github-client.ts`, `fetch-pinned.ts` |
| M13.3 Packaging | Build, manifests, MIT license, READMEs, version `0.0.1` | `tsconfig*`, package manifests, relative imports, `LICENSE`, READMEs |
| M13.4 CI and versioning | CI, a test of the packed tarballs, Changesets | `.github/workflows/`, a pack-test script, `.changeset/` |
| M13.5 Docs and evaluation | SDK idea, the link rule, limitations, an evaluation run on free quota | `ROADMAP.md`, ADR 0003, `KNOWN_LIMITATIONS.md`, evaluation results |

**Excluded:** publishing, removing `private: true`, deployment, SDK adapters, and changes to `packages/contact`.
Publishing becomes its own milestone, with its own approval.

## M13.1 design

```ts
handleChatRequest(request, {
  model, profile, limit,
  additionalInstructions: contactEnabled ? "The page has a Contact button at the top." : undefined,
  limits: { maxMessages: 30, timeouts: { totalMs: 25_000 } },
  visitorMessages: { visitorLimit: "..." },
});
```

- **Prompt:** `additionalInstructions` appends after the base rules, which keep priority, and replaces
  `contactFormAvailable`. It comes from the application's server code, never from a request. `generateStarterQuestions`
  gets the same option, plus its own limits.
- **Limits:** `CHAT_LIMITS` become the defaults. `timeouts` and `maxOutputTokens` move into `limits`. The daily answer
  limits move to the application, whose limiter applies them.
- **Visitor text:** `CHAT_MESSAGES` are the defaults. They are plain strings with `{ref}` and `{maxChars}`, so no
  consumer code runs while an error is being reported. The option is `visitorMessages`, because `messages` means the
  conversation everywhere else in the AI SDK.
- **Invalid options:** logged by name, with the generic error for the visitor. Never a rejected promise.
- **Errors:** `handleChatRequest` returns a `Response` for anything it can catch. A body that cannot be read is a 400, and
  a failed turn setup is a 500 that logs only the error's type.
- **Types:** `runChatTurn` and `createProfileTools` get explicit return types, so declarations can be generated.
- **Evaluation:** moves to `@promptfolio/ai/evaluation`.
- **Peer dependency:** `ai` moves to `peerDependencies`, and stays in `devDependencies` for the package's own tests.

## M13.3 design

Plain `tsc`, with `.ts` on relative imports and `rewriteRelativeImportExtensions` turning them into `.js` in the output.
The workspace keeps exporting `src`, and `publishConfig.exports` points published installs at `dist`. A scratch prototype
on `core` loaded in Node, packed only `dist` and `package.json`, and resolved types under NodeNext and Bundler. Next.js with
`.ts` import paths is untested, so it is the first check, and `.js` import paths are the fallback.

## Release checklist

For the publishing milestone. Package tests use saved GitHub responses, so they cannot notice GitHub changing, and live calls
in CI would be flaky and hit rate limits. So before each release:

- Run `pnpm --filter portfolio refresh` by hand, with a token, against real GitHub.
- Log in with `pnpm login` and check `pnpm whoami`. An `npm login` alone was not enough, and the registry answered an unauthenticated
  publish with a 404 that looked like a missing scope.
- Build the packages, then run `pnpm changeset publish`, which uses pnpm, publishes in dependency order, and tags each package.
- Run `git push --follow-tags`.
- Install from npm in a separate project. New packages took up to a few minutes to appear after `0.0.1`, returning 404 until then.

## Dependencies

- `@changesets/cli` (new, dev only, M13.4): version bumps and changelogs, keeping all three packages on one version.
  Bumping by hand is simpler but easy to get wrong.
- `tsdown` is not used: nothing needs bundling, and its declaration output with TypeScript 7 is unverified.

## Acceptance criteria

- `packages/ai/src` no longer mentions a Contact button or the app's route limit.
- Tests cover `additionalInstructions`, custom and invalid limits, custom messages, and failed body reads and turn failures
  returning a `Response`.
- `pnpm verify` passes with the apps using only public APIs, and the prompt rules still apply when `additionalInstructions` is set.
- A CI test packs the tarballs, installs them in a separate project, loads them in Node, and type-checks them under
  NodeNext and Bundler.
- Tarballs contain `dist`, `README`, `LICENSE`, and `package.json`, with no tests or fixtures.
- Learning notes cover package exports and builds, peer dependencies, and additional instructions.

## Verification

`pnpm verify` for each step; `pnpm dev` and a real `next build` for M13.3; the pack test for M13.4; the evaluation for M13.5,
which uses free model quota, so it is confirmed with the developer before it runs.
