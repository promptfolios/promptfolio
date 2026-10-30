# Contact form setup

How to turn on the contact form. Without these settings the portfolio has no Contact button and works
as before. Design and decisions: [M10 plan](../plans/m10-contact-workflow.md),
[ADR 0012](../adr/0012-contact-workflow.md).

> **Status:** the setup below follows the documentation of Resend, Upstash, and Vercel (checked
> 2026-10-30). The daily limit has only been tested with fakes, and the host rate limit in step 4 has not
> been applied anywhere yet; that happens at deployment (M12).

## 1. Create a Resend key

1. Create a [Resend](https://resend.com) account.
2. Create an API key with **sending access** only, so a leaked key cannot manage the account.

**Without your own domain,** use `onboarding@resend.dev` as the sender: it delivers only to the address
of your Resend account, so `CONTACT_TO_EMAIL` must be that address.

**To deliver to another address,** [verify a domain](https://resend.com/docs/api-reference/domains/verify-domain)
and send from an address on it.

## 2. Create a Redis database

The form sends at most one email per visitor in 24 hours, and Redis holds that record. Create a database
at [Upstash](https://upstash.com/docs/redis/overall/getstarted) and copy its REST URL and token. The
[free plan](https://upstash.com/docs/redis/overall/pricing) allows 500K commands a month, and a send uses
at most 3.

It holds only a keyed hash of each visitor's IP address, which expires after 24 hours. If the database is
unavailable, for example archived or deleted, nothing is sent and visitors are asked to try later.

## 3. Set the environment variables

In `apps/portfolio/.env.local`, and in the host's settings when deployed. They are read only on the
server, so never prefix them with `NEXT_PUBLIC_`.

| Variable | Value |
| -------- | ----- |
| `RESEND_API_KEY` | The key from step 1 |
| `CONTACT_TO_EMAIL` | Where messages go. Visitors see your name, never this address |
| `CONTACT_FROM_EMAIL` | `Portfolio <onboarding@resend.dev>`, or an address on your verified domain |
| `CONTACT_TOKEN_SECRET` | At least 32 characters, for example from `openssl rand -base64 32`. Changing it resets the daily limits |
| `UPSTASH_REDIS_REST_URL` | The REST URL from step 2 |
| `UPSTASH_REDIS_REST_TOKEN` | The REST token from step 2 |

If only some are set, the button stays hidden and the log names what is missing, so the daily limit
cannot be left out by accident.

The home page is prerendered, so `next build` decides whether the button appears. Set the variables
before building, and rebuild after turning the form on or off. The routes read them on every request, so
if the variables change without a rebuild, the assistant and the page can disagree about the button.

Turning the form on or off changes what the assistant is told, so prepared answers go live until you run
`pnpm --filter portfolio prepare-answers` with the same settings.

## 4. At deployment, add a host rate limit

The daily limit counts emails, but it does not cover `prepare`, or stop requests from using function time
and Redis commands. A host rule stops bursts before they reach the app. On Vercel:
[WAF rate limiting](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting), available on all
plans.

- **Condition:** the path starts with `/api/contact/`.
- **Limit:** 10 requests per 600 seconds per IP address. One message takes two requests, and corrections
  take more.
- **Action:** the default, 429.

Limits to know: the longest window is 10 minutes on Hobby and Pro, and 1 hour on Enterprise, so this rule
cannot enforce a daily limit by itself. Hobby projects get one rate-limit rule, so choose this one or a
chat rule (M11). Counters are per region.

**On a host other than Vercel:** the app identifies visitors from `x-vercel-forwarded-for`, then
`x-forwarded-for`. Vercel overwrites these, so a client cannot choose them. Elsewhere, a proxy must
overwrite both, or anyone can get around the daily limit by sending a different value.

## What protection remains the owner's to watch

- One email per visitor really means per IP address. People sharing an address share the limit, and
  someone who changes address gets another email.
- Resend's free plan allows 100 emails a day and 3,000 a month. Many addresses can still use this up, and
  real visitors then see "not sent" until it resets.
- The dialog tells visitors that a coded form of their IP address is kept for 24 hours. Mention it in any
  privacy notice the site has.
- The name and reply address are typed by the visitor and not verified. Check before trusting them.
- "Sent" means the provider accepted the email. Bounces are not tracked here; check Resend's dashboard.
