import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { loadStructuredProfile, type ProfileLoadResult } from "@promptfolio/core";

/** Directory containing profile JSON files, relative to the app root. */
const PROFILE_DIR = path.join(process.cwd(), "profile");
const DEFAULT_PROFILE_FILE = "example.profile.json";

export interface AppProfile {
  fileName: string;
  result: ProfileLoadResult;
}

/**
 * Reads the profile file selected by `PROMPTFOLIO_PROFILE_FILE` (a file name inside
 * `profile/`) and loads it through `@promptfolio/core`. Server-only: uses the filesystem.
 */
export async function loadAppProfile(): Promise<AppProfile> {
  const fileName = process.env.PROMPTFOLIO_PROFILE_FILE?.trim() || DEFAULT_PROFILE_FILE;
  const filePath = path.resolve(PROFILE_DIR, fileName);

  if (path.dirname(filePath) !== PROFILE_DIR) {
    return fileError(fileName, "PROMPTFOLIO_PROFILE_FILE must be a file name inside profile/");
  }

  let text: string;
  let modifiedAt: Date;
  try {
    const [contents, stats] = await Promise.all([readFile(filePath, "utf8"), stat(filePath)]);
    text = contents;
    modifiedAt = stats.mtime;
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

function fileError(fileName: string, message: string): AppProfile {
  return { fileName, result: { ok: false, issues: [{ path: "(file)", message }] } };
}
