# Background work after the response

First appears in: **M21** (background GitHub refresh in a store). Status: **in use** in the
library; the reference app keeps the committed snapshot.

## 1. What it is

Work a request starts but does not wait for: the response is sent first, and the host keeps the
function alive until the work finishes. Next.js calls it `after()`; Vercel and Cloudflare call it
`waitUntil`. Combined with a stored copy of the data, it gives **stale-while-revalidate**: every
visitor gets the stored data at once, and a request now and then refreshes it for later visitors.

## 2. Why it matters in Promptfolio

Visitors must never wait for GitHub ([ADR 0009](../adr/0009-github-source-as-fetched-snapshot.md)),
and a serverless app has no process that stays up to run a timer. The documented answer is a
scheduled job that commits the snapshot ([scheduled jobs](scheduled-jobs.md)). The opt-in
alternative uses visitor traffic as the timer: no cron, no data commits, no redeploy
([ADR 0020](../adr/0020-background-refresh-in-a-store.md)).

## 3. How it works

```mermaid
sequenceDiagram
  participant V as Visitor
  participant R as Chat route
  participant S as Store
  participant G as GitHub
  R->>S: get snapshot
  R->>V: answer streams
  Note over R: after the response
  R->>S: refresh-after passed? lock taken?
  R->>G: fetch (only one run, only when due)
  R->>S: set snapshot if it fits the profile; set refresh-after; unlock
```

- **Due time instead of a schedule.** `refresh-after` is stored with the data: 6 hours after a
  complete run, 1 hour after a partial or failed one. Most requests read it and stop.
- **A single-runner lock.** Many requests can find the refresh due at once. Only the one that
  sets the lock key (atomically, only if absent) runs it. The lock **expires** so a run killed by
  the host cannot block refreshes forever, and it carries a **token** so a run that outlived its
  expiry cannot delete the lock of the run that took over.
- **Keep the old data until the new data is checked.** The new snapshot replaces the stored one
  only after it merges into the profile; a failure just schedules a sooner retry.

## 4. Where it lives in the code

- The refresher: [packages/source-github/src/refresh/refresh.ts](../../packages/source-github/src/refresh/refresh.ts)
- The store interface and memory store: [packages/source-github/src/refresh/store.ts](../../packages/source-github/src/refresh/store.ts)
- Tests, including the failure paths: [refresh.test.ts](../../packages/source-github/src/refresh/refresh.test.ts)

## 5. Common pitfalls and misconceptions

- "The work runs forever." It shares the request's time limit (`maxDuration` on Vercel). Work cut
  off there leaves the lock until it expires, so keep the lock longer than that limit.
- "`after()` makes the work free." It still runs on the server and counts toward its duration.
- Awaiting the background work in the request: the visitor then waits for GitHub after all.
- A lock without expiry, or an unlock without a token: one crash stops refreshes, or two runs
  overlap.
- "Traffic-driven means always fresh." A site nobody visits never refreshes; the first visitor
  after a quiet stretch gets the old data. A cron route calling `refreshIfDue` covers that.
- Logging store errors in full: their messages can contain a connection string.

## 6. Further reading

- [Next.js: after](https://nextjs.org/docs/app/api-reference/functions/after)
- [Vercel Functions: waitUntil](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package#waituntil)
- [Redis: SET (NX, EX)](https://redis.io/docs/latest/commands/set/)
- [Redis: distributed locks](https://redis.io/docs/latest/develop/clients/patterns/distributed-locks/)
