import { execFileSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { profileFingerprint } from "@promptfolio/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { githubConfigFileName, githubSnapshotFileName } from "../profile/github-source";
import { loadAppProfile } from "../profile/profile";
import { runRefresh } from "./refresh";
import { refreshStatusFileName, refreshStatusWarnings } from "./refresh-status";

const PROFILE_FILE = "profile.local.json";
const TOKEN = "github_pat_fixture_secret";
const BODY_MARKER = "BODY-MARKER-should-never-appear";
const T1 = "2026-10-29T06:00:00.000Z";
const T2 = "2026-10-30T06:00:00.000Z";
const LINTER = "github.com/jordan-example/markdown-linter";

const PROFILE = {
  schemaVersion: 1,
  identity: { name: "Jordan Example", headline: "Engineer", summary: "Builds things." },
};

function listed(name: string, description: string) {
  return {
    name,
    full_name: `jordan-example/${name}`,
    html_url: `https://github.com/jordan-example/${name}`,
    description,
    homepage: null,
    language: "TypeScript",
    topics: [],
    fork: false,
    archived: false,
    private: false,
    visibility: "public",
    created_at: "2024-02-11T09:00:00Z",
    pushed_at: "2026-09-30T23:30:00Z",
    license: null,
  };
}

const COMMIT = {
  sha: "a".repeat(40),
  html_url: `https://github.com/other-org/shared-tool/commit/${"a".repeat(40)}`,
  commit: {
    message: "fix: handle empty input",
    author: { name: "Jordan", email: "jordan@private.example", date: "2026-09-30T23:30:00Z" },
  },
  author: { login: "jordan-example" },
  parents: [{}],
  repository: {
    full_name: "other-org/shared-tool",
    html_url: "https://github.com/other-org/shared-tool",
    description: "A shared tool.",
    private: false,
    fork: false,
    owner: { login: "other-org" },
  },
};
const CONTRIBUTION_ID = `github.com/other-org/shared-tool/commit/${"a".repeat(40)}`;

interface Route {
  status?: number;
  json?: unknown;
  text?: string;
  hang?: boolean;
}

/** Routes for a run that reads two repositories; `change` edits them per test. */
function routes(toolDescription = "A tool.", change: Record<string, Route> = {}) {
  return {
    "users/jordan-example": {
      json: {
        login: "jordan-example",
        html_url: "https://github.com/jordan-example",
        type: "User",
      },
    },
    "users/jordan-example/repos": {
      json: [listed("markdown-linter", "Checks links."), listed("tool", toolDescription)],
    },
    "repos/jordan-example/markdown-linter/languages": { json: { TypeScript: 100 } },
    "repos/jordan-example/markdown-linter/readme": { text: "# Markdown Linter" },
    "repos/jordan-example/tool/languages": { json: { Go: 100 } },
    "repos/jordan-example/tool/readme": { status: 404 },
    graphql: { json: { data: { user: { pinnedItems: { nodes: [] } } } } },
    "search/commits": { json: { incomplete_results: false, items: [COMMIT] } },
    ...change,
  } satisfies Record<string, Route>;
}

function fakeFetch(table: Record<string, Route>): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const key = String(input).replace("https://api.github.com/", "").split("?")[0] ?? "";
    const route = table[key];
    if (route === undefined) throw new Error(`unexpected request: ${key}`);
    if (route.hang) {
      await new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
    }
    return new Response(route.text ?? JSON.stringify(route.json ?? {}), {
      status: route.status ?? 200,
      headers: { "x-ratelimit-remaining": "50", "x-ratelimit-reset": "1793253600" },
    });
  }) as typeof fetch;
}

let dir: string;
let output: string[];
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "promptfolio-refresh-"));
  vi.stubEnv("PROMPTFOLIO_PROFILE_FILE", PROFILE_FILE);
  output = [];
  await write(PROFILE_FILE, PROFILE);
  await write(githubConfigFileName(PROFILE_FILE), { formatVersion: 1, user: "jordan-example" });
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

async function write(fileName: string, data: unknown) {
  await writeFile(path.join(dir, fileName), typeof data === "string" ? data : JSON.stringify(data));
}

async function read(fileName: string): Promise<string> {
  return readFile(path.join(dir, fileName), "utf8");
}

function refresh(table: Record<string, Route>, at: string, token?: string) {
  const record = (...parts: unknown[]) => {
    output.push(
      parts.map((part) => (typeof part === "string" ? part : JSON.stringify(part))).join(" "),
    );
  };
  return runRefresh({
    dir,
    token,
    fetch: fakeFetch(table),
    now: () => new Date(at),
    timeoutMs: 20,
    logger: { log: record, warn: record, error: record },
  });
}

