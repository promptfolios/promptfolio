import { rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { profileFingerprint } from "@promptfolio/core";
import {
  type CarryForwardResult,
  carryForward,
  fetchGitHubSnapshot,
  type GitHubSnapshot,
  mergeGitHubSnapshot,
  parseGitHubSnapshot,
} from "@promptfolio/source-github";
import {
  githubConfigFileName,
  githubSnapshotFileName,
  readGitHubConfig,
} from "../profile/github-source";
import { loadAppProfile, loadOwnerProfile, PROFILE_DIR } from "../profile/profile";
import { readJsonFile } from "../profile/profile-files";
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

type RefreshLogger = Pick<Console, "log" | "warn" | "error">;

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
  logger?: RefreshLogger;
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

  // Setup errors: nothing to refresh, so no status is written.
  const setup = await loadSetup(options.dir, dir, logger);
  if (setup === undefined) return { outcome: "failed", exitCode: 1 };
  const { fileName, ownerProfile, config } = setup;

  const snapshotFileName = githubSnapshotFileName(fileName);
  const snapshotPath = path.join(dir, snapshotFileName);
  const before = await loadAppProfile({ dir: options.dir });
  const versionBefore = before.result.ok ? await profileFingerprint(before.result.profile) : null;
  const previous = await readPreviousSnapshot(snapshotPath);
  if (previous.status === "invalid") {
    logger.warn(`  note: profile/${snapshotFileName} is invalid; no earlier data can be kept`);
  }
  const previousStatus = await readRefreshStatus(fileName, dir);
  const lastSuccessAt =
    previousStatus.status === "ok" ? previousStatus.refresh.sources.github.lastSuccessAt : null;

  logger.log(
    `Refreshing GitHub data for @${config.user} ${options.token ? "with a token" : "without a token (recent repositories only, no pinned)"}`,
  );
  const attemptAt = now().toISOString();
  const fetched = await fetchGitHubSnapshot(config, {
    token: options.token,
    fetch: options.fetch,
    now,
    timeoutMs: options.timeoutMs,
  });
  const carried = carryForward(previous.status === "ok" ? previous.snapshot : undefined, fetched);
  const finish = (status: RefreshStatus) => finishRun(status, fileName, dir, logger);
  const failedStatus = (errors: SourceRefreshStatus["errors"]): RefreshStatus => ({
    formatVersion: 1,
    profileVersion: versionBefore,
    sources: {
      github: {
        lastAttemptAt: attemptAt,
        outcome: "failed",
        lastSuccessAt,
        snapshotWritten: false,
        versionChanged: false,
        carriedOver: [],
        notAdded: [],
        contributionsKept: false,
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

  const merged = mergeGitHubSnapshot(ownerProfile, config, carried.snapshot, snapshotFileName);
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
  report(carried, writeSnapshot, snapshotFileName, fetched.requests, logger);
  logger.log(
    versionChanged
      ? `\nProfile version changed:\n  before ${versionBefore ?? "(none)"}\n  after  ${versionAfter}`
      : `\nProfile version unchanged: ${versionAfter}`,
  );

  return finish({
    formatVersion: 1,
    profileVersion: versionAfter,
    sources: {
      github: {
        lastAttemptAt: attemptAt,
        outcome,
        lastSuccessAt: outcome === "success" ? attemptAt : lastSuccessAt,
        snapshotWritten: writeSnapshot,
        versionChanged,
        carriedOver: carried.carriedOver.map((entry) => ({
          repository: entry.fullName,
          retrievedAt: entry.retrievedAt,
        })),
        notAdded: carried.notAdded,
        contributionsKept: carried.contributionsKept,
        errors: carried.errors.map(statusError),
      },
    },
  });
}

/** The owner's profile and GitHub configuration, or undefined after logging what is wrong. */
async function loadSetup(optionsDir: string | undefined, dir: string, logger: RefreshLogger) {
  const owner = await loadOwnerProfile({ dir: optionsDir });
  if (!owner.result.ok) {
    logger.error(`Profile ${owner.fileName} could not be loaded:`, owner.result.issues);
    return undefined;
  }
  const configFileName = githubConfigFileName(owner.fileName);
  const config = await readGitHubConfig(owner.fileName, dir);
  if (config.status === "missing") {
    logger.error(
      `No GitHub configuration: create profile/${configFileName} with { "formatVersion": 1, "user": "<username>" }`,
    );
    return undefined;
  }
  if (config.status === "invalid") {
    logger.error(`profile/${configFileName} is invalid:`, config.issues);
    return undefined;
  }
  return { fileName: owner.fileName, ownerProfile: owner.result.profile, config: config.config };
}

/** Writes the status and turns it into the command's result. */
async function finishRun(
  status: RefreshStatus,
  profileFileName: string,
  dir: string,
  logger: RefreshLogger,
): Promise<RefreshResult> {
  const fileName = refreshStatusFileName(profileFileName);
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
  logger: RefreshLogger,
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
  logger.log(
    `Contributions in other owners' repositories: ${result.snapshot.contributions.length}`,
  );
  for (const contribution of result.snapshot.contributions) {
    logger.log(`  ${contribution.repository}  ${contribution.title.slice(0, 70)}`);
  }
  if (result.status === "partial") {
    logger.warn("\nPartial refresh: some data could not be read:");
    for (const error of result.errors) {
      logger.warn(`  ${error.kind}  ${error.target}: ${error.message}`);
    }
    for (const name of result.notAdded) logger.warn(`  not added yet: ${name}`);
    if (result.contributionsKept) logger.warn("  earlier contributions kept");
  }
}

type PreviousSnapshot =
  | { status: "missing" }
  | { status: "invalid" }
  | { status: "ok"; snapshot: GitHubSnapshot };

async function readPreviousSnapshot(filePath: string): Promise<PreviousSnapshot> {
  const read = await readJsonFile(filePath);
  if (read.status !== "ok") return { status: read.status };
  const parsed = parseGitHubSnapshot(read.data);
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
