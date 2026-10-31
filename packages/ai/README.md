# @promptfolio/ai

The server side of chat: validates a request, serves a prepared answer or runs a model turn with read-only profile
tools, checks citations, and streams the reply. Server-only, because the model you pass carries your provider key.

Not published. Use it from this workspace as `"@promptfolio/ai": "workspace:*"`.

## Entry point

| Export | Purpose |
| ------ | ------- |
| `handleChatRequest` | Takes a web `Request`, returns a streaming `Response` |
| `ChatLimit`, `ChatTurnLimiter` | The daily limit you implement. `limit` is required; `null` turns it off on purpose |
| `generatePreparedAnswer`, `parsePreparedAnswers`, `profileFingerprint` | Prepared starter answers and when they are current |
| `evaluateQuestion`, `scoreEvaluationTurn` | Run a question through the live turn and check what code can check |
| `citedIds`, `CHAT_LIMITS` | Read citations from text; the request and model limits |

You supply any AI SDK `LanguageModel`, the `Profile`, and the limiter. This package names no provider or store.

## Example

From [the minimal consumer](../../apps/minimal-consumer/src/consumer.ts):

```ts
handleChatRequest(request, {
  model,
  profile,
  contactFormAvailable: true,
  limit: { limiter, identifyVisitor },
});
```

The system prompt is built here, not passed in, so a request cannot change it. Limits on messages, tools, and
output are enforced here too.
