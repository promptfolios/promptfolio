import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type FetchGitHubOptions, type FetchGitHubResult, fetchGitHubSnapshot } from "./fetch";
import languages from "./fixtures/languages.json";
import oldButPinned from "./fixtures/old-but-pinned.json";
import pinned from "./fixtures/pinned.json";
import repos from "./fixtures/repos.json";
import user from "./fixtures/user.json";

const README = readFileSync(new URL("./fixtures/readme.md", import.meta.url), "utf8");
const CONFIG = { user: "jordan-example", exclude: [] };
const TOKEN = "github_pat_fixture_secret";
const BODY_MARKER = "BODY-MARKER-should-never-appear";
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
  if (result.ok) throw new Error("Expected the fetch to fail");
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
    if (!result.ok) throw new Error(JSON.stringify(result.errors));

    expect(calls.map((call) => call.url)).toEqual([
      "https://api.github.com/users/jordan-example",
      "https://api.github.com/users/jordan-example/repos?type=owner&sort=pushed&direction=desc&per_page=100",
      "https://api.github.com/repos/jordan-example/markdown-linter/languages",
      "https://api.github.com/repos/jordan-example/markdown-linter/readme",
      "https://api.github.com/repos/jordan-example/Dot_Files/languages",
      "https://api.github.com/repos/jordan-example/Dot_Files/readme",
    ]);
    expect(result.requests).toBe(6);
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
    if (!result.ok) throw new Error("Expected success");

    expect(result.snapshot.repositories.map((repository) => repository.fullName)).toEqual([
      "jordan-example/markdown-linter",
      "jordan-example/Dot_Files",
    ]);
    expect(result.snapshot.repositories[0]).toEqual({
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
    if (!result.ok) throw new Error("Expected success");
    expect(result.snapshot.repositories[1]?.readme).toBeNull();
  });

  it("keeps at most 20,000 README characters and marks the cut", async () => {
    const routes = baseRoutes();
    routes["repos/jordan-example/markdown-linter/readme"] = { text: "x".repeat(25_000) };
    const { result } = await run(routes);
    if (!result.ok) throw new Error("Expected success");
    expect(result.snapshot.repositories[0]?.readme).toHaveLength(20_000);
    expect(result.snapshot.repositories[0]?.readmeTruncated).toBe(true);
  });
});

describe("fetchGitHubSnapshot with a token", () => {
  it("asks for pinned repositories with the token and puts them first", async () => {
    const { result, calls } = await run(tokenRoutes(), { token: TOKEN });
    if (!result.ok) throw new Error(JSON.stringify(result.errors));

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

  it("never keeps a private repository, even when the token can see it", async () => {
    const { result } = await run(tokenRoutes(), { token: TOKEN });
    if (!result.ok) throw new Error("Expected success");
    expect(result.snapshot.repositories.map((repository) => repository.name)).not.toContain(
      "secret-notes",
    );
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
    expectError(result, "unauthorized");
  });

  it("stops when the pinned query returns GraphQL errors", async () => {
    const routes = tokenRoutes();
    routes.graphql = { json: { errors: [{ message: BODY_MARKER }] } };
    const { result, calls } = await run(routes, { token: TOKEN });
    expectError(result, "unauthorized");
    expect(calls).toHaveLength(2);
  });

  it("fails on a server error but still reports the other repositories", async () => {
    const routes = baseRoutes();
    routes["repos/jordan-example/markdown-linter/languages"] = { status: 500, text: BODY_MARKER };
    const { result, calls } = await run(routes);
    const errors = expectError(result, "http");
    expect(errors).toHaveLength(1);
    expect(calls.map((call) => call.url).at(-1)).toContain("Dot_Files/readme");
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
    expect(allMessages.length).toBeGreaterThan(10);
    for (const message of allMessages) {
      expect(message).not.toContain(TOKEN);
      expect(message).not.toContain(BODY_MARKER);
    }
  });
});
