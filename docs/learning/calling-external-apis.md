# Calling external APIs

First appears in: **M8** (GitHub source adapter). Status: **in use**.

## 1. What it is

The practical rules for calling a public HTTP API you do not control: stay within its rate
limits, send what it requires, bound every request in time and size, and turn every possible
failure into a typed, explainable result instead of an exception or a half-finished run.

## 2. Why it matters in Promptfolio

The GitHub fetcher runs unattended (by hand, or from a scheduled job; see M9). Nobody watches it
fail, and a careless run can get the client rate-limited or banned, or replace good data with
garbage. Every response is untrusted input, exactly like a visitor's message.

## 3. How it works

- **Required and pinned headers.** GitHub rejects requests without a `User-Agent`. The fetcher
  sends `X-GitHub-Api-Version: 2026-03-10`, so a future default version cannot change the response
  shape silently (without the header GitHub uses `2022-11-28`). `Accept` selects the media type:
  JSON for metadata, `application/vnd.github.raw+json` for the README as plain text.
- **Rate limits.** 60 requests per hour per IP without a token, 5,000 with a personal token,
  1,000 per repository with `GITHUB_TOKEN` in GitHub Actions. Each response carries
  `x-ratelimit-remaining` and `x-ratelimit-reset` (epoch seconds). Before the per-repository
  requests, the fetcher checks that the remaining budget covers them and stops cleanly if not.
  A 403 or 429 with `x-ratelimit-remaining: 0` (primary) or `retry-after` (secondary) stops the run.
- **Tiers.** Without a token: 2 + 2 × 12 = 26 requests. With a token: one GraphQL query for pinned
  repositories, then up to 20 repositories. The token stays optional and is read only by the
  command, never by the app.
- **No automatic retries.** Retrying into a rate limit makes it worse, and GitHub warns that it can
  lead to a ban. The next run is the retry.
- **Time and size bounds.** `AbortSignal.timeout(10_000)` per request; JSON over 1 MB is rejected;
  README text is cut at 20,000 characters.
- **Typed errors.** `not-found`, `not-a-user`, `unauthorized`, `rate-limited`, `budget`, `http`,
  `network`, `timeout`, `malformed`. Messages never include the token, headers, or response bodies.
  Some errors stop the run at once (rate limits, a rejected token); others are collected so the
  owner sees every problem from one run.
- **Partial failure as a result type (M9).** The fetcher returns `status: "complete" | "partial" |
  "failed"` rather than `ok: true | false`. A failed languages or README request makes the run
  partial: the result lists the missing repositories with their errors, and the caller decides
  whether earlier data can fill the gap. A new discriminant, instead of reusing `ok`, makes the
  type checker find every caller that assumed all or nothing.
- **Conditional requests, deferred (M9).** Sending a stored `ETag` as `If-None-Match` gets a `304`
  that does not count against the primary rate limit, but only for authorized requests. With a
  token the budget is 20 to 100 times one run; without one there is no saving. Not worth storing
  ETags yet.
- **One request at a time.** GitHub recommends serial requests to avoid secondary limits.
- **Search is different (M8.1).** It has its own limit (10 per minute without a token, 30 with one),
  shown by `x-ratelimit-resource: search`, so the budget check ignores it. `incomplete_results: true`
  may mean missing items, so such an answer never replaces a complete list. Results depend on who asks,
  so a query qualifier is checked again in code.
- **Testing without the network.** `fetchGitHubSnapshot` takes an injectable `fetch`. Tests pass a
  fake that answers from fixtures, records each call (URL, method, headers), can throw (network
  error), or wait for the abort signal (timeout). Whether fixtures match real responses is checked
  once by a manual run.

## 4. Where it lives in the code

- The client: [packages/source-github/src/fetch/github-client.ts](../../packages/source-github/src/fetch/github-client.ts)
  (`GitHubClient`)
- The run: [packages/source-github/src/fetch/fetch.ts](../../packages/source-github/src/fetch/fetch.ts)
  (`fetchGitHubSnapshot`)
- Response schemas: [packages/source-github/src/snapshot/snapshot.ts](../../packages/source-github/src/snapshot/snapshot.ts)
- Tests: [packages/source-github/src/fetch/fetch.test.ts](../../packages/source-github/src/fetch/fetch.test.ts)
- Token documentation: [apps/portfolio/.env.example](../../apps/portfolio/.env.example)

## 5. Common pitfalls and misconceptions

- A library naming an application's environment variable in its errors. The token is an option, so only the application
  knows where it came from (M13.2).
- Treating fixture tests as proof the live API still behaves. They show this code handles those responses, so a live refresh
  is on the release checklist.

- "The rate limit is per token, so unauthenticated calls from CI are fine." Unauthenticated limits
  are per IP address, and CI runners share addresses.
- Treating a 404 as always fatal: a missing README is normal, a missing user is not.
- Logging the response body to "help debugging" can leak whatever the API returned, and the token
  if it is echoed. Log kinds and targets instead.
- Validating only the fields you happened to look at: a `topics` that is suddenly a string, or a
  missing `html_url`, must fail validation rather than crash later.

## 6. Further reading

- [Rate limits for the REST API](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)
- [Best practices for using the REST API](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api)
- [API versions](https://docs.github.com/en/rest/about-the-rest-api/api-versions)
- [MDN: AbortSignal.timeout()](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static)
