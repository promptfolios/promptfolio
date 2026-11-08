---
"@promptfolio/ai": minor
---

New opt-in `replyDetails` option for `handleChatRequest` and `loadVisitorChat`, to show visitors how an answer was made.

- `replyDetails.tools: true` sends each profile lookup as an AI SDK tool part, with content the server writes: the input keeps only `section` and `skillFilter: true`, and the output is `{ status, title? }`, with `title` only for a record that was found, looked up in the profile. Model-written arguments, full results, and calls to tools the server does not have are never sent. Without the option the browser still receives text only.
- `replyDetails.model(id)` returns the name to show for the model that answered, sent as `messageMetadata: { model }` on `finish`, or `undefined` to show none.
- Each answer is now saved with `metadata.modelId`, the id of the model that answered its last step.
- `loadVisitorChat` accepts the same `replyDetails` and the `profile`, so a reloaded chat shows the same lookups and model name as the live one.
- A failover model now reports the answering entry's label as the response's model id when its provider reports none, instead of every label. The `finished` log line shows it too.
- New exported types: `ReplyDetails`, `VisitorToolInput`, `VisitorToolOutput`, `VisitorToolStatus`, `VisitorReplyMetadata`.
