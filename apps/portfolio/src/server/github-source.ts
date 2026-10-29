import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  addObservedRecords,
  type Profile,
  type ProfileIssue,
  type ProfileLoadResult,
} from "@promptfolio/core";
import {
  type GitHubSourceConfig,
  normalizeGitHubSnapshot,
  parseGitHubConfig,
  parseGitHubSnapshot,
} from "@promptfolio/source-github";

/*
 * The GitHub source of a profile: two files next to the profile file, derived from its name
 * (which `loadAppProfile` has already checked to be a plain name inside `profile/`):
 *
 * - `<name>.github.json`: the owner's configuration (the username, optional exclusions);
 * - `<name>.github-snapshot.json`: what `pnpm --filter portfolio fetch-github` last fetched.
 *
 * No configuration file means no GitHub source. Server-only: uses the filesystem.
 */

/** `example.profile.json` → `example.profile.github.json`. */
export function githubConfigFileName(profileFileName: string): string {
  return withSuffix(profileFileName, ".github.json");
}

/** `example.profile.json` → `example.profile.github-snapshot.json`. */
export function githubSnapshotFileName(profileFileName: string): string {
  return withSuffix(profileFileName, ".github-snapshot.json");
}

function withSuffix(profileFileName: string, suffix: string): string {
  const base = profileFileName.endsWith(".json")
    ? profileFileName.slice(0, -".json".length)
    : profileFileName;
  return `${base}${suffix}`;
}

export type GitHubConfigRead =
  | { status: "missing" }
  | { status: "invalid"; issues: ProfileIssue[] }
  | { status: "ok"; config: GitHubSourceConfig };

/** Reads and validates the GitHub configuration that belongs to a profile file. */
export async function readGitHubConfig(
  profileFileName: string,
  dir: string,
): Promise<GitHubConfigRead> {
  const fileName = githubConfigFileName(profileFileName);
  const read = await readJsonFile(path.join(dir, fileName), fileName);
  if (read.status !== "ok") return read;
  const parsed = parseGitHubConfig(read.data);
  return parsed.ok
    ? { status: "ok", config: parsed.config }
    : { status: "invalid", issues: inFile(fileName, parsed.issues) };
}

/**
 * Adds the GitHub snapshot's repositories to an owner profile: validate the snapshot,
 * normalize it with the configuration, and merge it with `addObservedRecords`. Pure apart
 * from the inputs, so the fetch command can check a new snapshot before writing it.
 */
export function mergeGitHubSnapshot(
  owner: Profile,
  config: GitHubSourceConfig,
  snapshotData: unknown,
  snapshotFileName: string,
): ProfileLoadResult {
  const snapshot = parseGitHubSnapshot(snapshotData);
  if (!snapshot.ok) return { ok: false, issues: inFile(snapshotFileName, snapshot.issues) };
  const normalized = normalizeGitHubSnapshot(snapshot.snapshot, config);
  if (!normalized.ok) return { ok: false, issues: inFile(snapshotFileName, normalized.issues) };
  const merged = addObservedRecords(owner, normalized.records);
  if (!merged.ok) return merged;
  return {
    ok: true,
    profile: merged.profile,
    warnings: [...inFile(snapshotFileName, normalized.warnings), ...merged.warnings],
  };
}

/**
 * The owner profile plus its GitHub source, if one is configured.
 *
 * - No configuration: the profile as it is.
 * - Configuration but no snapshot yet: the profile as it is, with a warning.
 * - An invalid configuration or snapshot: the load fails, like an invalid profile file,
 *   rather than quietly showing visitors less than the owner deployed.
 */
export async function withGitHubSource(
  owner: Extract<ProfileLoadResult, { ok: true }>,
  profileFileName: string,
  dir: string,
): Promise<ProfileLoadResult> {
  const config = await readGitHubConfig(profileFileName, dir);
  if (config.status === "missing") return owner;
  if (config.status === "invalid") return { ok: false, issues: config.issues };

  const snapshotFileName = githubSnapshotFileName(profileFileName);
  const snapshot = await readJsonFile(path.join(dir, snapshotFileName), snapshotFileName);
  if (snapshot.status === "missing") {
    return {
      ...owner,
      warnings: [
        ...owner.warnings,
        {
          path: `(${snapshotFileName})`,
          message: "No GitHub data yet; run pnpm --filter portfolio fetch-github",
        },
      ],
    };
  }
  if (snapshot.status === "invalid") return { ok: false, issues: snapshot.issues };

  const merged = mergeGitHubSnapshot(owner.profile, config.config, snapshot.data, snapshotFileName);
  if (!merged.ok) return merged;
  return { ...merged, warnings: [...owner.warnings, ...merged.warnings] };
}

type JsonRead =
  | { status: "missing" }
  | { status: "invalid"; issues: ProfileIssue[] }
  | { status: "ok"; data: unknown };

async function readJsonFile(filePath: string, fileName: string): Promise<JsonRead> {
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { status: "missing" };
    return {
      status: "invalid",
      issues: [{ path: `(${fileName})`, message: "File is unreadable" }],
    };
  }
  try {
    return { status: "ok", data: JSON.parse(text) };
  } catch {
    return {
      status: "invalid",
      issues: [{ path: `(${fileName})`, message: "File is not valid JSON" }],
    };
  }
}

/** Prefixes issue paths with the file they belong to, for the owner's error page and log. */
function inFile(fileName: string, issues: ProfileIssue[]): ProfileIssue[] {
  return issues.map((issue) => ({ path: `${fileName}: ${issue.path}`, message: issue.message }));
}
