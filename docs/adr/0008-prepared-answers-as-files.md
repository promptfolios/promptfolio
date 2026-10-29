# ADR 0008: Prepared starter answers as reviewed files next to the profile

- **Status:** Accepted
- **Date:** 2026-10-29

## Context

The conversation starters are asked by almost every visitor and have the same correct answer
for all of them. Answering them live costs 2 to 3 model calls and several seconds each time, and
Gemini's free tier (15 requests per minute) already rejected back-to-back questions in M5.

The spec allows prepared answers if they cannot knowingly stay stale after a profile change.
[ADR 0001](0001-reference-app-framework.md) assumed that "the answer cache (M7)" would need small
external storage, because nothing in memory survives between serverless requests.

## Decision

- An owner-run script (`pnpm --filter portfolio prepare-answers`) generates one answer per starter
  with the same pipeline as a live answer (instructions, tools, budgets, output allowlist) and
  writes `profile/<profile>.answers.json` next to the profile file.
- The file is committed for the fictional example profile and gitignored for `*.local` profiles
  (`*.local.answers.json`), like the profile itself. The owner reads it before committing.
- Each answer carries two SHA-256 fingerprints: of the profile's canonical content (observation
  timestamps excluded) and of the instructions and tool definitions. The server reads the file on
  every request, like the profile, and serves an answer only for the first message of a
  conversation, on an exact question match, when both fingerprints equal the current ones.
  Anything else is answered live.
- No answer is written at run time. There is no external cache, no in-memory cache, and no new
  service or secret.

Alternatives considered: always answering live (simplest, but every visitor pays for the same
answer); caching live answers on first request in a hosted key-value store (fresh without an
owner step, but a new service and secret, whoever asks first defines everyone's answer, and nobody
reviews it); generating at build time (needs a provider key in the build, depends on the provider
being up, not reproducible); inserting prepared answers in the browser (moves the staleness check
and the output allowlist to the client).

## Consequences

- The deployment artifact is the cache. Answers are versioned and reviewed in Git with the
  profile; a deployment can only serve what was committed or deployed with it.
- Any profile change invalidates every prepared answer until the owner reruns the script; in
  between, starters are answered live. M9's refresh can run the same generator.
- Hits make no model call, so starters cost nothing and do not count against provider rate
  limits.
- How a real (`*.local`) profile and its answers reach a production deployment is still undecided,
  as for the profile itself ([ADR 0006](0006-profile-data-location.md)).
- Details: [M7 plan](../plans/m7-prepared-starter-answers.md), learning note on
  [prepared answers and invalidation](../learning/prepared-answers-and-invalidation.md).
