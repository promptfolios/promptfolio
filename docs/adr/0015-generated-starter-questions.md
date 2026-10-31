# ADR 0015: Starter questions generated at build time

- **Status:** Accepted
- **Date:** 2026-11-01

## Context

M12.5 removed the fixed starter buttons. The developer then asked for starters written by a model from the profile, so they
fit the person. That is a model call nobody asked for, and the free model's quota is limited.

M12.9 first generated them at runtime, behind a cached route with a lock. The chips arrived after the page loaded, which moved
the page, and a request from a visitor could cause the call. The developer asked about generating them at build time, and that
replaced it in M12.10.

## Decision

1. `page.tsx` generates the starters while `next build` prerenders it, so they are part of the first HTML.
2. `generateStarterQuestions` in `@promptfolio/ai` asks the model, with no tools, for a short label and a full question per
   starter. All of them must pass: plain text on one line, within the length limits, the question ending in `?`, and no links or
   markup.
3. The result is kept in `.next/cache`, by profile fingerprint, so a build with an unchanged profile makes no model call. Bump
   `CACHE_VERSION` to regenerate after changing the prompt.
4. A failure never fails the build. That build has no chips, and it is not retried for 10 minutes.
5. The model sees names and the owner's own descriptions, but not READMEs, repository descriptions, or commit titles.
6. A click sends the question as an ordinary message, with the usual limits and checks.

## Alternatives

- **At runtime, cached in Redis (M12.9).** A model failure recovers on its own without a deploy, but it needs a route, a lock, and
  a store, a visitor's request can start the call, and chips arrive late.
- **Fresh questions for every new chat.** More variety, but each reload would spend quota that answers need.
- **Generate during `refresh`, and commit the result.** Works with no build-time key, but it brings back the reviewed-file pattern
  M12.5 removed, and a profile without a GitHub source has no refresh.
- **Fixed questions.** Free and instant, but they do not fit the person.

## Consequences

- No visitor can ever cause this model call, and the page needs no store for it.
- **A failed generation lasts until the next build,** and that build's page has no chips. The failure is logged by type only.
- The model key must be available at build time, and a generation can add up to 55 seconds to a build.
- Every visitor sees the same starters until the profile changes and the site is rebuilt. The scheduled refresh commits changed
  data, which leads to a rebuild on a host that deploys from the repository.
- A host that does not keep `.next/cache` makes one model call per build. Next.js documents that Vercel keeps it.
- **A question can lead to a bad first answer.** It is written without looking anything up, and is answered like any other. In a
  first test of M12.9, the model wrongly said a real repository was not in the profile. The prompt now asks for broad questions
  to make that less likely, which one test cannot confirm. A question can also assume something.
- A consumer has to decide when to call it. The package only generates.
