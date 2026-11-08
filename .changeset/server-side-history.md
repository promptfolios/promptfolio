---
"@promptfolio/ai": minor
---

**Breaking:** the server keeps the conversation, and the browser sends only its new question.

- `handleChatRequest` requires `history: { store, identifyOwner }`. You implement `ChatStore` (`load` and `save`, by owner and chat id); `createMemoryChatStore` is for tests and local development.
- The request body is `{ id, message, parentId }`: the conversation's id, one user message with text parts only, and the id of the message it follows, or `null`. What followed `parentId` is replaced, so edits and regenerated answers work. The `{ messages }` body is no longer accepted. See the README for the `useChat` transport.
- The whole answer is saved when the reply ends, tool calls and results included, so the model keeps its earlier lookups. A stopped reply is saved as far as it got. Assistant message ids are now made on the server.
- `loadVisitorChat` returns a stored conversation as text only, for showing it again. `isChatId` checks an id taken from a URL.
- New limit `historyTimeoutMs` (2 seconds) for each store call; `maxMessages` and `maxTotalChars` now count the stored history. New visitor text `unknownConversation`, sent with 409 for a `parentId` the store does not have. A failed load or a request with no owner answers 503.
