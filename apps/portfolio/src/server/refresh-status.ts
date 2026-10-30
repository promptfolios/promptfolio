import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ProfileIssue } from "@promptfolio/core";
import { z } from "zod";

/*
 * The refresh status: what the last `pnpm --filter portfolio refresh` did, written next to the
 * profile as `<name>.refresh-status.json` at the end of every run, including failed ones.
 *
 * The data files (the snapshot) say what a source showed and when. This file says how the
 * last attempt to update them went: success, partial (some data kept from an earlier run), or
 * failed (nothing replaced). It is informational: a missing or invalid status never stops the
 * profile from loading. Server-only: uses the filesystem.
 */

/** `example.profile.json` → `example.profile.refresh-status.json`. */
export function refreshStatusFileName(profileFileName: string): string {
  const base = profileFileName.endsWith(".json")
    ? profileFileName.slice(0, -".json".length)
    : profileFileName;
  return `${base}.refresh-status.json`;
}

const isoDateTime = z.iso.datetime({ offset: true });
const text = z.string().max(500);

const sourceStatusSchema = z.strictObject({
  lastAttemptAt: isoDateTime,
  outcome: z.enum(["success", "partial", "failed"]),
  /** The last run whose outcome was `success`, or null if none is known. */
  lastSuccessAt: isoDateTime.nullable(),
  snapshotWritten: z.boolean(),
  /** Whether the profile version (content fingerprint) changed in this run. */
  versionChanged: z.boolean(),
  /** Repositories whose data was kept from an earlier run, and when it was read. */
  carriedOver: z.array(z.strictObject({ repository: text, retrievedAt: isoDateTime })).max(100),
  /** Repositories that failed and had no earlier data, so they are not in the profile yet. */
  notAdded: z.array(text).max(100),
  /** Sanitized messages: never a token, header, or response body. */
  errors: z.array(z.strictObject({ kind: text, target: text, message: text })).max(100),
});

const refreshStatusSchema = z.strictObject({
  formatVersion: z.literal(1),
  /** The profile version after the run: the content fingerprint, or null if unknown. */
  profileVersion: z
    .string()
    .regex(/^sha256:[0-9a-f]{64}$/)
    .nullable(),
  sources: z.strictObject({ github: sourceStatusSchema }),
});

export type RefreshStatus = z.infer<typeof refreshStatusSchema>;
export type SourceRefreshStatus = z.infer<typeof sourceStatusSchema>;

export type RefreshStatusRead =
  | { status: "missing" }
  | { status: "invalid" }
  | { status: "ok"; refresh: RefreshStatus };

/** Reads the refresh status that belongs to a profile file. Never throws. */
export async function readRefreshStatus(
  profileFileName: string,
  dir: string,
): Promise<RefreshStatusRead> {
  let data: unknown;
  try {
    data = JSON.parse(
      await readFile(path.join(dir, refreshStatusFileName(profileFileName)), "utf8"),
    );
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? { status: "missing" }
      : { status: "invalid" };
  }
  const parsed = refreshStatusSchema.safeParse(data);
  return parsed.success ? { status: "ok", refresh: parsed.data } : { status: "invalid" };
}

/** Validates a status before it is written, so the command never writes one it cannot read. */
export function parseRefreshStatus(data: unknown): RefreshStatus | undefined {
  const parsed = refreshStatusSchema.safeParse(data);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Warnings for the owner (logged on the server, never shown to visitors) when the last refresh
 * did not fully succeed. A visitor is protected from stale data by the observation date of
 * every record, not by these messages.
 */
export async function refreshStatusWarnings(
  profileFileName: string,
  dir: string,
): Promise<ProfileIssue[]> {
  const fileName = refreshStatusFileName(profileFileName);
  const issuePath = `(${fileName})`;
  const read = await readRefreshStatus(profileFileName, dir);
  if (read.status === "missing") return [];
  if (read.status === "invalid") {
    return [{ path: issuePath, message: "Refresh status is unreadable or invalid; ignored" }];
  }

  const github = read.refresh.sources.github;
  if (github.outcome === "failed") {
    const since = github.lastSuccessAt === null ? "" : `; last success at ${github.lastSuccessAt}`;
    return [
      {
        path: issuePath,
        message: `Last GitHub refresh failed at ${github.lastAttemptAt}${since}; the previous data is still in use`,
      },
    ];
  }
  if (github.outcome === "partial") {
    const carried = github.carriedOver.map(
      (entry) => `${entry.repository} (read ${entry.retrievedAt})`,
    );
    const parts = [
      carried.length > 0 ? `kept earlier data for ${carried.join(", ")}` : "",
      github.notAdded.length > 0 ? `could not add ${github.notAdded.join(", ")}` : "",
    ].filter((part) => part !== "");
    return [
      {
        path: issuePath,
        message: `Last GitHub refresh at ${github.lastAttemptAt} was partial: ${parts.join("; ")}`,
      },
    ];
  }
  return [];
}
