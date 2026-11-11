# @promptfolio/ai

## 0.0.4

### Patch Changes

- 4abe083: Roles accept an optional `links` list, like projects, for pages such as the product worked on. `Role.links` is an empty array when the input has none, so existing profiles load unchanged.
  
  `listProfileRecords` includes each role's `links` in its summary, so a model that answers from the list alone can link roles too.
- Updated dependencies [e65256a]
- Updated dependencies [b2eb73e]
- Updated dependencies [4abe083]
  - @promptfolio/core@0.0.4

## 0.0.3

### Minor Changes

- 56db410: `listProfileRecords` now includes each project's `links` in its summary, so a model that answers from the list alone can still link projects. The tool description and the system prompt no longer send the model to `getProfileRecord` for links.
  
  A project with the same id as a repository also gets that repository's url as `repositoryUrl`, and the list's `sources` then include the repository's source.
- 77443c1: New opt-in `replyDetails` option for `handleChatRequest` and `loadVisitorChat`, to show visitors how an answer was made.
  
  - `replyDetails.tools: true` sends each profile lookup as an AI SDK tool part, with content the server writes: the input keeps only `section` and `skillFilter: true`, and the output is `{ status, title? }`, with `title` only for a record that was found, looked up in the profile. Model-written arguments, full results, and calls to tools the server does not have are never sent. Without the option the browser still receives text only.
  - `replyDetails.model(id)` returns the name to show for the model that answered, sent as `messageMetadata: { model }` on `finish`, or `undefined` to show none.
  - Each answer is now saved with `metadata.modelId`, the id of the model that answered its last step.
  - `loadVisitorChat` accepts the same `replyDetails` and the `profile`, so a reloaded chat shows the same lookups and model name as the live one.
  - A failover model now reports the answering entry's label as the response's model id when its provider reports none, instead of every label. The `finished` log line shows it too.
  - New exported types: `ReplyDetails`, `VisitorToolInput`, `VisitorToolOutput`, `VisitorToolStatus`, `VisitorReplyMetadata`.
- 4792e5d: **Breaking:** the server keeps the conversation, and the browser sends only its new question.
  
  - `handleChatRequest` requires `history: { store, identifyOwner }`. You implement `ChatStore` (`load` and `save`, by owner and chat id); `createMemoryChatStore` is for tests and local development.
  - The request body is `{ id, message, parentId }`: the conversation's id, one user message with text parts only, and the id of the message it follows, or `null`. What followed `parentId` is replaced, so edits and regenerated answers work. The `{ messages }` body is no longer accepted. See the README for the `useChat` transport.
  - The whole answer is saved when the reply ends, tool calls and results included, so the model keeps its earlier lookups. A stopped reply is saved as far as it got. Assistant message ids are now made on the server.
  - `loadVisitorChat` returns a stored conversation as text only, for showing it again. `isChatId` checks an id taken from a URL.
  - New limit `historyTimeoutMs` (2 seconds) for each store call; `maxMessages` and `maxTotalChars` now count the stored history. New visitor text `unknownConversation`, sent with 409 for a `parentId` the store does not have. A failed load or a request with no owner answers 503.

### Patch Changes

- 2073e04: Chat logs now name the model. The `finished` line includes `model`: the id the provider reports for the model that answered, or the configured model's id when it reports none. The `model error` line includes the configured model's id. A failover model also logs `[failover] continuing with <label>` when it has moved on and the next model starts answering.
- f5ea599: The model now gets told what each profile section holds, so a question that says "projects" no longer picks that section alone.
  
  - The system prompt opens with the profile sections, one line each, and how a visitor's words map to them. `listProfileRecords`'s `section` argument describes each section too.
  - An empty `projects`, `repositories`, or `contributions` list carries a `note` naming the other two sections, so the model checks them before saying there is none.
  - The prompt's history rules match server-side history: a tool result anywhere in the conversation counts as evidence, and the text of earlier messages still does not.
- bb67631: Tool-call log lines can now be told apart. A `listProfileRecords` line includes its `section` and `skillFilter: true` when a skill filter was used (never the skill itself), and a `getProfileRecord` line includes the `id` when the record was found. Other arguments are still not logged, because they may echo visitor text.
- @promptfolio/core@0.0.3

## 0.0.2

### Patch Changes

- Updated dependencies [ac462a0]
  - @promptfolio/core@0.0.2
