import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { githubConfigFileName, githubSnapshotFileName } from "./github-source";
import { loadAppProfile } from "./profile";

const PROFILE_FILE = "profile.local.json";
const REPO_ID = "github.com/jordan-example/markdown-linter";

const PROFILE = {
  schemaVersion: 1,
  identity: { name: "Jordan Example", headline: "Engineer", summary: "Builds things." },
  projects: [{ id: REPO_ID, name: "Markdown Linter", description: "My link checker." }],
};

const SNAPSHOT = {
  formatVersion: 1,
  retrievedAt: "2026-10-29T06:00:00.000Z",
  authenticated: false,
  user: { login: "jordan-example", htmlUrl: "https://github.com/jordan-example" },
  repositories: [
    {
      name: "markdown-linter",
      fullName: "jordan-example/markdown-linter",
      htmlUrl: "https://github.com/jordan-example/markdown-linter",
      description: "Checks Markdown files for broken links.",
      homepage: null,
      language: "TypeScript",
      languages: { TypeScript: 100 },
      topics: ["markdown"],
      fork: false,
      archived: false,
      createdAt: "2024-02-11T09:00:00Z",
      pushedAt: "2026-09-30T23:30:00Z",
      license: "MIT",
      pinned: false,
      readme: "# Markdown Linter",
      readmeTruncated: false,
    },
  ],
};

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "promptfolio-profile-"));
  vi.stubEnv("PROMPTFOLIO_PROFILE_FILE", PROFILE_FILE);
  await write(PROFILE_FILE, PROFILE);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

async function write(fileName: string, data: unknown) {
  const text = typeof data === "string" ? data : JSON.stringify(data);
  await writeFile(path.join(dir, fileName), text);
}

async function load() {
  return (await loadAppProfile({ dir })).result;
}

describe("GitHub file names", () => {
  it("are derived from the profile file name and ignored by Git for local profiles", () => {
    expect(githubConfigFileName("profile.local.json")).toBe("profile.local.github.json");
    expect(githubSnapshotFileName("profile.local.json")).toBe("profile.local.github-snapshot.json");
    expect(githubConfigFileName("example.profile.json")).toBe("example.profile.github.json");
  });
});

describe("loadAppProfile with a GitHub source", () => {
  it("loads the profile alone when no GitHub configuration exists", async () => {
    const result = await load();
    if (!result.ok) throw new Error("Expected success");
    expect(result.profile.repositories).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("warns, and loads without repositories, before the first fetch", async () => {
    await write(githubConfigFileName(PROFILE_FILE), { formatVersion: 1, user: "jordan-example" });
    const result = await load();
    if (!result.ok) throw new Error("Expected success");
    expect(result.profile.repositories).toEqual([]);
    expect(result.warnings).toEqual([
      {
        path: "(profile.local.github-snapshot.json)",
        message: expect.stringContaining("fetch-github"),
      },
    ]);
  });

  it("adds the repositories, the GitHub source, and keeps the owner's annotation", async () => {
    await write(githubConfigFileName(PROFILE_FILE), { formatVersion: 1, user: "jordan-example" });
    await write(githubSnapshotFileName(PROFILE_FILE), SNAPSHOT);
    const result = await load();
    if (!result.ok) throw new Error(JSON.stringify(result.issues));

    expect(result.profile.repositories.map((repository) => repository.id)).toEqual([REPO_ID]);
    expect(result.profile.repositories[0]?.provenance).toEqual({
      sourceId: "github",
      basis: "source-observed",
      observedAt: "2026-10-29T06:00:00.000Z",
    });
    expect(result.profile.sources.map((source) => source.id)).toEqual(["owner-profile", "github"]);
    expect(result.profile.projects[0]?.id).toBe(REPO_ID);
    expect(result.warnings).toEqual([]);
  });

  it.each([
    ["the configuration is not JSON", "config", "{"],
    ["the configuration is invalid", "config", { formatVersion: 1, user: "-bad-" }],
    ["the snapshot is not JSON", "snapshot", "not json"],
    ["the snapshot fails its schema", "snapshot", { ...SNAPSHOT, formatVersion: 2 }],
    [
      "the snapshot is for another user",
      "snapshot",
      { ...SNAPSHOT, user: { ...SNAPSHOT.user, login: "someone" } },
    ],
  ])("fails the load when %s, without file contents in messages", async (_name, file, data) => {
    await write(githubConfigFileName(PROFILE_FILE), { formatVersion: 1, user: "jordan-example" });
    await write(githubSnapshotFileName(PROFILE_FILE), SNAPSHOT);
    const fileName =
      file === "config" ? githubConfigFileName(PROFILE_FILE) : githubSnapshotFileName(PROFILE_FILE);
    await write(fileName, data);

    const result = await load();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.path).toContain(fileName);
    expect(JSON.stringify(result.issues)).not.toContain("not json");
  });

  it("applies an exclusion without refetching", async () => {
    await write(githubConfigFileName(PROFILE_FILE), {
      formatVersion: 1,
      user: "jordan-example",
      exclude: ["markdown-linter"],
    });
    await write(githubSnapshotFileName(PROFILE_FILE), SNAPSHOT);
    const result = await load();
    if (!result.ok) throw new Error("Expected success");
    expect(result.profile.repositories).toEqual([]);
    // The owner's annotation now points at no repository.
    expect(result.warnings.map((warning) => warning.path)).toEqual(["projects[0].id"]);
  });
});

describe("loadAppProfile file name guard", () => {
  it.each(["../secret.json", "sub/profile.json", "..", "."])("rejects %s", async (fileName) => {
    vi.stubEnv("PROMPTFOLIO_PROFILE_FILE", fileName);
    const result = await load();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.message).toContain("must be a file name inside profile/");
  });
});
