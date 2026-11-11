---
"@promptfolio/source-remote": minor
---

New package. `fetchRemoteProfile({ url, headers?, timeoutMs?, maxBytes? })` fetches a profile file from a URL, such as a published `profile.json` or a private GitHub repository read through the contents API, and returns its parsed JSON for `loadStructuredProfile`. It applies a timeout for the whole request and a size limit counted while reading, sends a `User-Agent`, and returns typed errors (`invalid-url`, `network`, `timeout`, `http`, `too-large`, `not-json`) whose messages never contain request headers. Caching stays with the app.
