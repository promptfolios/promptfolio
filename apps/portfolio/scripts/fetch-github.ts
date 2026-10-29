/**
 * Fetches the owner's public GitHub repositories and writes the snapshot next to the profile:
 *
 *   pnpm --filter portfolio fetch-github
 *
 * Configure once: `profile/<profile>.github.json` with `{ "formatVersion": 1, "user": "…" }`.
 * Uses `.env.local` like the app (`PROMPTFOLIO_PROFILE_FILE`, optional `GITHUB_TOKEN`).
 *
 * Written to run unattended (a scheduled job is planned for M9): no prompts, exit code 0 on
 * success and 1 on failure, and the snapshot is replaced only when every request succeeded
 * and the result merges into the profile.
 */
import { rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { canonicalProfileContent } from "@promptfolio/core";
import { fetchGitHubSnapshot } from "@promptfolio/source-github";
import {
  githubConfigFileName,
  githubSnapshotFileName,
  mergeGitHubSnapshot,
  readGitHubConfig,
} from "../src/server/github-source";
import { loadAppProfile, loadOwnerProfile, PROFILE_DIR } from "../src/server/profile";

async function main(): Promise<number> {
  const owner = await loadOwnerProfile();
  if (!owner.result.ok) {
    console.error(`Profile ${owner.fileName} could not be loaded:`, owner.result.issues);
    return 1;
  }
  const configFileName = githubConfigFileName(owner.fileName);
  const config = await readGitHubConfig(owner.fileName, PROFILE_DIR);
  if (config.status === "missing") {
    console.error(
      `No GitHub configuration: create profile/${configFileName} with { "formatVersion": 1, "user": "<username>" }`,
    );
    return 1;
  }
  if (config.status === "invalid") {
    console.error(`profile/${configFileName} is invalid:`, config.issues);
    return 1;
  }

  const token = process.env.GITHUB_TOKEN?.trim() || undefined;
  console.log(
    `Fetching public repositories of @${config.config.user} ${token ? "with a token" : "without a token (recent repositories only, no pinned)"}`,
  );
  // The current profile, to tell afterwards whether anything changed.
  const before = await loadAppProfile();

  const fetched = await fetchGitHubSnapshot(config.config, { token });
  if (!fetched.ok) {
    console.error(
      `\nFetch failed after ${fetched.requests} requests; the previous snapshot was kept:`,
    );
    for (const error of fetched.errors) {
      console.error(`  ${error.kind}  ${error.target}: ${error.message}`);
    }
    return 1;
  }
  for (const warning of fetched.warnings) console.warn(`  note: ${warning}`);

  const snapshotFileName = githubSnapshotFileName(owner.fileName);
  const merged = mergeGitHubSnapshot(
    owner.result.profile,
    config.config,
    fetched.snapshot,
    snapshotFileName,
  );
  if (!merged.ok) {
    console.error("\nThe fetched data does not fit the profile; the previous snapshot was kept:");
    for (const issue of merged.issues) console.error(`  ${issue.path}: ${issue.message}`);
    return 1;
  }
  for (const warning of merged.warnings)
    console.warn(`  note: ${warning.path}: ${warning.message}`);

  // Write a temporary file and rename it, so a reader never sees a half-written snapshot.
  const target = path.join(PROFILE_DIR, snapshotFileName);
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(fetched.snapshot, null, 2)}\n`);
  await rename(temporary, target);

  console.log(
    `\nWrote ${fetched.snapshot.repositories.length} repositories to profile/${snapshotFileName}`,
  );
  console.log(`(${fetched.requests} requests):`);
  for (const repository of fetched.snapshot.repositories) {
    console.log(`  ${repository.pinned ? "pinned  " : "        "}${repository.fullName}`);
  }

  const changed =
    !before.result.ok ||
    canonicalProfileContent(before.result.profile) !== canonicalProfileContent(merged.profile);
  console.log(
    changed
      ? "\nProfile content changed: prepared answers are stale until you run pnpm --filter portfolio prepare-answers."
      : "\nProfile content unchanged: prepared answers stay current.",
  );
  return 0;
}

process.exitCode = await main();
