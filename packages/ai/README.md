# @promptfolio/ai

The server side of chat: validates a request, continues the stored conversation, runs a model turn with read-only profile tools, streams the reply, and saves the conversation. Server-only, because the model you pass carries your provider key.

## Install

```sh
npm install @promptfolio/ai @promptfolio/core ai
```

The [AI SDK](https://ai-sdk.dev), `ai`, is a peer dependency, version 7: you create the model with it and read its stream. Requires Node.js 22 or later. ES modules only. The AI SDK's types use browser names such as `HeadersInit`, so a TypeScript project needs `"DOM"` in `lib`.

## Entry points

`@promptfolio/ai`:

| Export | Purpose |
| ------ | ------- |
| `handleChatRequest` | Takes a web `Request`, returns a streaming `Response` |
| `ChatLimit`, `ChatTurnLimiter` | The daily limit you implement. `limit` is required; `null` turns it off on purpose |
| `ChatHistory`, `ChatStore` | Where conversations are kept between turns, which you implement. `history` is required |
| `loadVisitorChat` | One of the visitor's stored conversations as the browser may see it: text, and with `replyDetails` the same lookups and model name as the live reply |
| `ReplyDetails` | Opt-in lookups and model name shown with a reply (see below) |
| `createMemoryChatStore` | A `ChatStore` in memory, for tests and local development |
| `generateStarterQuestions`, `STARTER_LIMITS` | Starters written by the model from a profile; generate once per profile, such as at build time |
| `CHAT_LIMITS`, `CHAT_MESSAGES` | The default limits and visitor text |
| `createFailoverModel` | A model that moves to the next one when a model fails before its answer starts |

`@promptfolio/ai/evaluation`, for your test tooling:

| Export | Purpose |
| ------ | ------- |
| `evaluateQuestion`, `scoreEvaluationTurn` | Run a question through the live turn and check what code can check |

You supply any AI SDK `LanguageModel`, the `Profile`, the limiter, and the conversation store. This package names no provider or store.

## Example

From [the minimal consumer](https://github.com/promptfolios/promptfolio/blob/main/apps/minimal-consumer/src/consumer.ts):

```ts
import { handleChatRequest } from "@promptfolio/ai";

handleChatRequest(request, {
  model,
  profile,
  additionalInstructions: "This page has a Contact button at the top.",
  limit: { limiter, identifyVisitor },
  history: { store, identifyOwner },
});
```

## Options

- **`additionalInstructions`:** text added after the base rules, for what only your site knows, such as a Contact button or the language to answer in. The model cannot see your page, so name a page element only when it exists. Write it in your server code and never take it from a request. It cannot replace the base rules, and a change to it calls for a new evaluation.
- **`limits`:** changes to `CHAT_LIMITS`, such as `{ maxMessages: 30, timeouts: { totalMs: 25_000 } }`. On a serverless host, keep `timeouts.totalMs` plus `limiterTimeoutMs` and twice `historyTimeoutMs` under the function's time limit. Daily allowances are not here: your limiter applies its own.
- **`visitorMessages`:** changes to `CHAT_MESSAGES`, the text a visitor sees when a request is refused or fails. `{ref}` and `{maxChars}` are filled in.

An invalid limit or message is logged by name, and the visitor gets the generic error.

## Conversation history

The browser sends only the new question, and the server keeps the conversation, following the AI SDK's [message persistence](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-message-persistence) pattern. A visitor cannot send earlier answers or tool results, and the model keeps its earlier lookups.

The request body is `{ id, message, parentId }`: the conversation's id, the visitor's message (text only), and the id of the message it follows, or `null` for the first. A browser using the AI SDK's `useChat` sends it with:

```ts
new DefaultChatTransport({
  api: "/api/chat",
  prepareSendMessagesRequest: ({ id, messages }) => ({
    body: { id, message: messages.at(-1), parentId: messages.at(-2)?.id ?? null },
  }),
});
```

What followed `parentId` is replaced, so an edited question or a regenerated answer works. The store keeps one branch: after an edit, the replaced messages are gone. A `parentId` the store does not have answers 409.

- **`store`:** `load` and `save` by owner and chat id. Store each conversation under both, so one visitor's chat id never finds another's. Set your own retention.
- **`identifyOwner`:** whose conversations a request may use, such as a random id in an `HttpOnly` cookie. It is the only key to a visitor's conversations, so it must be hard to guess.

The conversation is saved when the reply ends, including one the visitor stopped, before the stream closes. A failed save is logged, and the visitor still gets the answer. A failed load answers 503 without calling the model. `loadVisitorChat` returns a stored conversation for showing it again: text only, or with `replyDetails` and the `profile`, what the live reply showed. Tool calls and their results as the model saw them stay on the server.

## Reply details

With `replyDetails`, visitors also see how an answer was made ([ADR 0019](../../docs/adr/0019-lookups-and-model-shown-to-visitors.md)):

- **`tools: true`:** each profile lookup arrives as an AI SDK tool part (`tool-listProfileRecords`, `tool-getProfileRecord`) whose input is only `{ section?, skillFilter? }` and whose output is `{ status, title? }`, written by the server. The model's arguments and the full results never reach the browser.
- **`model(id)`:** the name to show for the model that answered, sent as `messageMetadata: { model }` on `finish`; return `undefined` to show none. Strip what visitors need not see, such as the provider or a failover list.

Pass the same value, and the profile, to `loadVisitorChat`, so a reloaded chat looks the same.

## Failover

```ts
import { createFailoverModel, handleChatRequest } from "@promptfolio/ai";

// One per request: it stays on the model that worked for one turn.
const model = createFailoverModel({
  models: [
    { label: "first", model: firstModel },
    { label: "next", model: nextModel },
  ],
  attemptFirstChunkMs: 8_000,
});
handleChatRequest(request, {
  model,
  profile,
  limit,
  history,
  limits: { maxRetries: 0, timeouts: { firstChunkMs: 23_000 } },
});
```

It moves on for an error, silence, or a reply with nothing in it, before the first content. The last model has its own limit, `lastAttemptFirstChunkMs`, 15 seconds by default. Once a visitor has seen text, a failure is reported as usual. Keep `timeouts.firstChunkMs` above the sum of the attempts, because that limit cancels the whole call, and use `maxRetries: 0`, or a retry runs the whole list again. A fallback receives the conversation, so list only providers whose terms you accept.

## Errors

`handleChatRequest` answers failures before the stream starts with a `Response`, so a route needs no error handling of its own. Later failures arrive as an `error` chunk in the stream. A logger you pass runs outside this guarantee, so it should not throw.

## Security

The system prompt is built here, not taken from a request. Limits on messages, tools, and output are enforced here too.

**Links in answers are yours to check.** The stream holds whatever the model wrote, and text in a public source could get it to write a link that sends the conversation elsewhere. Make only the profile's own URLs clickable:

```ts
const allowed = new Set(profileLinkUrls(profile)); // from @promptfolio/core
const isSafe = (href: string) => URL.canParse(href) && allowed.has(new URL(href).href);
```

Check links as they are rendered, so this covers every way Markdown can write one. The reference app does this in [`profile-link.tsx`](https://github.com/promptfolios/promptfolio/blob/main/apps/portfolio/src/components/chat/profile-link.tsx).

No model is endorsed. Answer quality depends on the model and the prompt together, so evaluate the one you deploy. The latest evaluation failed its gate: read the [known limitations](https://github.com/promptfolios/promptfolio/blob/main/docs/KNOWN_LIMITATIONS.md) and [results](https://github.com/promptfolios/promptfolio/blob/main/docs/evaluation/README.md) before relying on an answer.

## License

MIT
