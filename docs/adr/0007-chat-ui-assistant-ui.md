# ADR 0007: assistant-ui for the chat workspace

- **Status:** Accepted
- **Date:** 2026-10-27

## Context

The reference app needs a full chat workspace: a conversation list with switching, a message
view, a composer, starter prompts, and loading, error, and retry states. The goal is learning AI
engineering, so building and maintaining chat UI components and thread-switching logic by hand is
not a good use of time. The chosen UI must work with the AI SDK (ADR 0003) and Next.js (ADR 0001).

## Options considered

1. **assistant-ui** (`@assistant-ui/react` 0.15.x): chat components and runtime, including a
   thread list with switching, suggestions, Markdown rendering, tool-call UI, and an AI SDK v7
   integration (`useChatRuntime`). Styled components are copied into the project via the shadcn
   CLI. Core package is pre-1.0 with frequent releases; some APIs are marked `unstable_`.
2. **shadcn AI Elements** (successor of Vercel's AI SDK Elements): copy-paste presentational
   patterns (chat, message, prompt input, suggestion, tool, confirmation, sources). No thread list
   or multi-thread state: switching and per-thread state would be ours to build.
3. **CopilotKit:** an agent framework with its own runtime and backend model; more than needed.
4. **NLUX, chatscope, Deep Chat:** inactive, not AI-oriented, or low adoption.

## Decision

Use **assistant-ui** with its shadcn-based styled components, which brings **Tailwind CSS v4** and
**shadcn/ui** (Radix flavor, "nova" preset) into `apps/portfolio`.

- **Runtime:** `useRemoteThreadListRuntime` with one `useLocalRuntime` per thread. The model is a
  `ChatModelAdapter`; in M3 it is a clearly labelled placeholder, replaced by the AI SDK in M4.
- **Thread list:** `TitledInMemoryThreadListAdapter`, which extends assistant-ui's
  `InMemoryThreadListAdapter` to title threads from their first message. Threads reset on reload;
  a persistent adapter is planned for M6.
- **Starters:** `Suggestions(...)` from `src/config/starters.ts`, shown on the welcome screen;
  selecting one sends its prompt as the first message.

### Vendored code policy

Files copied by the shadcn and assistant-ui CLIs are treated as vendored:

- `src/components/ui/` (shadcn), `src/components/assistant-ui/` and `src/hooks/` (assistant-ui).
- They are excluded from Biome so they stay close to upstream and future updates produce
  reviewable diffs.
- Local changes are kept minimal and marked with a `Promptfolio change:` comment. Current changes
  in `thread.aui.tsx`: show the attachment button only when attachments are configured, and a
  visible focus ring on the composer.
- The CLI placed assistant-ui files directly in `src/components/`; they were moved to the layout
  their own imports expect (`components/assistant-ui/elements` and `.../utils`).

## Consequences

- Most chat UI and thread state comes from the library; our code is the runtime wiring, adapters,
  and app-specific configuration.
- Pre-1.0 dependency: versions are recorded in the lockfile and upgrades should be deliberate.
- About 5,700 lines of vendored component code are excluded from linting. Biome reported
  accessibility findings in it (`useSemanticElements`, `noStaticElementInteractions`,
  `useAriaPropsSupportedByRole`) that the M11 accessibility review must assess.
- `next/font/google` downloads the Geist font at build time; builds need network access.
- The message body sent by assistant-ui's AI SDK transport can include a `system` prompt and
  `tools` from the browser. The M4 server route must ignore these and define its own (untrusted
  input).
