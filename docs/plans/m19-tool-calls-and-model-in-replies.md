# M19 plan: tool calls and model shown in replies

- **Status:** Plan approved (2026-11-08). Implemented; waiting for review. Starts after [M18.2](m18-2-server-history-in-app.md).
- **Date:** 2026-11-08
- **Roadmap:** not listed yet. From a consumer app's review: visitors should see that answers come from real lookups, live,
  as modern chat apps show them.

## Objective

While a reply streams, show each lookup ("Looking up projects…", then "Looked up projects"), and after it, the model that
answered. Opt-in, so the default stays text only.

**Excluded:** raw tool arguments and results in the browser, and the provider, route, or failover order.

## Design

Real AI SDK tool parts, rendered with assistant-ui's tool UI, with content the server trims. Since M18 the browser never sends
history back, so a tool part in the browser cannot reach the model; trimming keeps visitor text, full records, and model-written
text off the page, and keeps tool results from becoming a public contract.

| Chunk from the model | What the visitor receives (`replyDetails.tools`) |
| --- | --- |
| `tool-input-start` | passed, so the call shows as running |
| `tool-input-delta` | dropped (the arguments as they are written) |
| `tool-input-available` | `input` with only `section` and `skillFilter: true`; no model-written id |
| `tool-output-available` | `output` replaced by `{ status, title? }`; `title` only for `found`, from the server's profile |
| `tool-input-error`, `tool-output-error` | `{ status: "failed" }`; `toolName` only if it is one of the server's tools |

- **Where:** a transform in [chat-turn.ts](../../packages/ai/src/chat/chat-turn.ts) builds each chunk from scratch.
  `forVisitor` passes `tool-*` chunks only when the option is on and only from that transform.
- **Reload:** `loadVisitorChat` trims stored tool parts with the same function, so a reloaded chat looks like the live one.
  Full results stay in the store, for the model.
- **Model:** `response.modelId` of the last `finish-step`, sent as `messageMetadata` on `finish` and saved with the message.
  The failover model adds the answering entry's `label` when the provider reports none. `replyDetails.model(id)` returns the
  name to show, or `undefined`; the reference app shows the model name only.
- **UI:** per-tool components through `components.tools.by_name` in `thread.aui.tsx` (a `Promptfolio change:`), switching on
  `part.state` as the AI SDK docs do, with fixed labels; a model line after the answer.

## Tests

- Marker strings in tool arguments and results appear in neither the stream nor `loadVisitorChat`; an invented tool name never
  reaches the browser.
- A call's `tool-input-start` arrives before its output; with the option off, no `tool-*` chunk is sent.
- A reloaded chat matches the live stream.
- Failover reports the answering label when the provider has no id.

## Documentation

**ADR 0019:** what tool activity and model names visitors may see, amending ADR 0007's "tool activity stays on the server".
A pitfall in `tool-calling.md`: a display summary is not tool context.

## Verification

`pnpm verify`, then a browser preview screenshot taken mid-stream showing a running lookup.

## Implementation notes

- **Reload:** `loadVisitorChat` returned text only since M18.1, so it now takes `replyDetails` and the profile and uses the
  same summary functions; the app's history route loads the profile for it.
- **Errors:** an invalid call or a failed tool becomes `tool-output-available` with `{ status: "failed" }`, so every visitor
  result has one shape. A call to an unknown tool is dropped entirely, since it is not a lookup.
- **UI:** the vendored thread renders through `MessagePrimitive.GroupedParts`, which has no `components` prop, so its
  `tool-call` case picks the component from a by-name map. assistant-ui gives tool parts a `status` (running, complete,
  incomplete) converted from the AI SDK's `state`, so the components switch on that.
