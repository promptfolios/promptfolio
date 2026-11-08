# ADR 0018: Server-side conversation history

- **Status:** Accepted
- **Date:** 2026-11-08

## Context

Since M6 the browser has kept conversations in `localStorage` and sent the whole list with every question, and the server stored
nothing ([M6 plan](../plans/m6-browser-conversation-persistence.md)). That has two costs:

- **History is visitor input.** A visitor can write an earlier "answer" stating a fact, and in [the M15
  run](../evaluation/README.md) the model repeated such facts. A prompt rule only asks it not to.
- **Tool context is lost between turns.** Tool calls and results never reach the browser, so they are never sent back, and a
  follow-up has none of the earlier lookups. A consumer worked around this with an instruction to look everything up again.

## Decision

`@promptfolio/ai` keeps the conversation on the server, following the AI SDK's [message
persistence](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-message-persistence) pattern.

- **The request is `{ id, message, parentId }`.** One user message, text only; earlier messages come only from the store.
  The old `{ messages }` request is removed, and `history` is a required option, like `limit`.
- **`parentId` names the message the new one follows,** and what followed it is replaced. The AI SDK's guide only appends, and
  its `trigger` and `messageId` fields cannot express an edit made in assistant-ui, which sends a new message with no
  `messageId`. assistant-ui's own history adapter stores each message with a `parentId`. The store keeps one branch.
- **The application implements `ChatStore`** (`load` and `save`, both by owner and chat id) and `identifyOwner`, so the package
  names no store. Isolation comes from the key: every call takes the owner.
- **The whole answer is saved,** tool calls and results included, after the raw-tool-call filter and before the visitor filter,
  and before the stream closes. A stopped reply is saved as far as it got; Stop still cancels the model.
- **Stored history is validated** against the current tools, because it outlives the code that wrote it. A conversation that no
  longer fits starts again from the question.
- **The browser still sees text only,** in the stream and in `loadVisitorChat`.

## Alternatives

- **Keep sending the whole list, and sign earlier answers.** The browser would store and return signatures; it fixes forgery
  but not lost tool context.
- **Append only, as the AI SDK's guide does.** Edit and Regenerate in the reference app would then store a duplicate question or
  a second branch after the first.
- **Store a tree, like assistant-ui's history adapter.** Every branch would survive a reload, at the cost of a tree in every store
  and a choice of branch on each load. One branch is enough for a portfolio chat.
- **`result.consumeStream()`, as the guide shows.** It finishes the model's answer when the visitor leaves, but it would also
  keep a stopped answer running and billed.

## Consequences

- A breaking change for every consumer: each needs a store and an owner. `createMemoryChatStore` covers tests and local
  development.
- The server now holds visitors' conversations, so the application sets retention and tells visitors.
- Input tokens grow, because earlier tool results are sent again each turn.
- A failed save loses the answer from the store, and a follow-up to it answers 409.
- The reference app moves to it in [M18.2](../plans/m18-2-server-history-in-app.md); the `localStorage` thread store goes.
