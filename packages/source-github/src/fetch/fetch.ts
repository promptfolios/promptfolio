import type { GitHubSourceConfig } from "../config.ts";
import { selectRepositories } from "../selection/select.ts";
import {
  type GitHubSnapshot,
  type ListedRepository,
  languagesResponseSchema,
  listedRepositorySchema,
  repositoryListSchema,
  type SnapshotRepository,
  userResponseSchema,
} from "../snapshot/snapshot.ts";
import { fetchContributions } from "./fetch-contributions.ts";
import { fetchPinned } from "./fetch-pinned.ts";
import {
  encodePath,
  GitHubClient,
  type GitHubClientOptions,
  type GitHubFetchError,
  type GitHubFetchErrorKind,
} from "./github-client.ts";

export type { GitHubFetchError, GitHubFetchErrorKind } from "./github-client.ts";

export interface FetchGitHubOptions extends GitHubClientOptions {
  /** Injected for tests; defaults to the current time. */
  now?: () => Date;
}

/** A selected repository whose languages or README could not be read in this run. */
export interface MissingRepository {
  /** `owner/name` as GitHub returned it. */
  fullName: string;
  errors: GitHubFetchError[];
}

/**
 * - `complete`: every request succeeded; the snapshot has every selected repository.
 * - `partial`: the account and the repository list were read, but some repositories' details
 *   or the contributions were not. The snapshot has only what was read; `selected` gives the
 *   full selection in order, and `carryForward` can fill the gaps from a previous snapshot.
 * - `failed`: nothing usable (account, list, token, rate limit, or budget).
 */
export type FetchGitHubResult =
  | {
      status: "complete";
      snapshot: GitHubSnapshot;
      warnings: string[];
      requests: number;
    }
  | {
      status: "partial";
      snapshot: GitHubSnapshot;
      /** Full names of every selected repository, in selection order. */
      selected: string[];
      missing: MissingRepository[];
      /** Why the contributions could not be read; empty when they were. */
      contributionErrors: GitHubFetchError[];
      warnings: string[];
      requests: number;
    }
  | { status: "failed"; errors: GitHubFetchError[]; requests: number };

/** Errors after which no further request is sent: more requests could not succeed. */
const FATAL: ReadonlySet<GitHubFetchErrorKind> = new Set([
  "not-found",
  "not-a-user",
  "unauthorized",
  "rate-limited",
  "budget",
]);

class FetchStopped extends Error {}

/**
 * Fetches the owner's public GitHub repositories and returns a validated snapshot. The entry point
 * of the only code in this package that does I/O.
 *
 * Requests are sent one at a time. A failure before the per-repository requests (or a rate
 * limit, budget, or token error at any point) fails the whole run. A failed languages or
 * README request makes the run `partial`: that repository is missing from the snapshot and
 * listed in `missing`, so a caller can keep its previous data instead of dropping it (a
 * missing README is not a failure). Contributions come last and succeed or fail as a whole: a
 * failure there also makes the run `partial`, whatever the error, because the repositories
 * already read are still good. There are no automatic retries; the next run is the retry.
 */
export async function fetchGitHubSnapshot(
  config: GitHubSourceConfig,
  options: FetchGitHubOptions = {},
): Promise<FetchGitHubResult> {
  const client = new GitHubClient(options);
  const errors: GitHubFetchError[] = [];
  const warnings: string[] = [];
  const authenticated = options.token !== undefined && options.token !== "";
  const fail = (error: GitHubFetchError) => {
    errors.push(error);
    if (FATAL.has(error.kind)) throw new FetchStopped();
  };

  try {
    const user = await client.json(
      `users/${encodeURIComponent(config.user)}`,
      userResponseSchema,
      fail,
    );
    if (user === undefined) return failed();
    if (user.type !== "User") {
      fail({
        kind: "not-a-user",
        target: `users/${config.user}`,
        message: `@${user.login} is not a user account`,
      });
    }

    const { own: pinned, others: pinnedOthers } = authenticated
      ? await fetchPinned(client, user.login, warnings, fail)
      : { own: [], others: [] };

    const listed =
      (await client.json(
        `users/${encodeURIComponent(user.login)}/repos?type=owner&sort=pushed&direction=desc&per_page=100`,
        repositoryListSchema,
        fail,
      )) ?? [];

    // A pinned repository may be older than the 100 most recently pushed ones.
    const listedNames = new Set(listed.map((repository) => repository.full_name.toLowerCase()));
    const repositories = [...listed];
    for (const fullName of pinned) {
      if (listedNames.has(fullName.toLowerCase())) continue;
      const repository = await client.json(
        `repos/${encodePath(fullName)}`,
        listedRepositorySchema,
        fail,
      );
      if (repository !== undefined) repositories.push(repository);
    }

    // Without the full list, the selection itself would be wrong: nothing usable.
    if (errors.length > 0) return failed();

    const selected = selectRepositories({ config, repositories, pinned, authenticated });
    client.checkBudget(selected.length * 2, fail);

    const retrievedAt = (options.now ?? (() => new Date()))().toISOString();
    const snapshotRepositories: SnapshotRepository[] = [];
    const missing: MissingRepository[] = [];
    for (const repository of selected) {
      const errorsBefore = errors.length;
      const path = `repos/${encodePath(repository.full_name)}`;
      const languages = await client.json(`${path}/languages`, languagesResponseSchema, fail);
      const readme = await client.readme(`${path}/readme`, fail);
      if (languages === undefined || readme === undefined) {
        missing.push({ fullName: repository.full_name, errors: errors.slice(errorsBefore) });
        continue;
      }
      snapshotRepositories.push(
        toSnapshotRepository(
          repository,
          languages,
          readme,
          isPinned(pinned, repository.full_name),
          retrievedAt,
        ),
      );
    }

    const contributions = await fetchContributions(
      client,
      config,
      pinnedOthers,
      retrievedAt,
      warnings,
    );

    const snapshot: GitHubSnapshot = {
      formatVersion: 2,
      retrievedAt,
      authenticated,
      user: { login: user.login, htmlUrl: user.html_url },
      repositories: snapshotRepositories,
      contributions: contributions.entries,
    };
    if (missing.length === 0 && contributions.errors.length === 0) {
      return { status: "complete", snapshot, warnings, requests: client.requests };
    }
    return {
      status: "partial",
      snapshot,
      selected: selected.map((repository) => repository.full_name),
      missing,
      contributionErrors: contributions.errors,
      warnings,
      requests: client.requests,
    };
  } catch (error) {
    if (error instanceof FetchStopped) return failed();
    throw error;
  }

  function failed(): FetchGitHubResult {
    return { status: "failed", errors, requests: client.requests };
  }
}

function toSnapshotRepository(
  repository: ListedRepository,
  languages: Record<string, number>,
  readme: { text: string | null; truncated: boolean },
  pinned: boolean,
  retrievedAt: string,
): SnapshotRepository {
  return {
    retrievedAt,
    name: repository.name,
    fullName: repository.full_name,
    htmlUrl: repository.html_url,
    description: repository.description,
    homepage: repository.homepage ?? null,
    language: repository.language,
    languages,
    topics: repository.topics ?? [],
    fork: repository.fork,
    archived: repository.archived,
    createdAt: repository.created_at ?? null,
    pushedAt: repository.pushed_at ?? null,
    license: repository.license?.spdx_id ?? null,
    pinned,
    readme: readme.text,
    readmeTruncated: readme.truncated,
  };
}

function isPinned(pinned: string[], fullName: string): boolean {
  const key = fullName.toLowerCase();
  return pinned.some((name) => name.toLowerCase() === key);
}
