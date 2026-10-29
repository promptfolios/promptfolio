import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { loadStructuredProfile, type ProfileLoadResult } from "@promptfolio/core";
import { withGitHubSource } from "./github-source";

/** Directory containing profile JSON files, relative to the app root. */
export const PROFILE_DIR = path.join(process.cwd(), "profile");
const DEFAULT_PROFILE_FILE = "example.profile.json";

export interface AppProfile {
  fileName: string;
  result: ProfileLoadResult;
}

export interface LoadAppProfileOptions {
  /** Defaults to `profile/` in the app. */
  dir?: string;
}

/**
 * Reads the profile file selected by `PROMPTFOLIO_PROFILE_FILE` (a file name inside
 * `profile/`), loads it through `@promptfolio/core`, and adds its GitHub source if one is
 * configured (see `withGitHubSource`). Server-only: uses the filesystem.
 */
export async function loadAppProfile(options: LoadAppProfileOptions = {}): Promise<AppProfile> {
  const owner = await loadOwnerProfile(options);
  if (!owner.result.ok) return owner;
  return {
    fileName: owner.fileName,
    result: await withGitHubSource(owner.result, owner.fileName, options.dir ?? PROFILE_DIR),
  };
}

/** The owner's profile file alone, without its sources. Used by the fetch command. */
export async function loadOwnerProfile({ dir }: LoadAppProfileOptions = {}): Promise<AppProfile> {
  const fileName = process.env.PROMPTFOLIO_PROFILE_FILE?.trim() || DEFAULT_PROFILE_FILE;

  // A plain file name only: no directories, so the file is always inside `dir`.
  if (fileName !== path.basename(fileName) || fileName === "." || fileName === "..") {
    return fileError(fileName, "PROMPTFOLIO_PROFILE_FILE must be a file name inside profile/");
  }

  // The app path stays statically scoped to profile/, so Next.js traces only that folder;
  // `dir` is for tests and is ignored by that analysis.
  const filePath =
    dir === undefined
      ? path.join(process.cwd(), "profile", fileName)
      : path.join(/* turbopackIgnore: true */ dir, fileName);

  let text: string;
  let modifiedAt: Date;
  try {
    ({ text, modifiedAt } = await readWithModificationTime(filePath));
  } catch (error) {
    const notFound = (error as NodeJS.ErrnoException).code === "ENOENT";
    return fileError(fileName, notFound ? "Profile file not found" : "Profile file is unreadable");
  }

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return fileError(fileName, "Profile file is not valid JSON");
  }

  return {
    fileName,
    result: loadStructuredProfile(data, {
      sourceId: "owner-profile",
      label: `Owner-provided profile file (${fileName})`,
      observedAt: modifiedAt,
    }),
  };
}

async function readWithModificationTime(filePath: string) {
  const [text, stats] = await Promise.all([readFile(filePath, "utf8"), stat(filePath)]);
  return { text, modifiedAt: stats.mtime };
}

function fileError(fileName: string, message: string): AppProfile {
  return { fileName, result: { ok: false, issues: [{ path: "(file)", message }] } };
}
