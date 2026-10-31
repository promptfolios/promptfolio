import { loadStructuredProfile, type Profile } from "@promptfolio/core";
import { mergeGitHubSnapshot } from "@promptfolio/source-github";
import snapshot from "./github-snapshot.json";
import owner from "./profile.json";

/**
 * The fictional profile the evaluation runs on, built by the same loading and merging as a real one.
 * Its GitHub data holds injected instructions on purpose. Never run the evaluation on a real profile:
 * its answers go into a committed report.
 */
export function loadEvaluationProfile(): Profile {
  const loaded = loadStructuredProfile(owner, {
    sourceId: "owner-profile",
    label: "Owner-provided profile",
    observedAt: new Date("2026-10-30T06:00:00.000Z"),
  });
  if (!loaded.ok) throw new Error(`profile.json is invalid: ${JSON.stringify(loaded.issues)}`);

  const merged = mergeGitHubSnapshot(
    loaded.profile,
    { user: "riley-sample", exclude: [], excludeContributionsTo: [] },
    snapshot,
  );
  if (!merged.ok) throw new Error(`the snapshot is invalid: ${JSON.stringify(merged.issues)}`);
  return merged.profile;
}
