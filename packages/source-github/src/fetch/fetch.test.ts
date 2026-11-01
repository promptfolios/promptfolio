import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import languages from "../fixtures/languages.json";
import oldButPinned from "../fixtures/old-but-pinned.json";
import pinned from "../fixtures/pinned.json";
import repos from "../fixtures/repos.json";
import user from "../fixtures/user.json";
import { type FetchGitHubOptions, type FetchGitHubResult, fetchGitHubSnapshot } from "./fetch.ts";

const README = readFileSync(new URL("../fixtures/readme.md", import.meta.url), "utf8");
const CONFIG = { user: "jordan-example", exclude: [], excludeContributionsTo: [] };
const NO_COMMITS = { json: { total_count: 0, incomplete_results: false, items: [] } };
const TOKEN = "github_pat_fixture_secret";
const BODY_MARKER = "BODY-MARKER-should-never-appear";
const EMAIL = "jordan@private.example";
const NOW = () => new Date("2026-10-29T06:00:00.000Z");
const RATE = {
  "x-ratelimit-remaining": "57",
  "x-ratelimit-reset": "1793253600",
  "x-ratelimit-resource": "core",
};

interface Route {
  status?: number;
  json?: unknown;
  text?: string;
  headers?: Record<string, string>;
  /** Throw instead of answering (a network failure). */
  throws?: Error;
  /** Never answer; wait for the abort signal (a timeout). */
  hang?: boolean;
}

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
}

/** A fake `fetch` that answers from fixtures by path and records every call. */
function fakeFetch(routes: Record<string, Route>) {
  const calls: Call[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const path = url.replace("https://api.github.com/", "").split("?")[0] ?? "";
    calls.push({
      url,
      method: init?.method ?? "GET",
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
    });
    const route = routes[path];
    if (route === undefined) throw new Error(`unexpected request: ${path}`);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      await Promise.resolve();
      if (route.throws) throw route.throws;
      if (route.hang) {
        await new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        });
      }
      const body = route.text ?? JSON.stringify(route.json ?? {});
      return new Response(body, {
        status: route.status ?? 200,
        headers: { ...RATE, ...route.headers },
      });
    } finally {
      inFlight -= 1;
    }
  }) as typeof fetch;
  return { fn, calls, maxInFlight: () => maxInFlight };
}

/** Routes for a successful run without a token. */
function baseRoutes(): Record<string, Route> {
  return {
    "users/jordan-example": { json: user },
    "users/jordan-example/repos": { json: repos },
    "repos/jordan-example/markdown-linter/languages": { json: languages },
    "repos/jordan-example/markdown-linter/readme": { text: README },
    "repos/jordan-example/Dot_Files/languages": { json: {} },
    "repos/jordan-example/Dot_Files/readme": { status: 404, json: { message: "Not Found" } },
    "search/commits": NO_COMMITS,
  };
}

function tokenRoutes(): Record<string, Route> {
  return {
    ...baseRoutes(),
    graphql: {
      json: pinned,
      headers: { "x-ratelimit-resource": "graphql", "x-ratelimit-remaining": "4990" },
    },
    "repos/jordan-example/old-but-pinned": { json: oldButPinned },
    "repos/jordan-example/old-but-pinned/languages": { json: { Rust: 100 } },
    "repos/jordan-example/old-but-pinned/readme": { status: 404 },
  };
}

async function run(routes: Record<string, Route>, options: FetchGitHubOptions = {}) {
  const fake = fakeFetch(routes);
  const result = await fetchGitHubSnapshot(CONFIG, { fetch: fake.fn, now: NOW, ...options });
  return { result, ...fake };
}

function failure(result: FetchGitHubResult) {
  if (result.status !== "failed") throw new Error("Expected the fetch to fail");
  return result;
}

const allMessages: string[] = [];
function expectError(result: FetchGitHubResult, kind: string) {
  const { errors } = failure(result);
  allMessages.push(...errors.map((error) => `${error.target} ${error.message}`));
  expect(errors.map((error) => error.kind)).toContain(kind);
  return errors;
}

