/**
 * Public entry point of `@promptfolio/source-github`.
 *
 * Fetching (`fetchGitHubSnapshot`, the only function with I/O) is separate from validating
 * (`parseGitHubConfig`, `parseGitHubSnapshot`) and normalizing (`normalizeGitHubSnapshot`),
 * so the latter can run on every request without touching the network. The output is
 * source-neutral and is added to a profile with `addObservedRecords` from `@promptfolio/core`.
 *
 * Only what is exported here is part of the public API.
 */
export {
  CONFIG_LIMITS,
  type GitHubSourceConfig,
  type ParseGitHubConfigResult,
  parseGitHubConfig,
} from "./config";
export {
  FETCH_DEFAULTS,
  type FetchGitHubOptions,
  type FetchGitHubResult,
  fetchGitHubSnapshot,
  type GitHubFetchError,
  type GitHubFetchErrorKind,
} from "./fetch";
export {
  GITHUB_SOURCE_ID,
  type NormalizeGitHubResult,
  normalizeGitHubSnapshot,
  repositoryKey,
} from "./normalize";
export { SELECTION_LIMITS } from "./select";
export {
  type GitHubSnapshot,
  type ParseGitHubSnapshotResult,
  parseGitHubSnapshot,
  SNAPSHOT_LIMITS,
} from "./snapshot";
