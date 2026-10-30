import type { FetchGitHubResult, GitHubFetchError } from "./fetch";
import type { GitHubSnapshot, SnapshotRepository } from "./snapshot";

/** A repository whose data comes from the previous snapshot, read at `retrievedAt`. */
export interface CarriedRepository {
  fullName: string;
  retrievedAt: string;
}

/**
 * - `complete`: the fetch read everything; the snapshot is the fetched one.
 * - `partial`: some repositories could not be read. Those in the previous snapshot are kept
 *   from it (`carriedOver`), the others are left out (`notAdded`). Or the contributions could
 *   not be read: all previous ones are kept (`contributionsKept`).
 * - `failed`: nothing to write: the fetch failed, or it was partial with no previous snapshot
 *   to fill the gaps from.
 */
export type CarryForwardResult =
  | {
      status: "complete" | "partial";
      snapshot: GitHubSnapshot;
      carriedOver: CarriedRepository[];
      notAdded: string[];
      contributionsKept: boolean;
      /** Why repositories or contributions could not be read (empty when complete). */
      errors: GitHubFetchError[];
      warnings: string[];
    }
  | { status: "failed"; errors: GitHubFetchError[] };

/**
 * Per-repository last known good: fills the repositories a partial fetch could not read with
 * their entries from the previous snapshot. Pure: no I/O.
 *
 * Which repositories appear, and in what order, always comes from the new fetch: a repository
 * that is no longer selected disappears, because that is a real change, not a failure. A kept
 * repository is the whole previous entry, with its own older `retrievedAt`, so no record mixes
 * data read at two different times. A repository that failed and was never in a snapshot is
 * left out: nothing valid is lost, and the next run adds it. Contributions succeed or fail as
 * a whole: on failure all previous entries are kept, with their dates.
 *
 * @param previous The snapshot currently in use, if one exists and is valid.
 */
export function carryForward(
  previous: GitHubSnapshot | undefined,
  fetched: FetchGitHubResult,
): CarryForwardResult {
  if (fetched.status === "failed") return { status: "failed", errors: fetched.errors };
  if (fetched.status === "complete") {
    return {
      status: "complete",
      snapshot: fetched.snapshot,
      carriedOver: [],
      notAdded: [],
      contributionsKept: false,
      errors: [],
      warnings: fetched.warnings,
    };
  }

  const errors = [
    ...fetched.missing.flatMap((repository) => repository.errors),
    ...fetched.contributionErrors,
  ];
  const sameUser =
    previous !== undefined &&
    previous.user.login.toLowerCase() === fetched.snapshot.user.login.toLowerCase();
  if (!sameUser) return { status: "failed", errors };

  const fresh = byName(fetched.snapshot.repositories);
  const kept = byName(previous.repositories);
  const repositories: SnapshotRepository[] = [];
  const carriedOver: CarriedRepository[] = [];
  const notAdded: string[] = [];
  for (const fullName of fetched.selected) {
    const key = fullName.toLowerCase();
    const entry = fresh.get(key);
    if (entry !== undefined) {
      repositories.push(entry);
      continue;
    }
    const previousEntry = kept.get(key);
    if (previousEntry !== undefined) {
      repositories.push(previousEntry);
      carriedOver.push({ fullName, retrievedAt: previousEntry.retrievedAt });
    } else {
      notAdded.push(fullName);
    }
  }

  const contributionsKept = fetched.contributionErrors.length > 0;
  return {
    status: "partial",
    snapshot: {
      ...fetched.snapshot,
      repositories,
      contributions: contributionsKept ? previous.contributions : fetched.snapshot.contributions,
    },
    carriedOver,
    notAdded,
    contributionsKept,
    errors,
    warnings: fetched.warnings,
  };
}

function byName(repositories: SnapshotRepository[]): Map<string, SnapshotRepository> {
  return new Map(repositories.map((repository) => [repository.fullName.toLowerCase(), repository]));
}
