# Model requests and tokens

First appears in: **M4** (first AI integration); groundwork in M2 (`LIMITS`) and M3 (`ChatModelAdapter`). Status: **planned**.

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
turn 1:  [system + profile] [user 1]                              → reply 1
turn 2:  [system + profile] [user 1] [reply 1] [user 2]           → reply 2
turn 3:  [system + profile] [user 1] [reply 1] [user 2] [reply 2] [user 3] → reply 3
          └──────────── input tokens grow every turn ────────────┘   └ output tokens (capped)
```

Where size is bounded:

| Limit                              | Where                       | Status    |
| ---------------------------------- | --------------------------- | --------- |
| Profile text and list sizes        | `LIMITS` in `schema.ts`     | in use    |
| Visitor message length, thread size | `/api/chat` validation      | planned (M4) |
| Output tokens per reply            | model request option        | planned (M4) |

## 4. Where it lives in the code

- Profile size limits: [packages/core/src/profile/schema.ts](../../packages/core/src/profile/schema.ts) (`LIMITS`)
- The adapter contract a real model will fill (`run({ messages, abortSignal })`):
  [apps/portfolio/src/chat/placeholder-model.ts](../../apps/portfolio/src/chat/placeholder-model.ts)
- Server route, provider call, input and output limits: **planned** (M4)
- SDK choice (proposed, confirmed at M4): [ADR 0003](../adr/0003-ai-sdk-selection.md)

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
  (provider not chosen yet; other providers document the same idea)
