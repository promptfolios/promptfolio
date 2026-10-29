import type { z } from "zod";
import type { GitHubSourceConfig } from "./config";
import { SELECTION_LIMITS, selectRepositories } from "./select";
import {
  type GitHubSnapshot,
  type ListedRepository,
  languagesResponseSchema,
  listedRepositorySchema,
  pinnedResponseSchema,
  repositoryListSchema,
  SNAPSHOT_LIMITS,
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
  | "malformed";

/** A failed request. Messages never contain the token, headers, or response bodies. */
export interface GitHubFetchError {
  kind: GitHubFetchErrorKind;
  /** What was requested, for example `repos/jordan/linter/readme`. */
  target: string;
  message: string;
}

export type FetchGitHubResult =
  | { ok: true; snapshot: GitHubSnapshot; warnings: string[]; requests: number }
  | { ok: false; errors: GitHubFetchError[]; requests: number };

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
 * Requests are sent one at a time. All or nothing: if any request fails (a missing README is
 * not a failure), no snapshot is returned, so a caller never replaces good data with
 * incomplete data. There are no automatic retries; the next run is the retry.
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

    const pinned = authenticated ? await fetchPinned(client, user.login, warnings, fail) : [];

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

    const selected = selectRepositories({ config, repositories, pinned, authenticated });
    client.checkBudget(selected.length * 2, fail);

    const snapshotRepositories: SnapshotRepository[] = [];
    for (const repository of selected) {
      const path = `repos/${encodePath(repository.full_name)}`;
      const languages = await client.json(`${path}/languages`, languagesResponseSchema, fail);
      const readme = await client.readme(`${path}/readme`, fail);
      if (languages === undefined || readme === undefined) continue;
      snapshotRepositories.push(
        toSnapshotRepository(repository, languages, readme, isPinned(pinned, repository.full_name)),
      );
    }

    if (errors.length > 0) return failed();
    return {
      ok: true,
      snapshot: {
        formatVersion: 1,
        retrievedAt: (options.now ?? (() => new Date()))().toISOString(),
        authenticated,
        user: { login: user.login, htmlUrl: user.html_url },
        repositories: snapshotRepositories,
      },
      warnings,
      requests: client.requests,
    };
  } catch (error) {
    if (error instanceof FetchStopped) return failed();
    throw error;
  }

  function failed(): FetchGitHubResult {
    return { ok: false, errors, requests: client.requests };
  }
}

/** Full names of pinned own public repositories, in pin order (GraphQL, token only). */
async function fetchPinned(
  client: GitHubClient,
  login: string,
  warnings: string[],
  fail: (error: GitHubFetchError) => void,
): Promise<string[]> {
  const query = `query($login: String!) { user(login: $login) { pinnedItems(first: ${SELECTION_LIMITS.pinned}, types: REPOSITORY) { nodes { ... on Repository { nameWithOwner isFork isPrivate } } } } }`;
  const response = await client.graphql(
    { query, variables: { login } },
    pinnedResponseSchema,
    fail,
  );
  if (response === undefined) return [];
  if (response.errors !== undefined && response.errors.length > 0) {
    fail({
      kind: "unauthorized",
      target: "graphql",
      message: "GitHub rejected the pinned repositories query; check GITHUB_TOKEN",
    });
  }

  const owner = `${login.toLowerCase()}/`;
  const pinned: string[] = [];
  for (const node of response.data?.user?.pinnedItems.nodes ?? []) {
    if (node.nameWithOwner === undefined || node.isFork || node.isPrivate) continue;
    if (!node.nameWithOwner.toLowerCase().startsWith(owner)) {
      warnings.push(
        `Skipped pinned repository ${node.nameWithOwner}: owned by someone else (contributions come later)`,
      );
      continue;
    }
    pinned.push(node.nameWithOwner);
  }
  return pinned;
}

function toSnapshotRepository(
  repository: ListedRepository,
  languages: Record<string, number>,
  readme: { text: string | null; truncated: boolean },
  pinned: boolean,
): SnapshotRepository {
  return {
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
