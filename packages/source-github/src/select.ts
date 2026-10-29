import { type GitHubSourceConfig, isExcluded } from "./config";
import type { ListedRepository } from "./snapshot";

/** How many repositories a fetch includes: more with a token, because the budget is larger. */
export const SELECTION_LIMITS = {
  withoutToken: 12,
  withToken: 20,
  /** GitHub lets a profile pin at most 6 items. */
  pinned: 6,
} as const;

export interface SelectionInput {
  config: GitHubSourceConfig;
  /** The user's own repositories, from the repository list and pinned lookups. */
  repositories: ListedRepository[];
  /** Full names of pinned own repositories, in pin order. Empty without a token. */
  pinned: string[];
  authenticated: boolean;
}

/**
 * Chooses the repositories to include, without any I/O.
 *
 * Kept: the user's own public, non-fork repositories that are not excluded. Order: pinned
 * repositories in pin order, then the rest by most recent push. Capped by tier.
 */
export function selectRepositories(input: SelectionInput): ListedRepository[] {
  const { config, repositories, pinned, authenticated } = input;
  const owner = `${config.user.toLowerCase()}/`;
  const eligible = repositories.filter(
    (repository) =>
      repository.full_name.toLowerCase().startsWith(owner) &&
      !repository.fork &&
      isPublic(repository) &&
      !isExcluded(config, repository.name),
  );

  const pinRank = new Map(pinned.map((fullName, index) => [fullName.toLowerCase(), index]));
  const rankOf = (repository: ListedRepository) =>
    pinRank.get(repository.full_name.toLowerCase()) ?? Number.POSITIVE_INFINITY;
  const pushedAt = (repository: ListedRepository) =>
    repository.pushed_at ? Date.parse(repository.pushed_at) : Number.NEGATIVE_INFINITY;

  const unique = [
    ...new Map(
      eligible.map((repository) => [repository.full_name.toLowerCase(), repository]),
    ).values(),
  ];
  const ordered = unique.sort(
    (a, b) => rankOf(a) - rankOf(b) || pushedAt(b) - pushedAt(a) || a.name.localeCompare(b.name),
  );
  return ordered.slice(
    0,
    authenticated ? SELECTION_LIMITS.withToken : SELECTION_LIMITS.withoutToken,
  );
}

/** Private and internal repositories are never included, even when a token can see them. */
export function isPublic(repository: Pick<ListedRepository, "private" | "visibility">): boolean {
  return (
    !repository.private &&
    (repository.visibility === undefined || repository.visibility === "public")
  );
}
