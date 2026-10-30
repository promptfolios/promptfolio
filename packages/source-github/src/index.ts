/**
 * Public entry point of `@promptfolio/source-github`.
 *
 * Fetching (`fetchGitHubSnapshot`, the only function with I/O) is separate from validating
 * (`parseGitHubConfig`, `parseGitHubSnapshot`) and normalizing (`normalizeGitHubSnapshot`),
 * so the latter can run on every request without touching the network. The output is
 * source-neutral and is added to a profile with `addObservedRecords` from `@promptfolio/core`.
 * `carryForward` keeps the previous data of repositories a refresh could not read.
 *
 * Only what is exported here is part of the public API.
 */
export {
  type CarriedRepository,
  type CarryForwardResult,
  carryForward,
} from "./carry-forward";
export {
  CONFIG_LIMITS,
  type GitHubSourceConfig,
  type ParseGitHubConfigResult,
  parseGitHubConfig,
} from "./config";
export { CONTRIBUTION_LIMITS } from "./contributions";
export {
  FETCH_DEFAULTS,
  type FetchGitHubOptions,
  type FetchGitHubResult,
  fetchGitHubSnapshot,
  type GitHubFetchError,
  type GitHubFetchErrorKind,
  type MissingRepository,
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
  type SnapshotContribution,
  type SnapshotRepository,
} from "./snapshot";
