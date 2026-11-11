# @promptfolio/source-github

## 0.0.4

### Patch Changes

- Updated dependencies [e65256a]
- Updated dependencies [b2eb73e]
- Updated dependencies [4abe083]
  - @promptfolio/core@0.0.4

## 0.0.3

### Minor Changes

- 86e0e30: New opt-in background refresh: the GitHub snapshot can live in a store you supply instead of a committed file, refreshed after responses so visitors never wait for GitHub. The file-based functions are unchanged.
  
  - `createBackgroundGitHubSource({ store, config, token?, runAfterResponse, intervals? })` returns `loadProfile(owner)`, which adds the stored snapshot to the profile and hands a refresh check to `runAfterResponse` (for example Next.js `after`), and `refreshIfDue(profile)`, which never rejects and returns `not-due`, `locked`, `complete`, `partial`, or `failed`.
  - You implement `GitHubSnapshotStore`: `get` and `set` for the keys `snapshot` and `refresh-after`, and `lock(ttlSeconds)` returning a token with `unlock(token)`. `createMemorySnapshotStore` is for tests and local development.
  - A complete refresh waits 6 hours, a partial or failed one 1 hour, and the lock expires after 120 seconds; all three are options. The stored snapshot is replaced only once the new one fits the profile. An unreadable store or invalid stored snapshot gives the owner profile alone, with warnings.

### Patch Changes

- @promptfolio/core@0.0.3

## 0.0.2

### Patch Changes

- Updated dependencies [ac462a0]
  - @promptfolio/core@0.0.2
