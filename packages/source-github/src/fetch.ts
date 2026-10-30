import type { z } from "zod";
import type { GitHubSourceConfig } from "./config";
import {
  CONTRIBUTION_LIMITS,
  eligibleCommits,
  firstLine,
  repositoriesWithSharedCommits,
  selectContributions,
} from "./contributions";
import { SELECTION_LIMITS, selectRepositories } from "./select";
import {
  type CommitSearchItem,
  commitSearchResponseSchema,
  type GitHubSnapshot,
  type ListedRepository,
  languagesResponseSchema,
  listedRepositorySchema,
  pinnedResponseSchema,
  repositoryListSchema,
  repositoryStarsSchema,
  SNAPSHOT_LIMITS,
  type SnapshotContribution,
  type SnapshotRepository,
  userResponseSchema,
} from "./snapshot";

export const FETCH_DEFAULTS = {
  apiBaseUrl: "https://api.github.com",
  apiVersion: "2026-03-10",
  userAgent: "promptfolio-source-github",
  timeoutMs: 10_000,
  /** JSON responses above this size are rejected. */
  maxResponseChars: 1_000_000,
} as const;

export interface FetchGitHubOptions {
  /** A GitHub token. Optional: without one, pinned repositories are skipped and fewer are kept. */
  token?: string;
  /** Injected for tests; defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Injected for tests; defaults to the current time. */
  now?: () => Date;
  timeoutMs?: number;
}

export type GitHubFetchErrorKind =
  | "not-found"
  | "not-a-user"
  | "unauthorized"
  | "rate-limited"
  | "budget"
  | "http"
  | "network"
  | "timeout"
  | "malformed"
  | "incomplete";

/** A failed request. Messages never contain the token, headers, or response bodies. */
export interface GitHubFetchError {
  kind: GitHubFetchErrorKind;
  /** What was requested, for example `repos/jordan/linter/readme`. */
  target: string;
  message: string;
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
 * Fetches the owner's public GitHub repositories and returns a validated snapshot. The only
 * function in this package that does I/O.
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

/**
 * Commits GitHub attributes to the user in other owners' public repositories. Succeeds or fails
 * as a whole, and never stops the run: this data is optional next to the repositories. A failed
 * star lookup only means a copy of a commit may be chosen less well.
 */
async function fetchContributions(
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

/**
 * Full names of pinned public repositories, in pin order (GraphQL, token only): the user's own,
 * and those of other owners, which only rank contributions.
 *
 * GraphQL can answer with partial data: an item the token may not read (for example a
 * repository of an organization that forbids fine-grained tokens) is `null`, with an error
 * whose `path` points at it. Such an item is skipped with a warning. Any other error, or an
 * answer without the user, means the query as a whole was rejected.
 */
async function fetchPinned(
  client: GitHubClient,
  login: string,
  warnings: string[],
  fail: (error: GitHubFetchError) => void,
): Promise<{ own: string[]; others: string[] }> {
  const query = `query($login: String!) { user(login: $login) { pinnedItems(first: ${SELECTION_LIMITS.pinned}, types: REPOSITORY) { nodes { ... on Repository { nameWithOwner isFork isPrivate } } } } }`;
  const response = await client.graphql(
    { query, variables: { login } },
    pinnedResponseSchema,
    fail,
  );
  if (response === undefined) return { own: [], others: [] };
  const nodes = response.data?.user?.pinnedItems.nodes;
  const errors = response.errors ?? [];
  const itemErrors = errors.filter((error) => pinnedItemIndex(error.path) !== undefined);
  if (nodes === undefined || itemErrors.length < errors.length) {
    fail({
      kind: "unauthorized",
      target: "graphql",
      message: "GitHub rejected the pinned repositories query; check GITHUB_TOKEN",
    });
    return { own: [], others: [] };
  }
  for (const error of itemErrors) {
    const reason =
      error.type !== undefined && /^[A-Z_]{1,40}$/.test(error.type) ? error.type : "an error";
    warnings.push(
      `Skipped pinned item ${(pinnedItemIndex(error.path) ?? 0) + 1}: GitHub did not return it (${reason})`,
    );
  }

  const owner = `${login.toLowerCase()}/`;
  const own: string[] = [];
  const others: string[] = [];
  for (const node of nodes) {
    if (node === null || node.nameWithOwner === undefined || node.isFork || node.isPrivate)
      continue;
    (node.nameWithOwner.toLowerCase().startsWith(owner) ? own : others).push(node.nameWithOwner);
  }
  return { own, others };
}

/** The item index of an error path `user.pinnedItems.nodes.<index>`, or undefined. */
function pinnedItemIndex(path: Array<string | number> | undefined): number | undefined {
  if (path === undefined || path.length !== 4) return undefined;
  const [user, items, nodes, index] = path;
  return user === "user" &&
    items === "pinnedItems" &&
    nodes === "nodes" &&
    typeof index === "number"
    ? index
    : undefined;
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

/** `owner/name` with each segment encoded. */
function encodePath(fullName: string): string {
  return fullName.split("/").map(encodeURIComponent).join("/");
}

type GitHubResponse = { status: number; headers: Headers; text: string };

/** Sends requests one at a time and turns every failure into a typed error. */
class GitHubClient {
  requests = 0;
  private remaining: number | undefined;
  private reset: number | undefined;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: FetchGitHubOptions) {
    this.fetchFn = options.fetch ?? globalThis.fetch;
  }

  async json<T>(
    path: string,
    schema: z.ZodType<T>,
    fail: (error: GitHubFetchError) => void,
  ): Promise<T | undefined> {
    const response = await this.send(path, { accept: "application/vnd.github+json" }, fail);
    return response === undefined ? undefined : this.parse(path, response, schema, fail);
  }

  async graphql<T>(
    body: object,
    schema: z.ZodType<T>,
    fail: (error: GitHubFetchError) => void,
  ): Promise<T | undefined> {
    const response = await this.send(
      "graphql",
      { accept: "application/json", method: "POST", body: JSON.stringify(body) },
      fail,
    );
    return response === undefined ? undefined : this.parse("graphql", response, schema, fail);
  }

  /** The raw README text, or `text: null` when the repository has none (404). */
  async readme(
    path: string,
    fail: (error: GitHubFetchError) => void,
  ): Promise<{ text: string | null; truncated: boolean } | undefined> {
    const response = await this.send(
      path,
      { accept: "application/vnd.github.raw+json", allow404: true },
      fail,
    );
    if (response === undefined) return undefined;
    if (response.status === 404) return { text: null, truncated: false };
    const truncated = response.text.length > SNAPSHOT_LIMITS.maxReadmeChars;
    return { text: response.text.slice(0, SNAPSHOT_LIMITS.maxReadmeChars), truncated };
  }

  /** Stops before a series of requests that the remaining rate limit cannot cover. */
  checkBudget(needed: number, fail: (error: GitHubFetchError) => void): void {
    if (this.remaining !== undefined && this.remaining < needed) {
      fail({
        kind: "budget",
        target: "rate limit",
        message: `${needed} more requests are needed but only ${this.remaining} remain${this.resetText()}`,
      });
    }
  }

  private async send(
    path: string,
    request: { accept: string; method?: string; body?: string; allow404?: boolean },
    fail: (error: GitHubFetchError) => void,
  ): Promise<GitHubResponse | undefined> {
    const target = path.split("?")[0] ?? path;
    const headers: Record<string, string> = {
      Accept: request.accept,
      "User-Agent": FETCH_DEFAULTS.userAgent,
      "X-GitHub-Api-Version": FETCH_DEFAULTS.apiVersion,
    };
    if (this.options.token) headers.Authorization = `Bearer ${this.options.token}`;
    if (request.body !== undefined) headers["Content-Type"] = "application/json";

    this.requests += 1;
    let response: Response;
    let text: string;
    try {
      response = await this.fetchFn(`${FETCH_DEFAULTS.apiBaseUrl}/${path}`, {
        method: request.method ?? "GET",
        headers,
        ...(request.body !== undefined && { body: request.body }),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? FETCH_DEFAULTS.timeoutMs),
      });
      text = await response.text();
    } catch (error) {
      const timedOut =
        error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      fail(
        timedOut
          ? { kind: "timeout", target, message: "GitHub did not answer in time" }
          : { kind: "network", target, message: "GitHub could not be reached" },
      );
      return undefined;
    }

    this.trackRateLimit(response.headers);
    const { status } = response;
    if (status >= 200 && status < 300) return { status, headers: response.headers, text };
    if (status === 404 && request.allow404) return { status, headers: response.headers, text: "" };
    fail(this.errorFor(target, status, response.headers, text));
    return undefined;
  }

  private parse<T>(
    target: string,
    response: GitHubResponse,
    schema: z.ZodType<T>,
    fail: (error: GitHubFetchError) => void,
  ): T | undefined {
    if (response.text.length > FETCH_DEFAULTS.maxResponseChars) {
      fail({ kind: "malformed", target, message: "The response is larger than expected" });
      return undefined;
    }
    let data: unknown;
    try {
      data = JSON.parse(response.text);
    } catch {
      fail({ kind: "malformed", target, message: "The response is not JSON" });
      return undefined;
    }
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      const paths = parsed.error.issues
        .slice(0, 3)
        .map((issue) => issue.path.join(".") || "(root)");
      fail({
        kind: "malformed",
        target,
        message: `Unexpected response shape at ${paths.join(", ")}`,
      });
      return undefined;
    }
    return parsed.data;
  }

