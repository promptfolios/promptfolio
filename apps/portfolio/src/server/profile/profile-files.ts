import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ProfileIssue } from "@promptfolio/core";

/*
 * The files that live next to a profile file. Server-only: uses the filesystem.
 */

/** `example.profile.json` + `.github.json` → `example.profile.github.json`. */
export function siblingFileName(profileFileName: string, suffix: string): string {
  const base = profileFileName.endsWith(".json")
    ? profileFileName.slice(0, -".json".length)
    : profileFileName;
  return `${base}${suffix}`;
}

export type JsonRead =
  | { status: "missing" }
  | { status: "invalid"; issues: ProfileIssue[] }
  | { status: "ok"; data: unknown };

/** Reads and parses a JSON file. Never throws: a missing file is its own status. */
export async function readJsonFile(filePath: string): Promise<JsonRead> {
  const fileName = path.basename(filePath);
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
