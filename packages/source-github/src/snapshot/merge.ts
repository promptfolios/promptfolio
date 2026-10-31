import {
  addObservedRecords,
  type Profile,
  type ProfileIssue,
  type ProfileLoadResult,
} from "@promptfolio/core";
import type { GitHubSourceConfig } from "../config";
import { normalizeGitHubSnapshot } from "./normalize";
import { parseGitHubSnapshot } from "./snapshot";

/**
 * Adds a GitHub snapshot's records to an owner profile: validate the snapshot, normalize it with
 * the configuration, and merge it with `addObservedRecords`. Pure, so it can run on every request,
 * and a refresh can check new data before writing it.
 *
 * @param snapshotName Added to the issues that come from the snapshot, such as its file name, so
 * an owner can tell them from issues in the profile, which stay as they are.
 */
export function mergeGitHubSnapshot(
  owner: Profile,
  config: GitHubSourceConfig,
  snapshotData: unknown,
  snapshotName?: string,
): ProfileLoadResult {
  const named = (issues: ProfileIssue[]) =>
    snapshotName === undefined
      ? issues
      : issues.map((issue) => ({ ...issue, path: `${snapshotName}: ${issue.path}` }));

  const snapshot = parseGitHubSnapshot(snapshotData);
  if (!snapshot.ok) return { ok: false, issues: named(snapshot.issues) };
  const normalized = normalizeGitHubSnapshot(snapshot.snapshot, config);
  if (!normalized.ok) return { ok: false, issues: named(normalized.issues) };
  const merged = addObservedRecords(owner, normalized.records);
  if (!merged.ok) return merged;
  return {
    ok: true,
    profile: merged.profile,
    warnings: [...named(normalized.warnings), ...merged.warnings],
  };
}
