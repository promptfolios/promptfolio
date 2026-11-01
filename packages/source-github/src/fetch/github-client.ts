import type { z } from "zod";
import { SNAPSHOT_LIMITS } from "../snapshot/snapshot";

const FETCH_DEFAULTS = {
  apiBaseUrl: "https://api.github.com",
  apiVersion: "2026-03-10",
  userAgent: "promptfolio-source-github",
  timeoutMs: 10_000,
  /** JSON responses above this size are rejected. */
  maxResponseChars: 1_000_000,
} as const;

export interface GitHubClientOptions {
  /** A GitHub token. Optional: without one, pinned repositories are skipped and fewer are kept. */
  token?: string;
  /** Injected for tests; defaults to the global `fetch`. */
  fetch?: typeof fetch;
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

export type OnFetchError = (error: GitHubFetchError) => void;

type GitHubResponse = { status: number; headers: Headers; text: string };

/** `owner/name` with each segment encoded. */
export function encodePath(fullName: string): string {
  return fullName.split("/").map(encodeURIComponent).join("/");
}

/** Sends requests one at a time and turns every failure into a typed error. */
export class GitHubClient {
  requests = 0;
  private remaining: number | undefined;
  private reset: number | undefined;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: GitHubClientOptions) {
    this.fetchFn = options.fetch ?? globalThis.fetch;
  }

  async json<T>(path: string, schema: z.ZodType<T>, fail: OnFetchError): Promise<T | undefined> {
    const response = await this.send(path, { accept: "application/vnd.github+json" }, fail);
    return response === undefined ? undefined : this.parse(path, response, schema, fail);
  }

  async graphql<T>(body: object, schema: z.ZodType<T>, fail: OnFetchError): Promise<T | undefined> {
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
    fail: OnFetchError,
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
  checkBudget(needed: number, fail: OnFetchError): void {
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
    fail: OnFetchError,
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
    fail: OnFetchError,
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
        message: "GitHub rejected the token; check that it is valid and has not expired",
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
