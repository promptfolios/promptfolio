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
  *Update (M4):* each thread now runs `useAISDKRuntime(useChat({ transport }))` with the AI SDK's
  `DefaultChatTransport`; the thread list and adapter are unchanged (see
  [ADR 0003](0003-ai-sdk-selection.md), "Confirmation at M4").
- **Thread list:** `TitledInMemoryThreadListAdapter`, which extends assistant-ui's
  `InMemoryThreadListAdapter` to title threads from their first message. Threads reset on reload;
  a persistent adapter is planned for M6.
  *Update (M6):* replaced by `createBrowserThreadListAdapter`, which saves threads in
  `localStorage` and supplies per-thread history through `unstable_useAdapters`. assistant-ui's own
  `createLocalStorageAdapter` was not used: it is exported only from `@assistant-ui/core`, does not
  validate stored AI SDK messages, and has no size or retention limits (see the
  [M6 plan](../plans/m6-browser-conversation-persistence.md)).
  *Update (M18):* conversations move to the server ([ADR 0018](0018-server-side-conversation-history.md)), and the browser
  sends only its new question. The reference app's thread list follows in M18.2.
- **Starters:** `Suggestions(...)` from `src/config/starters.ts`, shown on the welcome screen;
  selecting one sends its prompt as the first message.
  *Update (M12.5):* the starters were removed. *Update (M12.10):* a model now writes them at build time
  ([ADR 0015](0015-generated-starter-questions.md)).

### Vendored code policy

Files copied by the shadcn and assistant-ui CLIs are treated as vendored:

- `src/components/ui/` (shadcn), `src/components/assistant-ui/` and `src/hooks/` (assistant-ui).
- They are excluded from Biome so they stay close to upstream and future updates produce
  reviewable diffs.
- Local changes are kept minimal and marked with a `Promptfolio change:` comment. Current changes
  in `thread.aui.tsx`: a visible focus ring on the composer, and, since M12.6, only the UI this app
  can show. The server sends visitors text and sources alone, so the registry's tool, reasoning,
  attachment, image, file, voice, suggestion, feedback, resume, and load-earlier UI was removed
  ([plan](../plans/m12-6-code-cleanup.md)). This is larger than the "minimal" rule above: a registry
  update to this file needs a manual merge, and turning a feature on means adding its component again.
  Spacing, corners, and the send button's shape follow assistant-ui's own demo (M12.10). In `thread-list.aui.tsx` (M12.8): an outlined New Thread button. In `markdown-text.tsx` (M12.7): the link check.
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
  input). *Update (M4):* the app uses the AI SDK's `DefaultChatTransport`, which sends neither,
  and the server accepts only text messages from `user` and `assistant` regardless.
