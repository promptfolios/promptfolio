# M18.2 plan: server-side history in the reference app

- **Status:** Draft, decisions settled (2026-11-08); waiting for approval. Starts after [M18.1](m18-1-server-side-history.md).
- **Date:** 2026-11-08
- **Roadmap:** not listed yet.

## Objective

`apps/portfolio` stores conversations in Redis, and its thread list comes from the server instead of `localStorage`.

**Excluded:** importing threads already saved in browsers, and showing tool calls (M19).

## Design

- **Owner cookie:** a random 128-bit visitor id in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie, set on the first request. The
  id is the secret, like a session id, so it is not signed. Daily limits still count by the hashed address, so a cleared cookie
  gives new threads, not more answers.
- **`RedisChatStore`:** uses the client in [redis.ts](../../apps/portfolio/src/server/shared/redis.ts). One key per chat,
  `chat:{owner}:{id}`, and a sorted set `chats:{owner}` for the list. Retention is a constructor option, read from the app's
  configuration (default 30 days), and the time limit restarts on every save. About four commands per turn; the free tier's
  current limits are checked during implementation.
- **Routes:** `POST /api/chat` takes `{ id, message }`; `GET /api/chats` lists threads; `GET` and `DELETE /api/chats/[id]` open and
  delete one.
- **Client:** `prepareSendMessagesRequest` sends `{ id, message: messages.at(-1) }`. The thread list becomes server-backed;
  check the installed assistant-ui's `RemoteThreadListAdapter` before building it. `thread-store.ts`,
  `browser-thread-list-adapter.ts`, `storage-limits.ts`, and their tests are removed. Threads already in a browser stay there
  unused; no cleanup code is added.
- **Privacy line** on the chat page, stating the configured retention, so the text and the setting cannot disagree.

## Tests

- Each route, including owner B getting 404 for owner A's chat, and a request without a cookie getting one.
- The store against a fake client: keys, retention, list order, delete.
- The transport sends one message.

## Documentation

ADR 0007's thread-list notes get an "*Update (M18)*". No new learning note: M18.1's covers the concept.

## Verification

`pnpm verify`, then the browser preview on a free model: two turns, reload, delete, and a second browser profile that sees none
of the first one's threads.