  private errorFor(
    target: string,
    status: number,
    headers: Headers,
    text: string,
  ): GitHubFetchError {
    if (status === 401) {
      return {
        kind: "unauthorized",
        target,
        message: "GitHub rejected the token; check GITHUB_TOKEN",
      };
    }
    if (status === 403 || status === 429) {
      if (headers.get("x-ratelimit-remaining") === "0") {
        return { kind: "rate-limited", target, message: `Rate limit reached${this.resetText()}` };
      }
      const retryAfter = headers.get("retry-after");
      if (retryAfter !== null || /secondary rate limit/i.test(text)) {
        const wait = retryAfter !== null ? `; retry after ${retryAfter} seconds` : "";
        return { kind: "rate-limited", target, message: `Secondary rate limit reached${wait}` };
      }
    }
    if (status === 404) {
      return { kind: "not-found", target, message: "Not found, or not public" };
    }
    return { kind: "http", target, message: `GitHub answered with status ${status}` };
  }

  private trackRateLimit(headers: Headers): void {
    const remaining = Number.parseInt(headers.get("x-ratelimit-remaining") ?? "", 10);
    const reset = Number.parseInt(headers.get("x-ratelimit-reset") ?? "", 10);
    // GraphQL has its own budget (points); only REST headers describe the next requests.
    const resource = headers.get("x-ratelimit-resource");
    if (resource !== null && resource !== "core") return;
    if (!Number.isNaN(remaining)) this.remaining = remaining;
    if (!Number.isNaN(reset)) this.reset = reset;
  }

  private resetText(): string {
    return this.reset === undefined
      ? ""
      : `; it resets at ${new Date(this.reset * 1000).toISOString()}`;
  }
}

function isPinned(pinned: string[], fullName: string): boolean {
  const key = fullName.toLowerCase();
  return pinned.some((name) => name.toLowerCase() === key);
}
