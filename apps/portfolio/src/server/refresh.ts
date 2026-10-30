import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { profileFingerprint } from "@promptfolio/ai";
import {
  type CarryForwardResult,
  carryForward,
  fetchGitHubSnapshot,
  type GitHubSnapshot,
  parseGitHubSnapshot,
} from "@promptfolio/source-github";
import {
  githubConfigFileName,
  githubSnapshotFileName,
  mergeGitHubSnapshot,
  readGitHubConfig,
} from "./github-source";
import { loadPreparedAnswers } from "./prepared-answers";
import { loadAppProfile, loadOwnerProfile, PROFILE_DIR } from "./profile";
import {
  parseRefreshStatus,
  type RefreshStatus,
  readRefreshStatus,
  refreshStatusFileName,
  type SourceRefreshStatus,
} from "./refresh-status";

/*
 * A refresh updates the fetched sources of the configured profile (today: GitHub) and records
 * what happened. Run by `pnpm --filter portfolio refresh`, by hand or by a scheduled job.
 *
 * 1. Fetch. Repositories whose details could not be read keep their previous data
 *    (`carryForward`), with the time it was read.
 * 2. Validate by merging into the owner's profile, before anything is written.
 * 3. Compare the profile version (the content fingerprint) with the current one. The snapshot
 *    is written only when the version changed, so a run that finds nothing new leaves it
 *    byte-for-byte unchanged and a scheduled job has nothing to commit.
 * 4. Write the refresh status, on every run that got as far as fetching.
 *
 * Server-only: uses the filesystem and the network (through the fetcher).
 */

export type RefreshOutcome = "success" | "partial" | "failed";

export interface RunRefreshOptions {
  /** Defaults to `profile/` in the app. */
  dir?: string;
  /** A GitHub token, if available. Never logged or written. */
  token?: string;
  /** Injected for tests; defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Injected for tests; defaults to the current time. */
  now?: () => Date;
  timeoutMs?: number;
  logger?: Pick<Console, "log" | "warn" | "error">;
}

export interface RefreshResult {
  outcome: RefreshOutcome;
  /** 0 success, 2 partial (data written, not all of it current), 1 failed (nothing written). */
  exitCode: 0 | 1 | 2;
  /** The status written, or undefined when the run stopped before fetching (a setup error). */
  status?: RefreshStatus;
}

