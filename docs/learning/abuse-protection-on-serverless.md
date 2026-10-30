# Abuse protection on serverless

First appears in: **M10** (contact workflow), with the daily limit from **M10.1**. Status: **in use**,
except the host rate limit, which is **planned** for deployment (M12).

## 1. What it is

Abuse protection limits the damage from people or scripts misusing a public endpoint. Rate limiting is one
kind: counting requests from a source and refusing the excess.

## 2. Why it matters in Promptfolio

The contact routes are public and send real email. But each function call may run on a new instance, so a
counter in memory does not reliably survive to the next request.

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
tried to do without one, until the owner wanted one email a day, which only a store can enforce. M11 can
reuse this database if chat needs limits too.

## 4. Where it lives in the code

- Request checks and honeypot: [packages/contact/src/request.ts](../../packages/contact/src/request.ts)
- Limits: [packages/contact/src/limits.ts](../../packages/contact/src/limits.ts)
- Claiming and failing closed: `handleContactSend` in
  [packages/contact/src/handlers.ts](../../packages/contact/src/handlers.ts)
- Redis adapter and visitor hash: [apps/portfolio/src/server/contact.ts](../../apps/portfolio/src/server/contact.ts)
- Hidden field: [apps/portfolio/src/components/contact-dialog.tsx](../../apps/portfolio/src/components/contact-dialog.tsx)
- Host rule (planned): [docs/guides/contact-setup.md](../guides/contact-setup.md)

## 5. Common pitfalls and misconceptions

- An in-memory counter looks right in local development, where one process serves everything, and quietly
  stops being a limit on serverless.
- `Sec-Fetch-Site` protects visitors' browsers from other sites. A script outside a browser just omits it.
- A per-IP limit can catch many people behind one address, and misses one person with many addresses.
- `x-forwarded-for` is trustworthy only when the host overwrites it. Elsewhere, a client can choose it.
- A hashed IP address is still linked to a person, so the dialog tells visitors about it.
- These layers reduce damage. None makes the endpoint abuse-proof.

## 6. Further reading

- [Vercel: WAF rate limiting](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting)
- [Vercel: request headers](https://vercel.com/docs/headers/request-headers)
- [Upstash: the `set` command](https://upstash.com/docs/redis/sdks/ts/commands/string/set)
- [MDN: Sec-Fetch-Site](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Sec-Fetch-Site)
- [Resend: errors, including quotas](https://resend.com/docs/api-reference/errors)
