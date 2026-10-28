# Model requests and tokens

First appears in: **M4** (first AI integration); groundwork in M2 (`LIMITS`). Status: **in use**.

## 1. What it is

A model request is one HTTP call from the server to a model provider: system prompt, the
conversation so far, and options such as the model name and a maximum output length. The model has
no memory between calls. Providers measure input and output in *tokens* (word pieces), which set
both the cost and the hard size limit (the context window).

## 2. Why it matters in Promptfolio

- Each visitor turn resends the whole thread plus the profile context, so cost grows with
  conversation length. The spec requires bounding input length and token use on a public endpoint.
- The request must be made on the server, so the provider API key never reaches the browser
  ([ADR 0001](../adr/0001-reference-app-framework.md), [ADR 0003](../adr/0003-ai-sdk-selection.md)).

## 3. How it works

```
turn 1:  [system + identity] [user 1]                              → reply 1
turn 2:  [system + identity] [user 1] [reply 1] [user 2]           → reply 2
turn 3:  [system + identity] [user 1] [reply 1] [user 2] [reply 2] [user 3] → reply 3
           └──────────── input tokens grow every turn ────────────┘   └ output tokens (capped)
```

Where size is bounded:

| Limit                                  | Value                          | Where                     |
| -------------------------------------- | ------------------------------ | ------------------------- |
| Profile text and list sizes            | per field                      | `LIMITS` in `schema.ts`   |
| Raw request body                       | 100 KB, before JSON parsing    | `CHAT_LIMITS`, `request.ts` |
| Messages per request                   | 50                             | `CHAT_LIMITS`, `request.ts` |
| Characters per message / in total      | 4,000 / 20,000                 | `CHAT_LIMITS`, `request.ts` |
| Output tokens per reply (incl. thinking) | 1,000                        | `maxOutputTokens`         |
| Wait for the first content / between chunks / whole reply | 15 s / 10 s / 25 s | `CHAT_LIMITS.timeouts`, AI SDK `timeout` |
| Retries after a failed provider call   | 1                              | `CHAT_LIMITS.maxRetries`  |
| Time per reply on serverless hosts     | 30 s                           | `maxDuration` in `route.ts` |

Characters stand in for tokens because they are cheap to count before calling the provider.

Providers can be slow or overloaded. During M4 review, Gemini answered HTTP 503 ("high demand")
after up to 30 seconds, and the AI SDK's two default retries stretched one visitor's wait past a
minute with no feedback. The timeouts make that fail within 25 seconds instead, below the route's
30-second limit, so the visitor sees the generic error before a serverless host stops the function.

`PROMPTFOLIO_MODEL=provider:model` picks the model, for example `google:gemini-3.8-flash` or
`anthropic:claude-haiku-5-5`. Both think before answering by default, and thinking tokens count against
`maxOutputTokens`, so both run with low thinking: `thinkingConfig.thinkingLevel: "low"` for
Gemini, `effort: "low"` for Claude. These settings are provider-specific, so the app passes them
as `providerOptions` and `@promptfolio/ai` forwards them unchanged. Sampling settings
(`temperature`, `top_p`, `top_k`) are not sent: Anthropic's API rejects them.

Each finished reply logs its token usage on the server, for example
`[chat 691a183c] finished { finishReason: 'stop', usage: { inputTokens: 42, outputTokens: 12, … } }`.

## 4. Where it lives in the code

- Profile size limits: [packages/core/src/profile/schema.ts](../../packages/core/src/profile/schema.ts) (`LIMITS`)
- Chat limits: [packages/ai/src/limits.ts](../../packages/ai/src/limits.ts) (`CHAT_LIMITS`), enforced in
  [packages/ai/src/request.ts](../../packages/ai/src/request.ts)
- Provider call and usage logging: [packages/ai/src/chat-handler.ts](../../packages/ai/src/chat-handler.ts)
- Provider selection, model ids, and thinking settings:
  [apps/portfolio/src/server/model.ts](../../apps/portfolio/src/server/model.ts)
- SDK choice: [ADR 0003](../adr/0003-ai-sdk-selection.md); model choice:
  [M4 plan, Decisions](../plans/m4-first-ai-integration.md#decisions)

## 5. Common pitfalls and misconceptions

- Tokens are not characters or words. Rough rules of thumb vary by model and language; measure
  with the provider's token counting rather than guessing.
- "The model remembers the conversation." It doesn't; the app resends it. Forgetting this leads to
  surprise costs on long threads.
- Calling the provider from client code exposes the API key in the bundle.
- A successful, fluent response is not evidence that it is correct.

## 6. Further reading

- [AI SDK: generating text](https://ai-sdk.dev/docs/ai-sdk-core/generating-text)
- [Anthropic: token counting](https://docs.claude.com/en/docs/build-with-claude/token-counting)