export async function runRefresh(options: RunRefreshOptions = {}): Promise<RefreshResult> {
  const dir = options.dir ?? PROFILE_DIR;
  const logger = options.logger ?? console;
  const now = options.now ?? (() => new Date());
  const setupError: RefreshResult = { outcome: "failed", exitCode: 1 };

  // Setup errors: nothing to refresh, so no status is written.
  const owner = await loadOwnerProfile({ dir: options.dir });
  if (!owner.result.ok) {
    logger.error(`Profile ${owner.fileName} could not be loaded:`, owner.result.issues);
    return setupError;
  }
  const configFileName = githubConfigFileName(owner.fileName);
  const config = await readGitHubConfig(owner.fileName, dir);
  if (config.status === "missing") {
    logger.error(
      `No GitHub configuration: create profile/${configFileName} with { "formatVersion": 1, "user": "<username>" }`,
    );
    return setupError;
  }
  if (config.status === "invalid") {
    logger.error(`profile/${configFileName} is invalid:`, config.issues);
    return setupError;
  }

  const snapshotFileName = githubSnapshotFileName(owner.fileName);
  const snapshotPath = path.join(dir, snapshotFileName);
  const before = await loadAppProfile({ dir: options.dir });
  const versionBefore = before.result.ok ? await profileFingerprint(before.result.profile) : null;
  const previous = await readPreviousSnapshot(snapshotPath);
  if (previous.status === "invalid") {
    logger.warn(`  note: profile/${snapshotFileName} is invalid; no earlier data can be kept`);
  }
  const previousStatus = await readRefreshStatus(owner.fileName, dir);
  const lastSuccessAt =
    previousStatus.status === "ok" ? previousStatus.refresh.sources.github.lastSuccessAt : null;

  logger.log(
    `Refreshing GitHub data for @${config.config.user} ${options.token ? "with a token" : "without a token (recent repositories only, no pinned)"}`,
  );
  const attemptAt = now();
  const fetched = await fetchGitHubSnapshot(config.config, {
    token: options.token,
    fetch: options.fetch,
    now,
    timeoutMs: options.timeoutMs,
  });
  const carried = carryForward(previous.status === "ok" ? previous.snapshot : undefined, fetched);
  const failedStatus = (errors: SourceRefreshStatus["errors"]): RefreshStatus => ({
    formatVersion: 1,
    profileVersion: versionBefore,
    sources: {
      github: {
        lastAttemptAt: attemptAt.toISOString(),
        outcome: "failed",
        lastSuccessAt,
        snapshotWritten: false,
        versionChanged: false,
        carriedOver: [],
        notAdded: [],
        errors,
      },
    },
  });

  if (carried.status === "failed") {
    logger.error(
      `\nRefresh failed after ${fetched.requests} requests; the previous data was kept:`,
    );
    for (const error of carried.errors) {
      logger.error(`  ${error.kind}  ${error.target}: ${error.message}`);
    }
    return finish(failedStatus(carried.errors.map(statusError)));
  }
  for (const warning of carried.warnings) logger.warn(`  note: ${warning}`);

  const merged = mergeGitHubSnapshot(
    owner.result.profile,
    config.config,
    carried.snapshot,
    snapshotFileName,
  );
  if (!merged.ok) {
    logger.error("\nThe fetched data does not fit the profile; the previous data was kept:");
    for (const issue of merged.issues) logger.error(`  ${issue.path}: ${issue.message}`);
    return finish(
      failedStatus(
        merged.issues.slice(0, 20).map((issue) => ({
          kind: "invalid-data",
          target: snapshotFileName,
          message: `${issue.path}: ${issue.message}`.slice(0, 500),
        })),
      ),
    );
  }
  for (const warning of merged.warnings) {
    logger.warn(`  note: ${warning.path}: ${warning.message}`);
  }

  const versionAfter = await profileFingerprint(merged.profile);
  const versionChanged = versionAfter !== versionBefore;
  const writeSnapshot = versionChanged || previous.status !== "ok";
  if (writeSnapshot) await writeJsonAtomically(snapshotPath, carried.snapshot);

  const outcome: RefreshOutcome = carried.status === "complete" ? "success" : "partial";
  report(carried, writeSnapshot, snapshotFileName, fetched.requests);
  logger.log(
    versionChanged
      ? `\nProfile version changed:\n  before ${versionBefore ?? "(none)"}\n  after  ${versionAfter}`
      : `\nProfile version unchanged: ${versionAfter}`,
  );
  await reportPreparedAnswers(owner.fileName, versionAfter);

  return finish({
    formatVersion: 1,
    profileVersion: versionAfter,
    sources: {
      github: {
        lastAttemptAt: attemptAt.toISOString(),
        outcome,
        lastSuccessAt: outcome === "success" ? attemptAt.toISOString() : lastSuccessAt,
        snapshotWritten: writeSnapshot,
        versionChanged,
        carriedOver: carried.carriedOver.map((entry) => ({
          repository: entry.fullName,
          retrievedAt: entry.retrievedAt,
        })),
        notAdded: carried.notAdded,
        errors: carried.errors.map(statusError),
      },
    },
  });

  async function finish(status: RefreshStatus): Promise<RefreshResult> {
    const fileName = refreshStatusFileName(owner.fileName);
    // Validate before writing, so the command never writes a status it could not read back.
    const valid = parseRefreshStatus(status);
    if (valid === undefined) {
      logger.error(`The refresh status is invalid; profile/${fileName} was not written`);
    } else {
      await writeJsonAtomically(path.join(dir, fileName), valid);
    }
    const outcome = status.sources.github.outcome;
    return { outcome, exitCode: outcome === "success" ? 0 : outcome === "partial" ? 2 : 1, status };
  }

  function report(
    result: Extract<CarryForwardResult, { snapshot: GitHubSnapshot }>,
    written: boolean,
    fileName: string,
    requests: number,
  ): void {
    logger.log(
      written
        ? `\nWrote ${result.snapshot.repositories.length} repositories to profile/${fileName} (${requests} requests):`
        : `\nNo change: profile/${fileName} kept as it is (${requests} requests). Repositories:`,
    );
    const carriedNames = new Set(result.carriedOver.map((entry) => entry.fullName.toLowerCase()));
    for (const repository of result.snapshot.repositories) {
      const mark = carriedNames.has(repository.fullName.toLowerCase())
        ? `kept from ${repository.retrievedAt}`
        : repository.pinned
          ? "pinned"
          : "";
      logger.log(`  ${repository.fullName}${mark === "" ? "" : `  (${mark})`}`);
    }
    if (result.status === "partial") {
      logger.warn("\nPartial refresh: some repositories could not be read:");
      for (const error of result.errors) {
        logger.warn(`  ${error.kind}  ${error.target}: ${error.message}`);
      }
      for (const name of result.notAdded) logger.warn(`  not added yet: ${name}`);
    }
  }

  async function reportPreparedAnswers(profileFileName: string, version: string): Promise<void> {
    const answers = await loadPreparedAnswers(profileFileName, { dir, logger });
    if (answers.length === 0) return;
    const current = answers.filter((answer) => answer.profileFingerprint === version).length;
    logger.log(
      current === answers.length
        ? `Prepared answers: all ${answers.length} belong to this version.`
        : `Prepared answers: ${current} of ${answers.length} belong to this version; the others are answered live until you run pnpm --filter portfolio prepare-answers.`,
    );
  }
}

type PreviousSnapshot =
  | { status: "missing" }
  | { status: "invalid" }
  | { status: "ok"; snapshot: GitHubSnapshot };

async function readPreviousSnapshot(filePath: string): Promise<PreviousSnapshot> {
  let data: unknown;
  try {
    data = JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? { status: "missing" }
      : { status: "invalid" };
  }
  const parsed = parseGitHubSnapshot(data);
  return parsed.ok ? { status: "ok", snapshot: parsed.snapshot } : { status: "invalid" };
}

function statusError(error: { kind: string; target: string; message: string }) {
  return {
    kind: error.kind,
    target: error.target.slice(0, 500),
    message: error.message.slice(0, 500),
  };
}

/** Writes a temporary file and renames it, so a reader never sees a half-written file. */
async function writeJsonAtomically(filePath: string, data: unknown): Promise<void> {
  const temporary = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`);
  await rename(temporary, filePath);
}
