# @promptfolio/source-remote

A profile file read from a URL, so the profile can live in a store you edit anywhere instead of in your app's code. Fetching is
separate from validating: this package returns parsed JSON, and `@promptfolio/core` validates it.

## Install

```sh
npm install @promptfolio/source-remote @promptfolio/core
```

Requires Node.js 22 or later. ES modules only. No runtime dependencies.

## Entry point

| Export | Purpose |
| ------ | ------- |
| `fetchRemoteProfile` | Fetches and parses a profile file. `{ ok: true, data, fetchedAt }`, or `{ ok: false, error }` with a `kind` |

Error kinds: `invalid-url`, `network`, `timeout`, `http` (with `status`), `too-large`, and `not-json`. Messages name the URL
without its query string and never contain request headers.

Defaults: a 10-second timeout for the whole request, a 512 KiB limit (checked while reading, not only from `Content-Length`),
`Accept: application/json`, and a `User-Agent`.

## Example

```ts
import { findContactDetails, loadStructuredProfile } from "@promptfolio/core";
import { fetchRemoteProfile } from "@promptfolio/source-remote";

const fetched = await fetchRemoteProfile({ url: "https://example.com/profile.json" });
if (!fetched.ok) throw new Error(fetched.error.message);

const contact = findContactDetails(fetched.data); // optional: text that looks like an email or phone number
const owner = loadStructuredProfile(fetched.data, {
  sourceId: "owner-profile",
  label: "Owner-provided profile",
  url: "https://example.com/profile.json",
  observedAt: fetched.fetchedAt,
});
```

### Caching is yours

Each fetch goes to the network. Wrap the call in your framework's cache, and **throw** on `ok: false` inside the cached
function, so a failure is never cached as if it were a profile. On Next.js with Cache Components:

```ts
async function cachedProfileData() {
  "use cache";
  cacheLife("hours");
  const fetched = await fetchRemoteProfile({ url: process.env.PROFILE_URL ?? "" });
  if (!fetched.ok) throw new Error(fetched.error.message);
  return { data: fetched.data, fetchedAt: fetched.fetchedAt.toISOString() };
}
```

### A private GitHub repository as the store

Read the file through GitHub's contents API with a fine-grained token that has only read access to that repository's
contents. Keep the token on the server.

```ts
await fetchRemoteProfile({
  url: "https://api.github.com/repos/<owner>/<repo>/contents/profile.json?ref=main",
  headers: {
    Accept: "application/vnd.github.raw+json",
    Authorization: `Bearer ${process.env.PROFILE_STORE_TOKEN}`,
    "X-GitHub-Api-Version": "2022-11-28",
  },
});
```

Name the branch with `?ref=`: without it, GitHub serves the default branch, which may hold edits that have not been validated.

## License

MIT
