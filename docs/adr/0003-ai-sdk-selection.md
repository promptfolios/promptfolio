# ADR 0003: AI SDK selection

- **Status:** Proposed (to be confirmed at M4, after re-checking current versions)
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

## Consequences

- Expect a major upgrade roughly every six months, with deprecations to follow.
- Revisit TanStack AI if it stabilizes and the AI SDK becomes a poor fit.
