# M12.9 plan: generated starter questions

- **Status:** Replaced the same day by [M12.10](m12-10-build-time-starters-and-styling.md), which generates at build time. The route and Redis cache below no longer exist.
- **Date:** 2026-11-01
- **Decision:** [ADR 0015](../adr/0015-generated-starter-questions.md). Reverses the removal of starter buttons in
  [M12.5](m12-5-remove-prepared-answers.md).

## Objective

A new chat shows questions the model wrote from this profile. Clicking one sends it as a normal message.

## Scope

- `generateStarterQuestions` in `@promptfolio/ai`, with validation of its output.
- A cache by profile fingerprint in the app: 7 days, 10 minutes after a failure, with a lock.
- `GET /api/starters`, and chips under the composer on new chats only.
- The developer chose one set per profile over fresh questions for each chat.

## Exclusions

- Prepared answers stay removed. A click is answered live.
- No new dependencies, and no change to how answers work.

## Verification

- `pnpm verify`, with tests for invalid replies, failed generation, the cache, its expiry, and the lock.
- In the browser with a live model: the first request generated in about 3 seconds and later ones came from the cache. Chips
  showed on a new chat and not in an open one, and a click got a live answer. Dark on desktop, light on a phone.

## Finding

The clicked question "Which languages does Amanx5 use in the ecommerce repository?" got a wrong answer: after one lookup, the
model said no such repository was in the profile, though there is one. Tool arguments are not logged, so the lookup it chose is
not known. Recorded in [the known limitations](../KNOWN_LIMITATIONS.md).
