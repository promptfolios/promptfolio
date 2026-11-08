# M18.2 plan: server-side history in the reference app

- **Status:** Plan approved (2026-11-08). Implemented; waiting for review. Released together with M17 and [M18.1](m18-1-server-side-history.md).
- **Date:** 2026-11-08
- **Roadmap:** not listed yet.

## Objective

`apps/portfolio` stores conversations in Redis, and its thread list comes from the server instead of `localStorage`.

**Excluded:** importing threads already saved in browsers, and showing tool calls (M19).

## Design

- **Owner cookie:** a random 128-bit visitor id in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie, set on the first request. The
  id is the secret, like a session id, so it is not signed. Daily limits still count by the hashed address, so a cleared cookie
  gives new threads, not more answers. `Secure` is left off in `next dev`.
- **`RedisChatStore`:** uses the client in [redis.ts](../../apps/portfolio/src/server/shared/redis.ts). One key per chat,
  `chat:history:{owner}:{id}`, and one hash per visitor, `chat:list:{owner}`, for the list (title, status, last message time).
  *Changed during implementation:* a hash instead of a sorted set, because each entry also carries a title and a status.
  Retention is `CHAT_HISTORY_DAYS` (default 30, 1 to 365), and the time limit restarts on every save. Reading the list drops
  entries past retention, and a visitor keeps at most 50 conversations. In `next dev` without Redis, a store in memory.
- **Routes:** `POST /api/chat` takes `{ id, message, parentId }`; `GET /api/chats` lists threads; `GET`, `PATCH`, and
  `DELETE /api/chats/[id]` open, rename or archive, and delete one. *Added during implementation:* `PATCH`, because the thread
  list already offers Rename and Archive. `PATCH` and `DELETE` refuse `Sec-Fetch-Site: cross-site`.
- **Client:** [server-thread-list-adapter.ts](../../apps/portfolio/src/chat/threads/server-thread-list-adapter.ts). The transport
  sends `{ id, message: messages.at(-1), parentId: messages.at(-2)?.id ?? null }`, with the thread list item's id; the history
  adapter only loads. `thread-store.ts`, `browser-storage.ts`, `browser-thread-list-adapter.ts`, `storage-limits.ts`, and their
  tests are removed, with `restored-thread.test.ts`. Threads already in a browser stay there unused; no cleanup code is added.
- **Titles:** *changed during implementation:* the server titles a conversation from its first question when it first saves it.
  assistant-ui asks for a title while the first answer streams, before anything is saved, so a `PATCH` then found nothing.
- **Privacy line** on the chat page, stating the configured retention, so the text and the setting cannot disagree.

## Tests

- Each route, including another owner, a forged cookie, and no cookie getting nothing, and a new visitor getting the cookie.
- The store against a fake client that answers as Upstash does: keys, retention, the 50-conversation cap, titles, and entries
  it cannot parse.
- The transport's body, the history load, and the thread list's requests.

## Documentation

ADR 0007's thread-list notes get an "*Update (M18)*". No new learning note: M18.1's covers the concept, with a pitfall for
retention. The notes on chat runtime, validation, streaming, and browser persistence, the architecture overview, the chat limit
guide, and `.env.example` are updated.

## Verification

`pnpm verify`, then the browser preview on a free model: a question, reload, a follow-up that used the earlier lookup, Regenerate,
Edit, a new thread's title, and delete. Owner separation is covered by route tests rather than a second browser profile.
