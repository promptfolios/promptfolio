import type { GitHubSourceConfig } from "../config";
import {
  CONTRIBUTION_LIMITS,
  eligibleCommits,
  firstLine,
  repositoriesWithSharedCommits,
  selectContributions,
} from "../selection/contributions";
import {
  type CommitSearchItem,
  commitSearchResponseSchema,
  repositoryStarsSchema,
  SNAPSHOT_LIMITS,
  type SnapshotContribution,
} from "../snapshot/snapshot";
import { encodePath, type GitHubClient, type GitHubFetchError } from "./github-client";

/**
 * Commits GitHub attributes to the user in other owners' public repositories. Succeeds or fails
 * as a whole, and never stops the run: this data is optional next to the repositories. A failed
 * star lookup only means a copy of a commit may be chosen less well.
 */
export async function fetchContributions(
  client: GitHubClient,
  config: GitHubSourceConfig,
  pinnedOthers: string[],
  retrievedAt: string,
  warnings: string[],
): Promise<{ entries: SnapshotContribution[]; errors: GitHubFetchError[] }> {
  const errors: GitHubFetchError[] = [];
  const collect = (error: GitHubFetchError) => {
    errors.push(error);
  };
  const query = encodeURIComponent(
    `author:${config.user} -user:${config.user} is:public merge:false`,
  );

  const items: CommitSearchItem[] = [];
  for (let page = 1; page <= CONTRIBUTION_LIMITS.pages; page += 1) {
    const response = await client.json(
      `search/commits?q=${query}&sort=author-date&order=desc&per_page=${CONTRIBUTION_LIMITS.perPage}&page=${page}`,
      commitSearchResponseSchema,
      collect,
    );
    if (response === undefined) return { entries: [], errors };
    if (response.incomplete_results) {
      // The answer may be missing items, so it must not replace a complete list.
      collect({
        kind: "incomplete",
        target: "search/commits",
        message: "GitHub returned incomplete search results",
      });
      return { entries: [], errors };
    }
    items.push(...response.items);
    if (response.items.length < CONTRIBUTION_LIMITS.perPage) break;
  }

  const eligible = eligibleCommits(items, config);
  const stars = new Map<string, number>();
  for (const fullName of repositoriesWithSharedCommits(eligible)) {
    const repository = await client.json(
      `repos/${encodePath(fullName)}`,
      repositoryStarsSchema,
      () => warnings.push(`Could not read ${fullName} to choose between copies of a commit`),
    );
    if (repository !== undefined) stars.set(fullName, repository.stargazers_count);
  }

  const selected = selectContributions({ items: eligible, stars, pinned: pinnedOthers });
  const included = new Set(selected.map((item) => item.repository.full_name.toLowerCase()));
  for (const fullName of pinnedOthers) {
    if (!included.has(fullName.toLowerCase())) {
      warnings.push(
        `Pinned repository ${fullName} is owned by someone else, and no commits by @${config.user} were found in it: not included`,
      );
    }
  }
  return {
    entries: selected.map((item) => ({
      retrievedAt,
      sha: item.sha,
      title: firstLine(item.commit.message).slice(0, SNAPSHOT_LIMITS.maxDescriptionChars),
      htmlUrl: item.html_url,
      repository: item.repository.full_name,
      repositoryUrl: item.repository.html_url,
      repositoryDescription: item.repository.description,
      authoredAt: item.commit.author.date,
    })),
    errors,
  };
}
