/**
 * Public entry point of `@promptfolio/source-github`.
 *
 * Fetching (`fetchGitHubSnapshot`, the only function with I/O) is separate from validating
 * (`parseGitHubConfig`, `parseGitHubSnapshot`) and normalizing (`normalizeGitHubSnapshot`),
 * so the latter can run on every request without touching the network. `mergeGitHubSnapshot` does
 * those steps and adds the records to a profile.
 * `carryForward` keeps the previous data of repositories a refresh could not read.
 * `createBackgroundGitHubSource` is the opt-in alternative to a committed snapshot file: the data
 * lives in a store the application supplies and is refreshed after responses.
 *
 * Only what is exported here is part of the public API.
 */

export {
  type GitHubSourceConfig,
  type ParseGitHubConfigResult,
  parseGitHubConfig,
} from "./config.ts";
export {
  type FetchGitHubOptions,
  type FetchGitHubResult,
  fetchGitHubSnapshot,
  type GitHubFetchError,
  type GitHubFetchErrorKind,
  type MissingRepository,
} from "./fetch/fetch.ts";
export {
  type BackgroundGitHubSource,
  type BackgroundGitHubSourceOptions,
  type BackgroundRefreshIntervals,
  createBackgroundGitHubSource,
  type RefreshOutcome,
} from "./refresh/refresh.ts";
export {
  createMemorySnapshotStore,
  type GitHubSnapshotStore,
  type SnapshotStoreKey,
} from "./refresh/store.ts";
export {
  type CarriedRepository,
  type CarryForwardResult,
  carryForward,
} from "./snapshot/carry-forward.ts";
export { mergeGitHubSnapshot } from "./snapshot/merge.ts";
export { type NormalizeGitHubResult, normalizeGitHubSnapshot } from "./snapshot/normalize.ts";
export {
  type GitHubSnapshot,
  type ParseGitHubSnapshotResult,
  parseGitHubSnapshot,
  type SnapshotContribution,
  type SnapshotRepository,
} from "./snapshot/snapshot.ts";