const SNAPSHOT = githubSnapshotFileName(PROFILE_FILE);
const STATUS = refreshStatusFileName(PROFILE_FILE);

describe("runRefresh", () => {
  it("writes the snapshot and a success status on the first run", async () => {
    const result = await refresh(routes(), T1);

    expect(result.exitCode).toBe(0);
    expect(result.outcome).toBe("success");
    const snapshot = JSON.parse(await read(SNAPSHOT));
    expect(snapshot.formatVersion).toBe(2);
    expect(snapshot.repositories.map((entry: { name: string }) => entry.name)).toEqual([
      "markdown-linter",
      "tool",
    ]);
    const status = JSON.parse(await read(STATUS));
    expect(status.sources.github).toMatchObject({
      lastAttemptAt: T1,
      outcome: "success",
      lastSuccessAt: T1,
      snapshotWritten: true,
      versionChanged: true,
      carriedOver: [],
      errors: [],
    });
    const loaded = await loadAppProfile({ dir });
    if (!loaded.result.ok) throw new Error("Expected the profile to load");
    expect(status.profileVersion).toBe(await profileFingerprint(loaded.result.profile));
  });

  it("leaves the snapshot byte-for-byte unchanged when nothing changed", async () => {
    await refresh(routes(), T1);
    const before = await read(SNAPSHOT);

    const result = await refresh(routes(), T2);

    expect(result.exitCode).toBe(0);
    expect(await read(SNAPSHOT)).toBe(before);
    expect(JSON.parse(await read(STATUS)).sources.github).toMatchObject({
      lastAttemptAt: T2,
      outcome: "success",
      lastSuccessAt: T2,
      snapshotWritten: false,
      versionChanged: false,
    });
    expect(output.join("\n")).toContain("Profile version unchanged");
    // No temporary files are left behind.
    expect((await readdir(dir)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("keeps the earlier data of a repository it could not read (partial, exit 2)", async () => {
    await refresh(routes(), T1);

    const result = await refresh(
      routes("A changed tool.", { "repos/jordan-example/markdown-linter/readme": { hang: true } }),
      T2,
    );

    expect(result.exitCode).toBe(2);
    expect(result.outcome).toBe("partial");
    const snapshot = JSON.parse(await read(SNAPSHOT));
    expect(
      snapshot.repositories.map((entry: { name: string; retrievedAt: string }) => [
        entry.name,
        entry.retrievedAt,
      ]),
    ).toEqual([
      ["markdown-linter", T1],
      ["tool", T2],
    ]);
    expect(JSON.parse(await read(STATUS)).sources.github).toMatchObject({
      outcome: "partial",
      lastSuccessAt: T1,
      snapshotWritten: true,
      versionChanged: true,
      carriedOver: [{ repository: "jordan-example/markdown-linter", retrievedAt: T1 }],
      errors: [{ kind: "timeout", target: "repos/jordan-example/markdown-linter/readme" }],
    });

    const loaded = await loadAppProfile({ dir });
    if (!loaded.result.ok) throw new Error("Expected the profile to load");
    const linter = loaded.result.profile.repositories.find((entry) => entry.id === LINTER);
    expect(linter?.provenance.observedAt).toBe(T1);
    expect(loaded.result.warnings).toEqual([
      { path: `(${STATUS})`, message: expect.stringContaining("was partial") },
    ]);
  });

  it("writes nothing but the status when the refresh fails (exit 1)", async () => {
    await refresh(routes(), T1);
    const before = await read(SNAPSHOT);

    const result = await refresh(
      routes("A changed tool.", { "users/jordan-example": { status: 404, text: BODY_MARKER } }),
      T2,
    );

    expect(result.exitCode).toBe(1);
    expect(await read(SNAPSHOT)).toBe(before);
    expect(JSON.parse(await read(STATUS)).sources.github).toMatchObject({
      lastAttemptAt: T2,
      outcome: "failed",
      lastSuccessAt: T1,
      snapshotWritten: false,
      errors: [{ kind: "not-found" }],
    });
    const loaded = await loadAppProfile({ dir });
    if (!loaded.result.ok) throw new Error("Expected the previous data to load");
    expect(loaded.result.profile.repositories).toHaveLength(2);
    expect(loaded.result.warnings[0]?.message).toContain("failed");
  });

  it("fails a partial first run: no earlier data to keep", async () => {
    const result = await refresh(
      routes("A tool.", { "repos/jordan-example/tool/languages": { status: 500 } }),
      T1,
    );
    expect(result.exitCode).toBe(1);
    await expect(read(SNAPSHOT)).rejects.toThrow();
    expect(JSON.parse(await read(STATUS)).sources.github.outcome).toBe("failed");
  });

  it("writes nothing when the data does not fit the profile", async () => {
    await write(PROFILE_FILE, {
      ...PROFILE,
      experience: [{ id: LINTER, organization: "Acme", title: "Engineer", start: "2021-03" }],
    });
    const result = await refresh(routes(), T1);
    expect(result.exitCode).toBe(1);
    await expect(read(SNAPSHOT)).rejects.toThrow();
    expect(JSON.parse(await read(STATUS)).sources.github.errors[0].kind).toBe("invalid-data");
  });

  it("stops without a status when there is no GitHub configuration", async () => {
    await rm(path.join(dir, githubConfigFileName(PROFILE_FILE)));
    const result = await refresh(routes(), T1);
    expect(result).toEqual({ outcome: "failed", exitCode: 1 });
    await expect(read(STATUS)).rejects.toThrow();
  });

  it("never writes or logs the token or a response body", async () => {
    await refresh(routes(), T1, TOKEN);
    await refresh(
      routes("A changed tool.", {
        "repos/jordan-example/markdown-linter/languages": { status: 500, text: BODY_MARKER },
      }),
      T2,
      TOKEN,
    );
    await refresh(
      routes("x", { "users/jordan-example": { status: 401, text: BODY_MARKER } }),
      T2,
      TOKEN,
    );

    const everything = [output.join("\n"), await read(SNAPSHOT), await read(STATUS)].join("\n");
    expect(everything).not.toContain(TOKEN);
    expect(everything).not.toContain(BODY_MARKER);
  });
});

describe("runRefresh with contributions", () => {
  it("writes contributions, loads them, and keeps a rerun byte-identical", async () => {
    await refresh(routes(), T1);
    const before = await read(SNAPSHOT);
    const loaded = await loadAppProfile({ dir });
    if (!loaded.result.ok) throw new Error("Expected the profile to load");
    expect(loaded.result.profile.contributions.map((entry) => entry.id)).toEqual([CONTRIBUTION_ID]);
    expect(before).not.toContain("jordan@private.example");

    await refresh(routes(), T2);
    expect(await read(SNAPSHOT)).toBe(before);
  });

  it("keeps earlier contributions and updates repositories when the search fails", async () => {
    await refresh(routes(), T1);

    const result = await refresh(
      routes("A changed tool.", { "search/commits": { status: 500, text: BODY_MARKER } }),
      T2,
    );

    expect(result.exitCode).toBe(2);
    expect(JSON.parse(await read(STATUS)).sources.github).toMatchObject({
      outcome: "partial",
      contributionsKept: true,
      snapshotWritten: true,
      errors: [{ kind: "http", target: "search/commits" }],
    });
    const loaded = await loadAppProfile({ dir });
    if (!loaded.result.ok) throw new Error("Expected the profile to load");
    expect(loaded.result.profile.contributions[0]?.provenance.observedAt).toBe(T1);
    expect(
      loaded.result.profile.repositories.find((entry) => entry.name === "tool")?.description,
    ).toBe("A changed tool.");
    expect(loaded.result.warnings[0]?.message).toContain("kept earlier contributions");
  });

  it("fails a first run when the search fails: nothing to keep", async () => {
    const result = await refresh(routes("A tool.", { "search/commits": { status: 500 } }), T1);
    expect(result.exitCode).toBe(1);
    await expect(read(SNAPSHOT)).rejects.toThrow();
  });

  it("reads a status file written before contributions existed", async () => {
    await refresh(routes(), T1);
    const status = JSON.parse(await read(STATUS));
    delete status.sources.github.contributionsKept;
    await write(STATUS, status);
    expect(await refreshStatusWarnings(PROFILE_FILE, dir)).toEqual([]);
  });
});

describe("refreshStatusWarnings", () => {
  it("gives none without a status file and one for an invalid file", async () => {
    expect(await refreshStatusWarnings(PROFILE_FILE, dir)).toEqual([]);
    await write(STATUS, "{ not json");
    expect(await refreshStatusWarnings(PROFILE_FILE, dir)).toEqual([
      { path: `(${STATUS})`, message: expect.stringContaining("invalid") },
    ]);
  });

  it("does not stop the profile from loading when the status is invalid", async () => {
    await write(STATUS, { formatVersion: 99 });
    const loaded = await loadAppProfile({ dir });
    expect(loaded.result.ok).toBe(true);
  });

  it("is ignored by Git for local profiles", () => {
    const ignored = execFileSync(
      "git",
      ["check-ignore", "--no-index", `apps/portfolio/profile/${STATUS}`],
      {
        cwd: path.resolve(__dirname, "../../../.."),
        encoding: "utf8",
      },
    );
    expect(ignored.trim()).toBe(`apps/portfolio/profile/${STATUS}`);
  });
});