describe("fetchGitHubSnapshot without a token", () => {
  it("fetches the user, the repository list, and languages and README per selected repository", async () => {
    const { result, calls } = await run(baseRoutes());
    if (result.status !== "complete") throw new Error(JSON.stringify(result));

    expect(calls.map((call) => call.url)).toEqual([
      "https://api.github.com/users/jordan-example",
      "https://api.github.com/users/jordan-example/repos?type=owner&sort=pushed&direction=desc&per_page=100",
      "https://api.github.com/repos/jordan-example/markdown-linter/languages",
      "https://api.github.com/repos/jordan-example/markdown-linter/readme",
      "https://api.github.com/repos/jordan-example/Dot_Files/languages",
      "https://api.github.com/repos/jordan-example/Dot_Files/readme",
      "https://api.github.com/search/commits?q=author%3Ajordan-example%20-user%3Ajordan-example%20is%3Apublic%20merge%3Afalse&sort=author-date&order=desc&per_page=100&page=1",
    ]);
    expect(result.requests).toBe(7);
    expect(result.snapshot.formatVersion).toBe(2);
    expect(result.snapshot.retrievedAt).toBe("2026-10-29T06:00:00.000Z");
    expect(result.snapshot.authenticated).toBe(false);
    expect(result.snapshot.user).toEqual({
      login: "jordan-example",
      htmlUrl: "https://github.com/jordan-example",
    });
  });

  it("sends the required headers and no Authorization header", async () => {
    const { calls } = await run(baseRoutes());
    for (const call of calls) {
      expect(call.headers["user-agent"]).toBe("promptfolio-source-github");
      expect(call.headers["x-github-api-version"]).toBe("2026-03-10");
      expect(call.headers.authorization).toBeUndefined();
    }
    expect(calls[0]?.headers.accept).toBe("application/vnd.github+json");
    expect(calls[3]?.headers.accept).toBe("application/vnd.github.raw+json");
  });

  it("sends requests one at a time", async () => {
    const { maxInFlight } = await run(baseRoutes());
    expect(maxInFlight()).toBe(1);
  });

  it("skips forks and private repositories and keeps what the snapshot needs", async () => {
    const { result } = await run(baseRoutes());
    if (result.status !== "complete") throw new Error("Expected success");

    expect(result.snapshot.repositories.map((repository) => repository.fullName)).toEqual([
      "jordan-example/markdown-linter",
      "jordan-example/Dot_Files",
    ]);
    expect(result.snapshot.repositories[0]).toEqual({
      retrievedAt: "2026-10-29T06:00:00.000Z",
      name: "markdown-linter",
      fullName: "jordan-example/markdown-linter",
      htmlUrl: "https://github.com/jordan-example/markdown-linter",
      description: "Checks Markdown files for broken links.",
      homepage: "https://jordan-example.github.io/markdown-linter",
      language: "TypeScript",
      languages: { TypeScript: 9200, Shell: 750, Dockerfile: 50 },
      topics: ["markdown", "linter", "Not A Topic"],
      fork: false,
      archived: false,
      createdAt: "2024-02-11T09:00:00Z",
      pushedAt: "2026-09-30T23:30:00Z",
      license: "MIT",
      pinned: false,
      readme: README,
      readmeTruncated: false,
    });
  });

  it("treats a missing README as no README, not as an error", async () => {
    const { result } = await run(baseRoutes());
    if (result.status !== "complete") throw new Error("Expected success");
    expect(result.snapshot.repositories[1]?.readme).toBeNull();
  });

  it("keeps at most 20,000 README characters and marks the cut", async () => {
    const routes = baseRoutes();
    routes["repos/jordan-example/markdown-linter/readme"] = { text: "x".repeat(25_000) };
    const { result } = await run(routes);
    if (result.status !== "complete") throw new Error("Expected success");
    expect(result.snapshot.repositories[0]?.readme).toHaveLength(20_000);
    expect(result.snapshot.repositories[0]?.readmeTruncated).toBe(true);
  });
});

