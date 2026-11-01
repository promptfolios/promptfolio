# ADR 0017: Provider failover before first content

- **Status:** Accepted
- **Date:** 2026-11-02

## Context

In [its evaluation](../evaluation/README.md#the-run-on-gpt-4o-mini-failed-the-gate), 11 of 95 attempts on the chosen model hit a
rate limit or a timeout, and a visitor gets no retry. Free tiers fail in the same ways. The AI SDK has no failover between
providers: `customProvider`'s `fallbackProvider` only covers unknown model names.

## Decision

`createFailoverModel` in `@promptfolio/ai` wraps models with the SDK's `wrapLanguageModel`, and the app reads an ordered list from
`PROMPTFOLIO_MODEL`.

- **It moves on only before the first content:** an error, silence, or a reply with nothing in it. A visitor who has read part of
  an answer cannot be given a different one, so later failures are reported as before.
- **Thinking is not content,** so a model that thinks until its token limit and writes nothing still moves on.
- **It stays on the model that worked, for one turn.** A turn makes several model calls, and a provider may refuse another's tool
  history. So the model is created per request, and there is no memory between requests.
- **Each attempt but the last has its own timer and signal,** because the SDK's `firstChunkMs` cancels the whole call. A visitor's
  stop, or a limit on the whole call, ends everything.
- **Opt-in.** There is no automatic list from whichever keys are set, because a fallback receives the visitor's conversation.
- **A model that took over does not get earlier thinking.** The AI SDK prints reasoning it cannot send in a warning, where it could
  repeat a visitor's words in the log.

## Alternatives

- **The AI Gateway's own fallback:** it could not reach a provider outside the gateway, and depends on one host.
- **Retrying in the route:** the route would have to read the stream and tell a retryable failure from a real answer, which is what
  this does, one level up.
- **Switching mid-answer, by restarting the text:** a visitor would see an answer change as they read it.

## Consequences

- A turn can cost more than one model call, while the daily limit counts it once.
- A report would not say which model wrote an answer if it went through a list, so the evaluation uses only the first entry.
- `maxRetries` is 0 with a list, so one model gets no retry of its own. The next model is the retry.
- The last model has a longer timer than the others, 15 seconds by default. It was first left without one, on the assumption that
  the SDK's `firstChunkMs` covered it. A real hang showed otherwise: with `gemini-3.8-flash` never responding, that limit did not
  fire and visitors waited for the 55-second limit on the whole reply.
- A list is checked with each entry on its own by the evaluation, not as a chain.
