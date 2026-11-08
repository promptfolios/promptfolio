# ADR 0019: Lookups and model shown to visitors

- **Status:** Accepted
- **Date:** 2026-11-08
- **Amends:** [ADR 0007](0007-chat-ui-assistant-ui.md) ("the server sends visitors text alone")

## Context

Until M19 the stream to the browser was an allowlist of text chunks: tool calls and results stayed on the server. One reason
was that the browser sent the whole conversation back, tool parts included, and anything it sent could be forged. Since
[ADR 0018](0018-server-side-conversation-history.md) the browser sends only its new question and the model's context comes
from the store, so a tool part in the browser can no longer reach the model.

A consumer's review asked for what modern chat apps show: each lookup while the answer streams, and the model that answered,
so visitors can see that an answer comes from real lookups.

## Decision

`handleChatRequest` takes an opt-in `replyDetails` option. Without it the browser still receives text only.

- **`replyDetails.tools` sends real AI SDK tool chunks, written by the server** (`visitorToolChunks` in
  [reply-details.ts](../../packages/ai/src/chat/reply-details.ts)). Every chunk is built from scratch:

  | Chunk from the model | What the visitor receives |
  | --- | --- |
  | `tool-input-start` | passed (or added, if the provider sent none), so the call shows as running |
  | `tool-input-delta` | dropped: the arguments as the model writes them |
  | `tool-input-available` | `input` with only `section` and `skillFilter: true`; no model-written id |
  | `tool-output-available` | `output` replaced by `{ status, title? }`; `title` only for `found`, looked up in the profile |
  | `tool-input-error`, `tool-output-error` | `tool-output-available` with `{ status: "failed" }` |
  | any chunk of a call to a tool the server does not have | dropped |

  `forVisitor` passes `tool-*` chunks only through this function, so a chunk type the AI SDK adds later is not passed by
  accident.
- **`replyDetails.model(id)` names the model.** The id of the last step's response is saved with the answer as
  `metadata.modelId`. On `finish`, visitors receive `messageMetadata: { model }` with the name the function returns, or none.
  A failover model reports the answering entry's label when its provider reports no id. The reference app shows the model
  name only, never the provider, route, or failover order.
- **A reloaded chat matches the live one.** `loadVisitorChat` summarizes stored tool parts with the same functions, given the
  same `replyDetails` and the profile. The store keeps the full results, for the model.
- **The reference app renders them with assistant-ui's tool UI,** one component per tool name, with fixed labels.

## Alternatives

- **Raw tool parts.** The AI SDK's default. Visitors would see the model's arguments (which can repeat their own or another
  visitor's words when shared), full records, README text, and the result format, which would become a public contract.
- **Custom `data-*` parts.** Equally safe, but the AI SDK and assistant-ui already have tool parts with running and finished
  states; data parts would rebuild them.
- **Text in the answer ("I looked up projects").** The model would write it, so it would not prove a lookup happened.

## Consequences

- Visitors learn the two tool names and their sections. They are fixed and hold no profile data.
- The visitor summary (`{ status, title? }`) is a small public format; the tool results can still change freely.
- A lookup still running when a reply was stopped shows as stopped live and is left out on reload.
- The history route loads the profile to look up titles again; a record removed since shows without its title.