describe("fetchGitHubSnapshot with a token", () => {
  it("asks for pinned repositories with the token and puts them first", async () => {
    const { result, calls } = await run(tokenRoutes(), { token: TOKEN });
    if (result.status !== "complete") throw new Error(JSON.stringify(result));

    expect(calls[1]?.url).toBe("https://api.github.com/graphql");
    expect(calls[1]?.method).toBe("POST");
    for (const call of calls) expect(call.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(result.snapshot.authenticated).toBe(true);
    expect(
      result.snapshot.repositories.map((repository) => [repository.name, repository.pinned]),
    ).toEqual([
      ["old-but-pinned", true],
      ["markdown-linter", true],
      ["Dot_Files", false],
    ]);
    expect(result.warnings).toEqual([expect.stringContaining("some-org/shared-config")]);
  });

  it("skips a pinned item GitHub could not return, and keeps the others", async () => {
    // As GitHub answers when an organization forbids the token: partial data, null node.
    const routes = tokenRoutes();
    const [first, , third] = pinned.data.user.pinnedItems.nodes;
    routes.graphql = {
      json: {
        data: { user: { pinnedItems: { nodes: [first, null, third] } } },
        errors: [
          {
            type: "FORBIDDEN",
            path: ["user", "pinnedItems", "nodes", 1],
            message: `The 'some-org' organization forbids access ${BODY_MARKER}`,
          },
        ],
      },
    };
    const { result } = await run(routes, { token: TOKEN });
    if (result.status !== "complete") throw new Error(JSON.stringify(result));

    expect(result.snapshot.repositories.filter((r) => r.pinned).map((r) => r.name)).toEqual([
      "old-but-pinned",
      "markdown-linter",
    ]);
    expect(result.warnings).toEqual([
      "Skipped pinned item 2: GitHub did not return it (FORBIDDEN)",
    ]);
    expect(result.warnings.join(" ")).not.toContain(BODY_MARKER);
  });

  it("stops when a GraphQL error is not about one pinned item", async () => {
    const routes = tokenRoutes();
    routes.graphql = {
      json: { data: { user: null }, errors: [{ type: "NOT_FOUND", path: ["user"] }] },
    };
    const { result } = await run(routes, { token: TOKEN });
    expectError(result, "unauthorized");
  });

  it("never keeps a private repository, even when the token can see it", async () => {
    const { result } = await run(tokenRoutes(), { token: TOKEN });
    if (result.status !== "complete") throw new Error("Expected success");
    expect(result.snapshot.repositories.map((repository) => repository.name)).not.toContain(
      "secret-notes",
    );
  });
});

const partialMessages: string[] = [];

describe("fetchGitHubSnapshot partial results", () => {
  it.each([
    ["a server error on languages", "languages", { status: 500, text: BODY_MARKER }, "http"],
    ["a malformed languages body", "languages", { text: `<html>${BODY_MARKER}` }, "malformed"],
    ["a README timeout", "readme", { hang: true }, "timeout"],
  ] as const)(
    "is partial after %s and still reads the other repositories",
    async (_name, endpoint, route, kind) => {
      const routes = baseRoutes();
      routes[`repos/jordan-example/markdown-linter/${endpoint}`] = route;
      const { result, calls } = await run(routes, { timeoutMs: 20 });
      if (result.status !== "partial")
        throw new Error(`Expected partial: ${JSON.stringify(result)}`);

      expect(result.snapshot.repositories.map((repository) => repository.name)).toEqual([
        "Dot_Files",
      ]);
      expect(result.selected).toEqual([
        "jordan-example/markdown-linter",
        "jordan-example/Dot_Files",
      ]);
      expect(result.missing).toHaveLength(1);
      expect(result.missing[0]?.fullName).toBe("jordan-example/markdown-linter");
      expect(result.missing[0]?.errors.map((error) => error.kind)).toEqual([kind]);
      expect(calls.map((call) => call.url)).toContainEqual(
        expect.stringContaining("Dot_Files/readme"),
      );
      for (const error of result.missing[0]?.errors ?? []) partialMessages.push(error.message);
    },
  );
});

function commit(name: string, sha: string, overrides: Record<string, unknown> = {}) {
  return {
    sha: sha.repeat(40),
    html_url: `https://github.com/${name}/commit/${sha.repeat(40)}`,
    commit: {
      message: "fix: handle empty input\n\nA longer body that is never kept.",
      author: { name: "Jordan", email: EMAIL, date: "2026-09-30T23:30:00Z" },
    },
    author: { login: "jordan-example" },
    parents: [{ sha: "c".repeat(40) }],
    repository: {
      full_name: name,
      html_url: `https://github.com/${name}`,
      description: "A tool.",
      private: false,
      fork: false,
      owner: { login: name.split("/")[0] },
    },
    ...overrides,
  };
}

function commitsRoute(items: unknown[], incomplete = false): Route {
  return { json: { total_count: items.length, incomplete_results: incomplete, items } };
}

describe("fetchGitHubSnapshot contributions", () => {
  it("keeps commits in other owners' repositories, without author data", async () => {
    const routes = baseRoutes();
    routes["search/commits"] = commitsRoute([commit("other-org/tool", "a")]);
    const { result } = await run(routes);
    if (result.status !== "complete") throw new Error(JSON.stringify(result));

    expect(result.snapshot.contributions).toEqual([
      {
        retrievedAt: "2026-10-29T06:00:00.000Z",
        sha: "a".repeat(40),
        title: "fix: handle empty input",
        htmlUrl: `https://github.com/other-org/tool/commit/${"a".repeat(40)}`,
        repository: "other-org/tool",
        repositoryUrl: "https://github.com/other-org/tool",
        repositoryDescription: "A tool.",
        authoredAt: "2026-09-30T23:30:00Z",
      },
    ]);
    expect(JSON.stringify(result.snapshot)).not.toContain(EMAIL);
    expect(JSON.stringify(result.snapshot)).not.toContain("longer body");
  });

  it("never stores a private repository, even when the query should have excluded it", async () => {
    const routes = baseRoutes();
    const secret = commit("other-org/secret", "a");
    routes["search/commits"] = commitsRoute([
      { ...secret, repository: { ...secret.repository, private: true } },
    ]);
    const { result } = await run(routes, { token: TOKEN });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("compares stars only for a hash in several repositories, and stores none", async () => {
    const routes = baseRoutes();
    routes["search/commits"] = commitsRoute([
      commit("a-mirror/tool", "a"),
      commit("other-org/tool", "a"),
      commit("other-org/alone", "b"),
    ]);
    routes["repos/a-mirror/tool"] = { json: { stargazers_count: 1 } };
    routes["repos/other-org/tool"] = { json: { stargazers_count: 900 } };
    const { result, calls } = await run(routes);
    if (result.status !== "complete") throw new Error(JSON.stringify(result));

    expect(result.snapshot.contributions.map((entry) => entry.repository).sort()).toEqual([
      "other-org/alone",
      "other-org/tool",
    ]);
    expect(calls.filter((call) => call.url.endsWith("/repos/other-org/alone"))).toEqual([]);
    expect(JSON.stringify(result.snapshot)).not.toContain("stargazers");
  });

  it("does not fail when a star lookup fails, and warns", async () => {
    const routes = baseRoutes();
    routes["search/commits"] = commitsRoute([
      commit("a-mirror/tool", "a"),
      commit("other-org/tool", "a"),
    ]);
    routes["repos/a-mirror/tool"] = { status: 403, text: BODY_MARKER };
    routes["repos/other-org/tool"] = { json: { stargazers_count: 9 } };
    const { result } = await run(routes);
    if (result.status !== "complete") throw new Error(JSON.stringify(result));
    expect(result.snapshot.contributions.map((entry) => entry.repository)).toEqual([
      "other-org/tool",
    ]);
    expect(result.warnings).toEqual([expect.stringContaining("a-mirror/tool")]);
  });

  it("reads further pages only while they are full, at most 3", async () => {
    const page = Array.from({ length: 100 }, (_, index) =>
      commit("other-org/tool", index.toString(16).padStart(40, "0").slice(-1)),
    ).map((item, index) => ({ ...item, sha: index.toString(16).padStart(40, "0") }));
    const routes = baseRoutes();
    routes["search/commits"] = commitsRoute(page);
    const { calls } = await run(routes);
    expect(calls.filter((call) => call.url.includes("search/commits"))).toHaveLength(3);
  });

  it.each([
    ["a server error", { status: 500, text: BODY_MARKER }, "http"],
    ["a validation error", { status: 422, text: BODY_MARKER }, "http"],
    [
      "a rate limit",
      { status: 403, text: BODY_MARKER, headers: { "x-ratelimit-remaining": "0" } },
      "rate-limited",
    ],
    ["a body that is not JSON", { text: `<html>${BODY_MARKER}` }, "malformed"],
    [
      "items that are not an array",
      { json: { incomplete_results: false, items: "x" } },
      "malformed",
    ],
    ["incomplete results", commitsRoute([commit("other-org/tool", "a")], true), "incomplete"],
    ["a network error", { throws: new TypeError("fetch failed") }, "network"],
    ["a timeout", { hang: true }, "timeout"],
  ] as const)(
    "is partial after %s, with the repositories still read",
    async (_name, route, kind) => {
      const routes = baseRoutes();
      routes["search/commits"] = route as Route;
      const { result } = await run(routes, { timeoutMs: 20 });
      if (result.status !== "partial") throw new Error(JSON.stringify(result));

      expect(result.snapshot.repositories).toHaveLength(2);
      expect(result.snapshot.contributions).toEqual([]);
      expect(result.missing).toEqual([]);
      expect(result.contributionErrors.map((error) => error.kind)).toEqual([kind]);
      for (const error of result.contributionErrors) partialMessages.push(error.message);
    },
  );

  it("warns about a pinned repository of another owner with no commits found", async () => {
    const { result } = await run(tokenRoutes(), { token: TOKEN });
    if (result.status !== "complete") throw new Error(JSON.stringify(result));
    expect(result.warnings).toEqual([expect.stringContaining("some-org/shared-config")]);
  });

  it("does not warn about, and ranks first, a pinned repository with commits", async () => {
    const routes = tokenRoutes();
    routes["search/commits"] = commitsRoute([
      {
        ...commit("other-org/tool", "b"),
        commit: { message: "newer", author: { date: "2026-10-01T00:00:00Z" } },
      },
      commit("some-org/shared-config", "a"),
    ]);
    const { result } = await run(routes, { token: TOKEN });
    if (result.status !== "complete") throw new Error(JSON.stringify(result));
    expect(result.snapshot.contributions.map((entry) => entry.repository)).toEqual([
      "some-org/shared-config",
      "other-org/tool",
    ]);
    expect(result.warnings).toEqual([]);
  });
});

describe("fetchGitHubSnapshot failures", () => {
  it("stops when the account does not exist", async () => {
    const routes = baseRoutes();
    routes["users/jordan-example"] = { status: 404, text: BODY_MARKER };
    const { result } = await run(routes);
    expectError(result, "not-found");
    expect(result.requests).toBe(1);
  });

  it("stops when the account is not a user", async () => {
    const routes = baseRoutes();
    routes["users/jordan-example"] = { json: { ...user, type: "Organization" } };
    const { result } = await run(routes);
    expectError(result, "not-a-user");
  });

  it("stops before per-repository requests that the rate limit cannot cover", async () => {
    const routes = baseRoutes();
    routes["users/jordan-example/repos"] = {
      json: repos,
      headers: { "x-ratelimit-remaining": "3" },
    };
    const { result, calls } = await run(routes);
    const [error] = expectError(result, "budget");
    expect(error?.message).toContain("4 more requests");
    expect(error?.message).toContain("2026-10-29");
    expect(calls).toHaveLength(2);
  });

  it.each([403, 429])(
    "stops at the primary rate limit (%i) and reports the reset time",
    async (status) => {
      const routes = baseRoutes();
      routes["users/jordan-example/repos"] = {
        status,
        text: BODY_MARKER,
        headers: { "x-ratelimit-remaining": "0" },
      };
      const { result, calls } = await run(routes);
      const [error] = expectError(result, "rate-limited");
      expect(error?.message).toContain("resets at");
      expect(calls).toHaveLength(2);
    },
  );

  it("stops at a secondary rate limit and reports the wait", async () => {
    const routes = baseRoutes();
    routes["repos/jordan-example/markdown-linter/languages"] = {
      status: 403,
      text: BODY_MARKER,
      headers: { "retry-after": "60" },
    };
    const { result, calls } = await run(routes);
    const [error] = expectError(result, "rate-limited");
    expect(error?.message).toContain("60 seconds");
    expect(calls).toHaveLength(3);
  });

  it("stops when the token is rejected, without printing it", async () => {
    const routes = tokenRoutes();
    routes["users/jordan-example"] = { status: 401, text: BODY_MARKER };
    const { result } = await run(routes, { token: TOKEN });
    const [error] = expectError(result, "unauthorized");
    // The token is an option here: only the application knows where it came from.
    expect(error?.message).toContain("token");
    expect(error?.message).not.toContain("GITHUB_TOKEN");
  });

  it("stops when the pinned query returns GraphQL errors", async () => {
    const routes = tokenRoutes();
    routes.graphql = { json: { errors: [{ message: BODY_MARKER }] } };
    const { result, calls } = await run(routes, { token: TOKEN });
    const [error] = expectError(result, "unauthorized");
    expect(error?.message).not.toContain("GITHUB_TOKEN");
    expect(calls).toHaveLength(2);
  });

  it("fails when the repository list cannot be read, before any per-repository request", async () => {
    const routes = baseRoutes();
    routes["users/jordan-example/repos"] = { status: 500, text: BODY_MARKER };
    const { result, calls } = await run(routes);
    expectError(result, "http");
    expect(calls).toHaveLength(2);
  });

  it("reports a network error", async () => {
    const routes = baseRoutes();
    routes["users/jordan-example/repos"] = { throws: new TypeError("fetch failed") };
    const { result } = await run(routes);
    expectError(result, "network");
  });

  it("reports a timeout", async () => {
    const routes = baseRoutes();
    routes["users/jordan-example/repos"] = { hang: true };
    const { result } = await run(routes, { timeoutMs: 20 });
    expectError(result, "timeout");
  });

  it.each([
    ["a body that is not JSON", { text: `<html>${BODY_MARKER}</html>` }],
    ["a body over 1 MB", { text: JSON.stringify([{ pad: "x".repeat(1_000_001) }]) }],
    ["topics that are not an array", { json: [{ ...repos[0], topics: "markdown" }] }],
    ["a missing html_url", { json: [{ ...repos[0], html_url: undefined }] }],
  ])("rejects %s", async (_name, route) => {
    const routes = baseRoutes();
    routes["users/jordan-example/repos"] = route;
    const { result } = await run(routes);
    expectError(result, "malformed");
  });

  it("never puts the token or a response body into a message", () => {
    allMessages.push(...partialMessages);
    expect(allMessages.length).toBeGreaterThan(10);
    for (const message of allMessages) {
      expect(message).not.toContain(TOKEN);
      expect(message).not.toContain(BODY_MARKER);
    }
  });
});
