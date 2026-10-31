# Abuse protection on serverless

First appears in: **M10** (contact workflow), with the daily limit from **M10.1** and chat's limits from
**M11.1**. Status: **in use**, except the host rate limit, which is **planned** for a later deployment (M12.3, not started).

## 1. What it is

Abuse protection limits the damage from people or scripts misusing a public endpoint. Rate limiting is one
kind: counting requests from a source and refusing the excess.

## 2. Why it matters in Promptfolio

The contact routes are public and send real email, and each live chat answer costs money. But each function
call may run on a new instance, so a counter in memory does not reliably survive to the next request.

## 3. How it works

Counting per visitor needs state shared between requests. A token or cookie cannot do it, because a client
can throw it away and ask for another. So the first step is to shrink the damage, and counting then lives
somewhere that has shared state: Redis for emails, the host's firewall for requests.

| Layer | Stops | Does not stop |
| ----- | ----- | ------------- |
| Fixed recipient, no copy to the visitor | Using the form to spam third parties | Spam to the owner |
| Honeypot, cross-site check, two-step token | Simple bots, other sites using a visitor's browser | Any written script |
| Idempotency key | Identical repeats | Varied messages |
| Daily limit per hashed IP | More than one email a day from one address | Rotating IP addresses |
| Provider quota | Unbounded volume and cost | A flood using it up, so real visitors get "not sent" |
| Host rate limit per IP (at deployment) | One fast source, including at `prepare` | Rotating IP addresses |

The fixed recipient matters most: the worst case is the owner's own inbox, not a spam service for anyone.

**The daily limit claims before it sends.** A check followed by a write would let two requests both pass,
so `send` uses one atomic Redis command: `SET key value NX EX 86400`, which sets the key only if it is
missing, and expires it after 24 hours. The value is the email's idempotency key, which separates a retry
of the same email from a second email. The outcome then decides the claim: `failed` releases it, because
nothing went out, while `sent` and `unknown` keep it, because something may have.

**It fails closed.** If Redis errors, takes over 2 seconds, or no address can be read, nothing is sent. A
limit that switches itself off under failure is not a limit. The cost is that a Redis outage stops the form.

**The firewall could not do this.** Vercel's window is at most 10 minutes on Hobby and Pro, and it sees
requests, not whether an email went out. It stays as the cheap outer layer that stops bursts.

**A visitor is a network, not a person.** The record is an HMAC of the IP address, so the store never holds
the address itself. For IPv6 it uses the first 64 bits, because one connection often controls that block
and could otherwise get a fresh address per message.

A rejected honeypot gets an error, not a fake "sent". A fake success would stop some bots learning, but the
rule that the app never claims a send that did not happen has no exceptions.

[ADR 0001](../adr/0001-reference-app-framework.md) expected rate limits to need our own small store. M10
tried to do without one, until the owner wanted one email a day, which only a store can enforce.

**Chat counts answers, not requests ([ADR 0013](../adr/0013-chat-daily-limits.md)).** Spending is the risk, so
only live answers count, not invalid requests. Each live answer runs `INCR` and
`EXPIRE key 86400 NX` in one transaction, so a crash between them cannot leave a counter that never expires, and
`NX` keeps the window from sliding forward on each count.

There are two counters because they stop different things:

| Counter | Stops | Does not stop |
| ------- | ----- | ------------- |
| 30 per visitor | One address using up the budget, and everyone else's answers with it | Rotating addresses |
| 200 for the site | Unbounded spend from any number of addresses | Someone using up the 200 on purpose |

The visitor counts first, so someone already blocked adds nothing to the site's count. If the store fails, the
model is not called, for the same reason as contact.

Each layer has its own job: the firewall stops bursts cheaply, the counters bound the day, and a provider spend
limit is the last backstop.

## 4. Where it lives in the code

- Request checks and honeypot: [packages/contact/src/request.ts](../../packages/contact/src/request.ts)
- Limits: [packages/contact/src/limits.ts](../../packages/contact/src/limits.ts)
- Claiming and failing closed: `handleContactSend` in
  [packages/contact/src/handlers.ts](../../packages/contact/src/handlers.ts)
- Contact's Redis adapter: [apps/portfolio/src/server/contact/contact.ts](../../apps/portfolio/src/server/contact/contact.ts)
- Visitor hash: [apps/portfolio/src/server/shared/visitor.ts](../../apps/portfolio/src/server/shared/visitor.ts)
- Chat's check and failing closed: [packages/ai/src/chat/chat-limit.ts](../../packages/ai/src/chat/chat-limit.ts)
- Chat's Redis adapter and settings: [apps/portfolio/src/server/chat/chat-limit.ts](../../apps/portfolio/src/server/chat/chat-limit.ts)
- Hidden field: [apps/portfolio/src/components/contact/contact-dialog.tsx](../../apps/portfolio/src/components/contact/contact-dialog.tsx)
- Host rule (planned): [docs/guides/chat-limit-setup.md](../guides/chat-limit-setup.md)

## 5. Common pitfalls and misconceptions

- An in-memory counter looks right in local development, where one process serves everything, and quietly
  stops being a limit on serverless.
- `Sec-Fetch-Site` protects visitors' browsers from other sites. A script outside a browser just omits it.
- A per-IP limit can catch many people behind one address, and misses one person with many addresses.
- `x-forwarded-for` is trustworthy only when the host overwrites it. Elsewhere, a client can choose it.
- A hashed IP address is still linked to a person, so the dialog tells visitors about it.
- These layers reduce damage. None makes the endpoint abuse-proof.
- A limit that protects a budget can itself be used to deny service: using up the site's count stops live answers
  for everyone. That is the accepted price of a bound on spend.
- The store is also a target. Refused requests still use commands, so the firewall in front of it matters.

## 6. Further reading

- [Vercel: WAF rate limiting](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting)
- [Vercel: request headers](https://vercel.com/docs/headers/request-headers)
- [Upstash: the `set` command](https://upstash.com/docs/redis/sdks/ts/commands/string/set)
- [MDN: Sec-Fetch-Site](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Sec-Fetch-Site)
- [Resend: errors, including quotas](https://resend.com/docs/api-reference/errors)
