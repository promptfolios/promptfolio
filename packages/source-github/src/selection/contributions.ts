import { type GitHubSourceConfig, isContributionExcluded } from "../config.ts";
import type { CommitSearchItem } from "../snapshot/snapshot.ts";

/** How much of the commit search is read and kept. */
export const CONTRIBUTION_LIMITS = {
  perPage: 100,
  /** A very active repository can push older commits elsewhere out of reach of these pages. */
  pages: 3,
  perRepository: 5,
  total: 15,
} as const;

/**
 * The commit search results that may count as contributions, without any I/O. The query asks
 * for most of this already; nothing depends on it, because the code cannot verify a query.
 *
 * Kept: non-merge commits GitHub attributes to the user, with a message, in another owner's
 * public, non-fork, not excluded repository.
 */
export function eligibleCommits(
  items: CommitSearchItem[],
  config: GitHubSourceConfig,
): CommitSearchItem[] {
  const user = config.user.toLowerCase();
  return items.filter(
    (item) =>
      item.author?.login.toLowerCase() === user &&
      item.parents.length <= 1 &&
      !item.repository.private &&
      !item.repository.fork &&
      item.repository.owner.login.toLowerCase() !== user &&
      !isContributionExcluded(config, item.repository.full_name) &&
      firstLine(item.commit.message) !== "",
  );
}

/**
 * Repositories that share a commit hash with another one: mirrors, which GitHub does not flag
 * as forks. Only these need a request to tell which copy to keep.
 */
export function repositoriesWithSharedCommits(items: CommitSearchItem[]): string[] {
  const bySha = new Map<string, Set<string>>();
  for (const item of items) {
    const names = bySha.get(item.sha) ?? new Set<string>();
    names.add(item.repository.full_name);
    bySha.set(item.sha, names);
  }
  const shared = new Set<string>();
  for (const names of bySha.values()) {
    if (names.size > 1) for (const name of names) shared.add(name);
  }
  return [...shared].sort();
}

export interface ContributionSelectionInput {
  items: CommitSearchItem[];
  /** Stars of the repositories in `repositoriesWithSharedCommits`; unknown counts as 0. */
  stars: ReadonlyMap<string, number>;
  /** Full names of pinned repositories of other owners, in pin order. Empty without a token. */
  pinned: string[];
}

/**
 * Chooses the commits to keep, without any I/O. A commit in several repositories stays in the
 * one with most stars, ties alphabetically, so the result is stable. Order: pinned repositories
 * in pin order, then the latest commit. Capped per repository and in total.
 */
export function selectContributions(input: ContributionSelectionInput): CommitSearchItem[] {
  const { items, stars, pinned } = input;
  const starsOf = (item: CommitSearchItem) => stars.get(item.repository.full_name) ?? 0;

  const bySha = new Map<string, CommitSearchItem>();
  for (const item of items) {
    const current = bySha.get(item.sha);
    if (current === undefined || isPreferred(item, current, starsOf)) bySha.set(item.sha, item);
  }

  const pinRank = new Map(pinned.map((fullName, index) => [fullName.toLowerCase(), index]));
  const rankOf = (item: CommitSearchItem) =>
    pinRank.get(item.repository.full_name.toLowerCase()) ?? Number.POSITIVE_INFINITY;
  const ordered = [...bySha.values()].sort(
    (a, b) =>
      rankOf(a) - rankOf(b) ||
      Date.parse(b.commit.author.date) - Date.parse(a.commit.author.date) ||
      a.sha.localeCompare(b.sha),
  );

  const perRepository = new Map<string, number>();
  const kept: CommitSearchItem[] = [];
  for (const item of ordered) {
    if (kept.length === CONTRIBUTION_LIMITS.total) break;
    const count = perRepository.get(item.repository.full_name) ?? 0;
    if (count === CONTRIBUTION_LIMITS.perRepository) continue;
    perRepository.set(item.repository.full_name, count + 1);
    kept.push(item);
  }
  return kept;
}

function isPreferred(
  item: CommitSearchItem,
  current: CommitSearchItem,
  starsOf: (item: CommitSearchItem) => number,
): boolean {
  const difference = starsOf(item) - starsOf(current);
  if (difference !== 0) return difference > 0;
  return item.repository.full_name.toLowerCase() < current.repository.full_name.toLowerCase();
}

/** The first line of a commit message, its headline. */
export function firstLine(message: string): string {
  return (message.split(/\r?\n/, 1)[0] ?? "").trim();
}
