# ADR 0013: Daily limits on live chat answers

- **Status:** Accepted
- **Date:** 2026-10-31

## Context

Each live answer costs money, up to about $0.05 on the default model at current limits, and the chat
endpoint is public. Vercel's firewall counts requests per IP address in a window of at most 10 minutes,
so one address could still spend about $288 a day at worst, and rotating addresses multiply that.
Provider spend caps overrun or are experimental. Serverless memory does not hold counters across
instances ([ADR 0001](0001-reference-app-framework.md)), and Upstash Redis is already a dependency
([ADR 0012](0012-contact-workflow.md)). Evidence and sources: [M11 plan](../plans/m11-reliability-security-evaluation.md).

## Decision

1. **Two counters in Redis, per 24 hours from the first count:** 30 live answers per visitor and 200 for
   the site. The site counter is what bounds spend when addresses rotate. The visitor counts first, so a
   blocked visitor does not use up the site's allowance.
2. **Only live answers count.** The check runs after request validation and after the prepared-answer
   lookup, because neither costs a model call. Every live answer counts, including failed and stopped
   ones, because the provider may bill them.
3. **It fails closed.** If the store errors or takes over 2 seconds, or no address can be read, the model
   is not called and the visitor gets a generic 503. Prepared answers keep working.
4. **The package names no store.** `@promptfolio/ai` defines `ChatTurnLimiter` and a required `limit`
   option. `null` is an explicit choice, so a consumer cannot lose the limit by omission. The app holds the
   Redis adapter.
5. **Missing settings refuse live answers, except under `next dev`.** A missed variable must not remove
   the limit on a public site, while local development should work without a store. There it warns and
   runs unlimited.
6. **A separate `VISITOR_HASH_SECRET`** with its own label, so chat works without the contact form, and the
   two hashes of one address cannot be matched to each other.
7. **One firewall rule covers `/api/`**, at 40 requests per 600 seconds. Hobby allows one rule whose
   conditions must all match, so a prefix is how it can cover both chat and contact. It stops bursts
   before they reach Redis; the daily counters bound spend. It is applied at deployment (M12).

## Alternatives

- **Firewall only:** no daily bound, and nothing against rotating addresses.
- **Provider spend cap only:** a backstop, since a cap that is reached stops the whole service for the
  rest of the billing period, and Gemini's project caps can overrun for about 10 minutes.
- **`@upstash/ratelimit`:** allows requests when Redis times out by default, which conflicts with
  decision 3, and would be a second dependency for two counters. Its fixed window uses about as many
  commands per call.
- **A short burst window in Redis as well:** more commands per request. A burst can only spend the
  visitor's daily allowance, and the firewall handles the rest.
- **Answering when the store is down:** the limit would quietly stop working during an outage.

## Consequences

- People behind one address share 30 answers a day.
- Someone with many addresses can use up the site's 200 and stop live answers for that day. That is the
  price of bounding spend.
- Worst case on Gemini 3.8 Flash today: about $10.50 a day, or $315 a month if sustained, about double from
  2027-01-01. The owner should still set a provider spend limit.
- Live chat needs Redis in production, so a Redis outage or deleted database stops live answers.
- A refused request still uses 2 Redis commands. Two addresses at the firewall's limit could exceed the
  free plan's 500K commands a month. Its pricing page does not say what happens then; if Upstash refuses
  commands, chat and contact fail closed until the month resets.
- A counter's window starts at its first count, so it is not a calendar day, and a late `INCR` after the
  2-second timeout still counts.
- Identifying a visitor relies on the host overwriting the IP headers. Vercel does; another host must.
