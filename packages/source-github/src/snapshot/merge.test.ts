import { loadStructuredProfile, type Profile } from "@promptfolio/core";
import { describe, expect, it } from "vitest";
import { mergeGitHubSnapshot } from "./merge.ts";

const CONFIG = { user: "jordan-example", exclude: [], excludeContributionsTo: [] };
const REPOSITORY_ID = "github.com/jordan-example/markdown-linter";

function owner(): Profile {
  const loaded = loadStructuredProfile(
    {
      schemaVersion: 1,
      identity: { name: "Jordan Example", headline: "Engineer", summary: "Builds things." },
    },
    { sourceId: "owner-profile", label: "Test profile", observedAt: new Date("2026-10-01") },
  );
  if (!loaded.ok) throw new Error("test profile is invalid");
  return loaded.profile;
}

const SNAPSHOT = {
  formatVersion: 2,
  retrievedAt: "2026-10-29T06:00:00.000Z",
  authenticated: false,
  user: { login: "jordan-example", htmlUrl: "https://github.com/jordan-example" },
  contributions: [],
  repositories: [
    {
      retrievedAt: "2026-10-29T06:00:00.000Z",
      name: "markdown-linter",
      fullName: "jordan-example/markdown-linter",
      htmlUrl: "https://github.com/jordan-example/markdown-linter",
      description: "Checks Markdown files for broken links.",
      homepage: null,
      language: "TypeScript",
      languages: { TypeScript: 100 },
      topics: [],
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

describe("mergeGitHubSnapshot", () => {
  it("adds the snapshot's repositories to the profile", () => {
    const merged = mergeGitHubSnapshot(owner(), CONFIG, SNAPSHOT);

    if (!merged.ok) throw new Error(JSON.stringify(merged.issues));
    expect(merged.profile.repositories.map((repository) => repository.id)).toEqual([REPOSITORY_ID]);
    expect(merged.profile.identity.name).toBe("Jordan Example");
  });

  it("rejects an invalid snapshot, with paths relative to it and no file name", () => {
    const merged = mergeGitHubSnapshot(owner(), CONFIG, { ...SNAPSHOT, repositories: "none" });

    if (merged.ok) throw new Error("expected a failure");
    expect(merged.issues[0]?.path).toBe("repositories");
  });

  it("names the snapshot on its own issues when asked", () => {
    const merged = mergeGitHubSnapshot(
      owner(),
      CONFIG,
      { ...SNAPSHOT, repositories: "none" },
      "test.github-snapshot.json",
    );

    if (merged.ok) throw new Error("expected a failure");
    expect(merged.issues[0]?.path).toBe("test.github-snapshot.json: repositories");
  });

  it("rejects a snapshot of another account", () => {
    const merged = mergeGitHubSnapshot(owner(), { ...CONFIG, user: "someone-else" }, SNAPSHOT);

    expect(merged.ok).toBe(false);
  });
});
