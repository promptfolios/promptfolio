import type { Profile, ProfileLoadResult } from "@promptfolio/core";
import type { GitHubSourceConfig } from "../config.ts";
import { fetchGitHubSnapshot } from "../fetch/fetch.ts";
import { carryForward } from "../snapshot/carry-forward.ts";
import { mergeGitHubSnapshot } from "../snapshot/merge.ts";
import { parseGitHubSnapshot } from "../snapshot/snapshot.ts";
import type { GitHubSnapshotStore } from "./store.ts";

const HOUR_MS = 60 * 60 * 1000;

export interface BackgroundRefreshIntervals {
  /** Wait after a complete refresh. Default 6 hours. */
  completeMs?: number;
  /** Wait after a partial or failed one; the stored snapshot stays in use meanwhile. Default 1 hour. */
  retryMs?: number;
  /**
   * How long the lock is held at most, so a run that crashed cannot block later ones. Make it
   * longer than the work may run (your host's request time limit). Default 120 seconds.
   */
  lockSeconds?: number;
}

export interface BackgroundGitHubSourceOptions {
  store: GitHubSnapshotStore;
  config: GitHubSourceConfig;
  /** A GitHub token, optional as for `fetchGitHubSnapshot`. */
  token?: string;
  /**
   * Runs `work` after the response has been sent, without the request waiting for it. On Next.js
   * pass `after` from `next/server`; on other hosts, the platform's `waitUntil`.
   */
  runAfterResponse: (work: () => Promise<void>) => void;
  intervals?: BackgroundRefreshIntervals;
  /** Prefixes the paths of issues found in the stored snapshot. Default `stored GitHub snapshot`. */
  snapshotName?: string;
  /** Injected for tests; defaults to `Date.now`. */
  now?: () => number;
  /** Injected for tests; defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

/**
 * - `not-due`: the last refresh is recent enough.
 * - `locked`: another run holds the lock.
 * - `complete`: the new snapshot is stored.
 * - `partial`: the new snapshot is stored, with some earlier data kept (see `carryForward`).
 * - `failed`: nothing was stored; the previous snapshot stays in use.
 */
export type RefreshOutcome = "not-due" | "locked" | "complete" | "partial" | "failed";

export interface BackgroundGitHubSource {
  /**
   * The owner profile with the stored GitHub data added, and a refresh check handed to
   * `runAfterResponse`. Never calls GitHub. With no stored snapshot, or one that cannot be read
   * or does not fit, it returns the owner profile alone (with warnings), so visitors still get
   * an answer. A failed owner profile is returned unchanged.
   */
  loadProfile(owner: ProfileLoadResult): Promise<ProfileLoadResult>;
  /** Refreshes the stored snapshot if it is due. Never rejects. For a cron route or tests. */
  refreshIfDue(owner: Profile): Promise<RefreshOutcome>;
}

/**
 * GitHub data kept in a store the application supplies and refreshed after responses, instead of
 * a committed snapshot file. Opt-in: the file and scheduled job stay the documented default.
 */
export function createBackgroundGitHubSource(
  options: BackgroundGitHubSourceOptions,
): BackgroundGitHubSource {
  return createWithFetcher(options, fetchGitHubSnapshot);
}

/** Not exported from the package: lets tests replace the whole fetch. */
export function createWithFetcher(
  options: BackgroundGitHubSourceOptions,
  fetchSnapshot: typeof fetchGitHubSnapshot,
): BackgroundGitHubSource {
  const { store, config } = options;
  const now = options.now ?? Date.now;
  const completeMs = positive(options.intervals?.completeMs ?? 6 * HOUR_MS, "completeMs");
  const retryMs = positive(options.intervals?.retryMs ?? HOUR_MS, "retryMs");
  const lockSeconds = positive(options.intervals?.lockSeconds ?? 120, "lockSeconds");
  const snapshotName = options.snapshotName ?? "stored GitHub snapshot";

  // Fetches, checks, and stores a new snapshot. Rejects only if the store does.
  async function refresh(owner: Profile): Promise<"complete" | "partial" | "failed"> {
    // repositories this run cannot read keep their data from the stored snapshot
    const stored = parseGitHubSnapshot(await store.get("snapshot"));
    const previous = stored.ok ? stored.snapshot : undefined;

    const fetched = await fetchSnapshot(config, { token: options.token, fetch: options.fetch });
    const carried = carryForward(previous, fetched);
    if (carried.status === "failed") {
      console.error("GitHub refresh failed; the stored snapshot stays:", messages(carried.errors));
      return "failed";
    }

    // the new snapshot must fit the profile before it replaces the stored one
    const merged = mergeGitHubSnapshot(owner, config, carried.snapshot);
    if (!merged.ok) {
      console.error(
        "GitHub snapshot does not fit the profile; the stored one stays:",
        merged.issues,
      );
      return "failed";
    }

    await store.set("snapshot", carried.snapshot);
    if (carried.status === "partial") {
      console.warn(
        "GitHub refresh was partial; some earlier data was kept:",
        messages(carried.errors),
      );
    }
    return carried.status;
  }

  async function refreshIfDue(owner: Profile): Promise<RefreshOutcome> {
    let token: string | undefined;
    try {
      const refreshAfter = await store.get("refresh-after");
      if (typeof refreshAfter === "number" && now() < refreshAfter) return "not-due";
      token = await store.lock(lockSeconds);
      if (token === undefined) return "locked";
    } catch {
      // the error is dropped: it could repeat a store credential
      console.error("GitHub refresh: the snapshot store failed; trying again on a later request");
      return "failed";
    }

    let outcome: "complete" | "partial" | "failed";
    try {
      outcome = await refresh(owner);
    } catch {
      // usually the store; the error is dropped for the same reason
      console.error("GitHub refresh threw; the stored snapshot stays");
      outcome = "failed";
    }

    try {
      await store.set("refresh-after", now() + (outcome === "complete" ? completeMs : retryMs));
    } catch {
      console.error("GitHub refresh: could not store when the next refresh is due");
    }
    try {
      await store.unlock(token);
    } catch {
      console.error("GitHub refresh: could not release the lock; it expires on its own");
    }
    return outcome;
  }

  async function loadProfile(owner: ProfileLoadResult): Promise<ProfileLoadResult> {
    if (!owner.ok) return owner;
    schedule(owner.profile);

    let stored: unknown;
    try {
      stored = await store.get("snapshot");
    } catch {
      return withWarning(owner, "the store could not be read; GitHub data left out");
    }
    if (stored === undefined || stored === null) return owner;

    const merged = mergeGitHubSnapshot(owner.profile, config, stored, snapshotName);
    if (!merged.ok) {
      // the next refresh overwrites it
      return { ...owner, warnings: [...owner.warnings, ...merged.issues] };
    }
    return { ...merged, warnings: [...owner.warnings, ...merged.warnings] };
  }

  function schedule(owner: Profile): void {
    try {
      options.runAfterResponse(async () => {
        await refreshIfDue(owner);
      });
    } catch {
      console.error("GitHub refresh: runAfterResponse threw; no refresh was scheduled");
    }
  }

  function withWarning(
    owner: ProfileLoadResult & { ok: true },
    message: string,
  ): ProfileLoadResult {
    return { ...owner, warnings: [...owner.warnings, { path: snapshotName, message }] };
  }

  return { loadProfile, refreshIfDue };
}

function positive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`intervals.${name} must be a positive number`);
  }
  return value;
}

// Fetch errors never contain the token, headers, or response bodies.
function messages(errors: { target: string; message: string }[]): string[] {
  return errors.map((error) => `${error.target}: ${error.message}`);
}
