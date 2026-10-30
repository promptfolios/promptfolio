# Chat limit setup

How to turn on the daily limit on live answers. A public deployment needs it: without these settings,
outside `next dev`, the assistant refuses live answers. Design and decisions:
[ADR 0013](../adr/0013-chat-daily-limits.md).

> **Status:** tested against a local stand-in that follows Upstash's documented API. It has not yet run
> against a real Upstash database, and the firewall rule has not been applied anywhere. Both wait for your
> approval or for deployment (M12).

## 1. Create a Redis database

Create a database at [Upstash](https://upstash.com/docs/redis/overall/getstarted), or reuse the contact
form's. The [free plan](https://upstash.com/docs/redis/overall/pricing) allows 500K commands a month. Counting
each command in a transaction, which its pricing page does not settle, a live answer uses 4 and a request refused
for the visitor's limit 2.

It holds a keyed hash of each visitor's IP address and two counters, which expire 24 hours after their first
count. It holds no conversation text.

## 2. Set the environment variables

In `apps/portfolio/.env.local`, and in the host's settings when deployed. They are read only on the server,
so never prefix them with `NEXT_PUBLIC_`.

| Variable | Value |
| -------- | ----- |
| `UPSTASH_REDIS_REST_URL` | The REST URL from step 1 |
| `UPSTASH_REDIS_REST_TOKEN` | The REST token from step 1 |
| `VISITOR_HASH_SECRET` | At least 32 characters, for example from `openssl rand -base64 32`. Changing it resets every visitor's count |

Check that it works: send a message, then look for `[chat …] finished` in the server log. If something is
missing, the log says `[chat] rate limit not configured:` and names the variable.

## 3. At deployment, add a host rate limit

The daily counters bound spend, but they do not stop bursts from using function time and Redis commands. On
Vercel, add one [WAF rate limit](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting):

- **Condition:** the path starts with `/api/`. This covers chat and the contact form with one rule, which is
  all Hobby allows.
- **Limit:** 40 requests per 600 seconds per IP address.
- **Action:** the default, 429.

Counters are per region. On a host other than Vercel, a proxy must overwrite `x-vercel-forwarded-for` and
`x-forwarded-for`, or anyone can get around the limit by sending a different value.

## What the limit does

| Situation | The visitor sees |
| --------- | ---------------- |
| Starter question with a current prepared answer | The answer, not counted |
| Up to 30 live answers from one address in 24 hours | Answers |
| The 31st | A message about the daily limit (429) |
| The site's 201st in 24 hours, from any address | A message about the daily limit (429) |
| Redis down or slow, settings missing, or no address readable | "Could not answer right now" (503) |

To change the numbers, pass `allowance` to `createRedisChatLimiter` in `src/server/chat-limit.ts`.

## What remains the owner's to watch

- Set a spend limit with the model provider as well: at 200 answers a day the worst case is about $10.50 a day
  on Gemini 3.8 Flash at today's price.
- Someone with many addresses can use up the 200 and stop live answers until the counter expires.
- If the free plan's commands run out, live chat and the contact form may stop until the month resets.
- A coded form of a visitor's IP address is kept for up to 24 hours. Mention it in any privacy notice the site
  has.
