/**
 * Public entry point of `@promptfolio/source-remote`.
 *
 * `fetchRemoteProfile` reads a profile file from a URL and returns its parsed JSON, unvalidated.
 * Validate it with `loadStructuredProfile` from `@promptfolio/core`. Caching stays with the app.
 *
 * Only what is exported here is part of the public API.
 */

export {
  type FetchRemoteProfileOptions,
  type FetchRemoteProfileResult,
  fetchRemoteProfile,
  type RemoteProfileError,
  type RemoteProfileErrorKind,
} from "./fetch-remote-profile.ts";
