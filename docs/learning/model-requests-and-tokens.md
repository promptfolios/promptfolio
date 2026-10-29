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
| Output tokens per model call (incl. thinking) | 2,000 (1,000 before M7.1) | `maxOutputTokens`   |
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

Since M7.1, `openrouter:vendor/model` sends requests through **OpenRouter**, a model router: one
API and one key (`OPENROUTER_API_KEY`) that forwards each request to one of many upstream
providers. It was added because Gemini's free tier kept answering 429 and 503. Things that work
differently there:

- Model ids are OpenRouter's, for example `anthropic/claude-haiku-5.5` rather than
  `claude-haiku-5-5`. Only the first `:` in `PROMPTFOLIO_MODEL` separates the provider, so
  `openrouter:google/gemma-4-31b-it:free` keeps the `:free` suffix.
- The default is that free model. Free models allow 20 requests per minute and 50 per day (1,000
  per day once 10 credits have been bought), and they are added and removed often. One
  `prepare-answers` run is 10 to 20 requests. Free models are served by hosts with their own
  logging and training policies, so prefer a paid model when the real profile is loaded.
- Low reasoning is `providerOptions.openrouter.reasoning.effort: "low"`. The adapter
  (`@openrouter/ai-sdk-provider`) ignores the AI SDK's call-level `reasoning` option, and it copies
  everything under `providerOptions.openrouter` into the request body as is.
- In a tool loop, thinking models may need their earlier reasoning sent back, unchanged, in the
  next step of the same turn. The adapter keeps OpenRouter's `reasoning_details` in provider
  metadata and returns them, which `@ai-sdk/openai-compatible` does not. The output allowlist
  still keeps reasoning and metadata away from the browser.
- `effort: "low"` is a hint, not a limit. During M7.1's checks `recursive/flint-v1.0:free` reasoned
  for 1,219 tokens on one starter, used up the 1,000-token cap, and finished with `length` and
  no answer. `maxOutputTokens` was raised to 2,000 per call. The cap counts only generated
  tokens; the conversation sent in is input and does not reduce it.

Since M7.2, `gateway:vendor/model` (with `AI_GATEWAY_API_KEY`) uses **Vercel AI Gateway**. It
works differently from OpenRouter's adapter:

- It is a *remote provider*: the adapter sends the AI SDK call itself (prompt, tools,
  `providerOptions`, limits) to Vercel, which runs the matching upstream AI SDK provider. So
  upstream options pass through by vendor name (`anthropic.effort`, Google's `thinkingConfig`),
  and gateway routing options go under `providerOptions.gateway`.
- Its free tier is a **monthly dollar credit** for a subset of models, with unpublished per-model
  rate limits, rather than a daily request cap. `$0` models, such as the default
  `nvidia/nemotron-3.5-lightning-free`, cost nothing at all.
- `providerOptions.gateway.disallowPromptTraining: true` routes only to upstreams that agree not
  to train on prompts. The default `$0` model has no such upstream, so the gateway would refuse
  every request with the filter on; it is off. Use the default with the example profile only.
- Nemotron gets no low-reasoning option (only `anthropic` and `google` keys are set), so it reasons
  at its default level, under the 2,000-token cap.

Each finished reply logs its token usage on the server, for example
`[chat 691a183c] finished { finishReason: 'stop', usage: { inputTokens: 42, outputTokens: 12, … } }`.

## 4. Where it lives in the code

- Profile size limits: [packages/core/src/profile/schema.ts](../../packages/core/src/profile/schema.ts) (`LIMITS`)
- Chat limits: [packages/ai/src/limits.ts](../../packages/ai/src/limits.ts) (`CHAT_LIMITS`), enforced in
  [packages/ai/src/request.ts](../../packages/ai/src/request.ts)
- Provider call and usage logging: [packages/ai/src/chat-turn.ts](../../packages/ai/src/chat-turn.ts)
- Prepared starter answers (no model call on a hit): [packages/ai/src/prepared-answers.ts](../../packages/ai/src/prepared-answers.ts);
  see [prepared answers and invalidation](prepared-answers-and-invalidation.md)
- Provider selection, model ids, and thinking settings:
  [apps/portfolio/src/server/model.ts](../../apps/portfolio/src/server/model.ts)
- SDK choice: [ADR 0003](../adr/0003-ai-sdk-selection.md); model choice:
  [M4 plan, Decisions](../plans/m4-first-ai-integration.md#decisions); OpenRouter:
  [M7.1 plan](../plans/m7-1-openrouter-provider.md); AI Gateway:
  [M7.2 plan](../plans/m7-2-ai-gateway-provider.md)

## 5. Common pitfalls and misconceptions

- Tokens are not characters or words. Rough rules of thumb vary by model and language; measure
  with the provider's token counting rather than guessing.
- "The model remembers the conversation." It doesn't; the app resends it. Forgetting this leads to
  surprise costs on long threads.
- Calling the provider from client code exposes the API key in the bundle.
- A successful, fluent response is not evidence that it is correct.
- The cheapest model call is the one not made. Since M7, a current prepared answer to a starter
  makes no call at all; generating the five answers costs about 10 calls, once per profile change.

## 6. Further reading

- [AI SDK: generating text](https://ai-sdk.dev/docs/ai-sdk-core/generating-text)
- [Anthropic: token counting](https://docs.claude.com/en/docs/build-with-claude/token-counting)
- [OpenRouter: limits](https://openrouter.ai/docs/api/reference/limits),
  [reasoning tokens](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens), and
  [tool calling](https://openrouter.ai/docs/guides/features/tool-calling)
- [AI SDK: OpenRouter provider](https://ai-sdk.dev/providers/community-providers/openrouter)
- [Vercel AI Gateway: pricing](https://vercel.com/docs/ai-gateway/pricing),
  [rate limits](https://vercel.com/docs/ai-gateway/rate-limits), and
  [disallow prompt training](https://vercel.com/docs/ai-gateway/security-and-compliance/disallow-prompt-training)
- [AI SDK: AI Gateway provider](https://ai-sdk.dev/providers/ai-sdk-providers/ai-gateway)
