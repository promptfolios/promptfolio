/**
 * Public entry point of `@promptfolio/source-github`.
 *
 * Fetching (`fetchGitHubSnapshot`, the only function with I/O) is separate from validating
 * (`parseGitHubConfig`, `parseGitHubSnapshot`) and normalizing (`normalizeGitHubSnapshot`),
 * so the latter can run on every request without touching the network. `mergeGitHubSnapshot` does
 * those steps and adds the records to a profile.
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
  type GitHubSourceConfig,
  type ParseGitHubConfigResult,
  parseGitHubConfig,
} from "./config";
export {
  type FetchGitHubOptions,
  type FetchGitHubResult,
  fetchGitHubSnapshot,
  type GitHubFetchError,
  type GitHubFetchErrorKind,
  type MissingRepository,
} from "./fetch";
export { mergeGitHubSnapshot } from "./merge";
export { type NormalizeGitHubResult, normalizeGitHubSnapshot } from "./normalize";
export {
  type GitHubSnapshot,
  type ParseGitHubSnapshotResult,
  parseGitHubSnapshot,
  type SnapshotContribution,
  type SnapshotRepository,
} from "./snapshot";
