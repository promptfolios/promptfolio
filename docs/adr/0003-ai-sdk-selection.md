# ADR 0003: AI SDK selection

- **Status:** Accepted (confirmed at M4, 2026-10-28; see "Confirmation at M4"; OpenRouter added
  at M7.1 and AI Gateway at M7.2, 2026-10-29; see "Update at M7.1" and "Update at M7.2")
- **Date:** 2026-10-27

## Context

The MVP needs streaming chat, typed tool calling with validated inputs, multi-step tool loops, and
a React chat hook with loading, error, and retry states. The specification asks to compare
TanStack AI and the Vercel AI SDK on their current stable APIs and to avoid experimental agent
harnesses.

Registry facts at the time of evaluation (2026-10-27):

- **TanStack AI** (`@tanstack/ai`): 1.0.0 published 2026-10-22, after about 70 pre-1.0 minor
  releases since December 2025. Documentation was inconsistent right after 1.0 (for example, the
  removed `addToolApprovalResponse` API still appeared on several pages).
- **Vercel AI SDK** (`ai`): 7.0.x; 7.0.0 published 2026-06-25. Earlier majors (v5, v6) still
  receive patches under separate tags. A new major has appeared roughly every six months.

## Proposed decision

Use the **Vercel AI SDK v7**, limited to its core, non-experimental APIs: `streamText`, `tool`,
`stopWhen`, and `useChat` from `@ai-sdk/react`. Use a direct provider package rather than the
default AI Gateway model strings, to avoid coupling to one hosting vendor.

Avoid experimental features such as `experimental_sandbox` and `HarnessAgent`.

## Rationale

- More release maturity on the current major and broader documentation and examples, which matter
  for a learning project; its examples use Next.js route handlers, matching ADR 0001.
- TanStack AI offers attractive design (isomorphic tool definitions, per-provider adapters), but
  1.0 was days old at evaluation time.

## Lock-in mitigation

- AI SDK types stay inside `@promptfolio/ai`; tool logic in `core` remains SDK-free.
- Contact confirmation (M10) is enforced by a separate server endpoint and UI action, not by the
  SDK's tool-approval feature, so switching SDKs only affects one package.

## Confirmation at M4

Checked against the installed types of `ai` 7.0.154, `@ai-sdk/anthropic` 4.0.89, and
`@assistant-ui/ai-sdk` 0.0.15:

- Server: `streamText` with `instructions` (the v7 name; `system` is deprecated),
  `convertToModelMessages` (async), and `toUIMessageStream` returned through
  `createUIMessageStreamResponse`. `allowSystemInMessages` defaults to `false`.
- Client: `useChat` from `@ai-sdk/react` with `DefaultChatTransport`, adapted for assistant-ui by
  `useAISDKRuntime`. assistant-ui's `useChatRuntime` was not used: it creates its own thread list,
  and its `AssistantChatTransport` sends a `system` prompt and `tools` from the browser.
- Providers: `@ai-sdk/google` (4.0.106) and `@ai-sdk/anthropic`, selected by
  `PROMPTFOLIO_MODEL=provider:model` (defaults `gemini-3.8-flash` and `claude-haiku-5-5`; the
  same `provider:model` convention as the AI SDK's provider registry). Thinking is
  set low through `providerOptions`: `google.thinkingConfig.thinkingLevel` and
  `anthropic.effort`. `@promptfolio/ai` stays provider-agnostic; only the app's
  `src/server/chat/model.ts` knows the providers.
- Tests use `MockLanguageModelV4` from `ai/test` and `simulateReadableStream` from `ai`.
- The UI message stream forwards provider `custom` parts (for example Anthropic's message id and
  usage) with no option to turn them off; `@promptfolio/ai` filters them out.

## Update at M7.1

Gemini's free tier kept answering 429 and 503, which blocked development and the
`prepare-answers` script. A third provider, `openrouter`, was added with
`@openrouter/ai-sdk-provider` 3.1.0 (peer `ai ^7.0.0`, `LanguageModelV4`), maintained by
OpenRouter. See the [M7.1 plan](../plans/m7-1-openrouter-provider.md).

- **Why a router is acceptable here.** This ADR prefers direct provider packages to avoid coupling
  to one hosting vendor. OpenRouter is a gateway too, but it is optional: one entry in
  `src/server/chat/model.ts`, last in the fallback order, and the direct providers stay.
  `@promptfolio/ai` does not know about it.
- **Why this package and not `@ai-sdk/openai-compatible`.** Only this one sends OpenRouter's
  documented `reasoning` parameter and returns `reasoning_details` between tool steps, which
  thinking models can need in the 4-step loop.
- **Reasoning.** Set through `providerOptions.openrouter.reasoning.effort: "low"`. The adapter
  ignores the call-level `reasoning` option.
- **Default model.** A free model, `google/gemma-4-31b-it:free` (developer's choice). Free models
  have daily quotas, are added and removed often, and are served by hosts with their own data
  policies, so the default may need replacing and a paid model is advised for the real profile.

## Update at M7.2

OpenRouter's free models ran out too (most likely the daily cap), so a fourth provider,
`gateway` (Vercel AI Gateway), was added. See the [M7.2 plan](../plans/m7-2-ai-gateway-provider.md).

- **Not a reversal of this ADR.** The ADR chose direct provider packages *instead of* AI Gateway
  model strings. The app still never uses plain model strings: the gateway is one optional entry
  in `src/server/chat/model.ts`, last in the fallback order, created with `createGateway({ apiKey })`.
  `@promptfolio/ai` does not know about it.
- **No new dependency.** `ai` already depends on `@ai-sdk/gateway` and re-exports
  `createGateway`.
- **Options.** The gateway runs the upstream AI SDK provider, so `anthropic` and `google` options
  pass through by vendor name. Other vendors keep their default reasoning.
- **Default model.** `nvidia/nemotron-3.5-lightning-free`, a `$0` model (developer's choice). None
  of its upstreams agrees not to train on prompts, so `disallowPromptTraining` is off. The
  example profile is the intended use; a paid model with that filter is advised for the real
  profile.

- Expect a major upgrade roughly every six months, with deprecations to follow.
- Revisit TanStack AI if it stabilizes and the AI SDK becomes a poor fit.

## Update at M13.1

`ai` became a peer dependency of `@promptfolio/ai`, because a consumer creates the model with it and reads its stream. So AI SDK
types do cross the package boundary (`LanguageModel`, the UI message stream), which the lock-in mitigation above understated.
The record lookups live in `core` and are SDK-free, but the tool definitions wrapping them are in `@promptfolio/ai`.

Supporting one SDK is deliberate, for simplicity. Supporting others is possible and is recorded as a
[future idea](../ROADMAP.md#supporting-other-ai-sdks).
