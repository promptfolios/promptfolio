# @promptfolio/source-github

Public GitHub data for a profile. Fetching, the only part with network access, is separate from validating and
merging, so a request never touches GitHub.

**Not on npm yet.** Until it is, use it from the [Promptfolio repository](https://github.com/promptfolios/promptfolio).

## Install

```sh
npm install @promptfolio/source-github @promptfolio/core
```

Requires Node.js 22 or later. ES modules only.

## Entry point

| Export | Purpose |
| ------ | ------- |
| `parseGitHubConfig`, `parseGitHubSnapshot` | Validate the configuration and stored data |
| `fetchGitHubSnapshot` | Reads GitHub. `complete`, `partial`, or `failed`; the token is optional |
| `carryForward` | Keeps earlier data for repositories a refresh could not read |
| `mergeGitHubSnapshot` | Validates, normalizes, and adds a snapshot's records to a `Profile` |
| `normalizeGitHubSnapshot` | The normalizing step alone, for code that merges records itself |

## Example

From [the minimal consumer](https://github.com/promptfolios/promptfolio/blob/main/apps/minimal-consumer/src/consumer.ts):

```ts
import { carryForward, fetchGitHubSnapshot, mergeGitHubSnapshot } from "@promptfolio/source-github";

const fetched = await fetchGitHubSnapshot(config, { fetch: fetchFn });
const carried = carryForward(previous, fetched);
if (carried.status === "failed") return previous;
const merged = mergeGitHubSnapshot(owner, config, carried.snapshot);
```

Storing the snapshot, recording refresh status, and scheduling stay yours: see the reference app's
[`refresh.ts`](https://github.com/promptfolios/promptfolio/blob/main/apps/portfolio/src/server/refresh/refresh.ts) and the
[scheduled refresh guide](https://github.com/promptfolios/promptfolio/blob/main/docs/guides/scheduled-refresh.md). Source text
is untrusted, and it reaches a model only as data.

## License

MIT
