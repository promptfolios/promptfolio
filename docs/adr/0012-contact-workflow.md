# ADR 0012: Contact through a signed confirmation and a daily limit

- **Status:** Accepted
- **Date:** 2026-10-30

## Context

The spec requires explicit confirmation before a visitor's message is emailed to the owner, a
recipient the model cannot choose, truthful failure reporting, and basic abuse protection. The app
is serverless, so memory does not survive between requests
([ADR 0001](0001-reference-app-framework.md)). The contact address is private
([ADR 0005](0005-profile-model-and-provenance.md)), and confirmation is a separate endpoint and UI
action, not an SDK feature ([ADR 0003](0003-ai-sdk-selection.md)).

## Decision

1. **A form, not the model.** A Contact button opens a dialog. The assistant has no contact tool and
   is told it cannot pass messages on. It mentions the button only when the app passes
   `contactFormAvailable`, which is part of the instructions fingerprint.
2. **Confirmation is a signed token.** `prepare` validates the draft and returns it, normalized, with
   an HMAC-SHA-256 token containing the draft and a 15-minute expiry. `send` accepts only the token. The
   visitor reviews their own name, address, and message. The subject and the notes around the message are
   written for the owner, so they stay on the server.
3. **Duplicates are stopped by the provider.** The idempotency key is a hash of the whole email, and
   Resend keeps it for 24 hours, longer than a token lives.
4. **Three outcomes.** `sent` (the provider returned an id), `failed` (refused), and `unknown` (no
   clear answer, where a retry is safe). Only `sent` gives a success response.
5. **A new package, with the provider and the store in the app.** `@promptfolio/contact` (zod only) owns
   validation, tokens, message building, handlers, and the `ContactSender` and `ContactSendLimiter`
   interfaces. The app's `src/server/contact.ts` owns the environment, the Resend adapter, the Redis
   adapter, and how a visitor is identified.
6. **One email per visitor in 24 hours, enforced in the API
   ([M10.1](../plans/m10-1-daily-send-limit.md)).** A firewall window is too short and counts requests,
   not emails, so `send` claims a slot in Upstash Redis before sending. A visitor is a keyed hash of
   their IP address, by its first 64 bits for IPv6. `sent` and `unknown` keep the claim, `failed`
   releases it, and a retry of the same email passes. If the limit cannot be checked, nothing is sent.
   A host rule per IP address stays as a guard against bursts, and covers `prepare`.

## Alternatives

- **`confirmed: true` in the request:** a client can always send it, so it enforces nothing.
- **Drafts stored on the server:** single-use tokens, but a store for a problem the provider's key
  already solves.
- **SMTP with Nodemailer:** no account needed, but no duplicate protection, long default timeouts, and
  with Gmail an app password as the credential. A consumer can still implement `ContactSender` with it.
- **No store, relying on a host rule and the provider's quota (M10's first decision):** one script could
  still send many emails a day. Vercel's window is at most 10 minutes on Hobby and Pro.
- **`@upstash/ratelimit`:** counts requests, while a plain atomic `SET` holds what is needed here: which
  email holds the slot, so a retry can pass and a refusal can give it back.
- **Postgres:** more setup for one short-lived value.
- **Turnstile:** adds a third-party script, and does not count emails.

## Consequences

- The token proves the content passed `prepare` unchanged, not that a person read it. A script can
  call both routes.
- People sharing an IP address share one email a day. Rotating addresses get past the limit, and many
  addresses can still use up the provider's quota, so real visitors get "not sent" until it resets.
- The form needs Redis: without its settings the form stays off, and while it is unavailable nothing is
  sent. The store holds a keyed hash of the IP address for 24 hours, and the dialog says so.
- A failed release, or a claim that lands after its 2-second timeout, blocks a visitor for up to 24 hours
  although nothing was sent. If concurrent retries of one email get different answers, a `failed` can
  delete the claim of a `sent`.
- A changed `CONTACT_TOKEN_SECRET` also changes every visitor's hash, which resets the daily limits.
- Identifying a visitor relies on the host overwriting the IP headers. Vercel does; another host must.
- Without a key-supporting provider, a replay would send twice, so a different sender needs its own
  answer to duplicates.
- A visitor's address is unverified, and the email says so.
- A changed `CONTACT_TOKEN_SECRET` invalidates open reviews; the visitor reviews again.
