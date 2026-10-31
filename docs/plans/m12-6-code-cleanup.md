# M12.6 plan: code cleanup and folder layout

- **Status:** Done (2026-11-01), in review.
- **Date:** 2026-11-01
- **Background:** an audit for unnecessary code, requested by the developer, who approved its three scopes and added the
  move to nested folders.

## Objective

Remove what cannot run, reduce duplication, and group source files by what they do. No behavior changes for visitors.

## Scope

- **A. Unreachable chat UI.** The server sends visitors text and sources only (`VISITOR_CHUNK_TYPES`), so tool, reasoning,
  attachment, image, file, voice, suggestion, feedback, resume, and load-earlier UI could not appear. Removed, with
  `zustand`, `tw-shimmer`, and the shadcn avatar they alone used.
- **B. Duplication.** One helper for the files next to a profile (`profile-files.ts`), one `AppEnv` type, `RedisConfig`
  in the contact configuration, fewer exports, and no `id` or `messageId` in chat requests, which the server discarded.
- **C. Splitting.** `GitHubClient`, the pinned query, and the contributions search left `fetch.ts`. `runRefresh` was
  split into smaller functions.
- **Folders.** `packages/ai/src`, `packages/source-github/src`, and `apps/portfolio/src` were nested by responsibility.

## Exclusions

- `packages/contact/src` stays flat: its six files are one concept.
- `withinLimiterTimeout` stays in both `ai` and `contact`: sharing about ten lines is not worth a new dependency.
- `normalizeGitHubSnapshot` and other exports with no consumer yet stay: they are the packages' deliberate public API.
- The Anthropic provider stays. It costs nothing unless its key is set.
- Dated plans and evaluation results keep their old paths, because they record what was true then.

## Trade-off

`thread.aui.tsx` now differs further from the assistant-ui registry, so a registry update needs a manual merge. Turning
any removed feature on means adding its registry component again.

## Verification

- `pnpm verify`: lint, typecheck, build, and 688 tests, the same number as before.
- In the browser: a live answer with a tool lookup, a citation with its sources panel, a saved thread restored after a
  reload, and the contact dialog opened but not sent.
