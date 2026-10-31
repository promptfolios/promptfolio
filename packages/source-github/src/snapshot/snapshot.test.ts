import { describe, expect, it } from "vitest";
import { parseGitHubSnapshot } from "./snapshot";

function validSnapshot() {
  return {
    formatVersion: 1,
    retrievedAt: "2026-10-29T06:00:00.000Z",
    authenticated: false,
    user: { login: "jordan-example", htmlUrl: "https://github.com/jordan-example" },
    repositories: [
      {
        name: "markdown-linter",
        fullName: "jordan-example/markdown-linter",
        htmlUrl: "https://github.com/jordan-example/markdown-linter",
        description: null,
        homepage: null,
        language: "TypeScript",
        languages: { TypeScript: 100 },
        topics: [],
        fork: false,
        archived: false,
        createdAt: "2024-02-11T09:00:00Z",
        pushedAt: null,
        license: null,
        pinned: false,
        readme: null,
        readmeTruncated: false,
      },
    ],
  };
}

/** Version 2 (M9): a `retrievedAt` per repository. */
function validSnapshotV2(repositoryRetrievedAt = "2026-10-20T06:00:00.000Z") {
  const v1 = validSnapshot();
  return {
    ...v1,
    formatVersion: 2,
    repositories: v1.repositories.map((r) => ({ retrievedAt: repositoryRetrievedAt, ...r })),
  };
}

describe("parseGitHubSnapshot", () => {
  it("accepts a version 2 snapshot with a time per repository", () => {
    const result = parseGitHubSnapshot(validSnapshotV2());
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.snapshot.repositories[0]?.retrievedAt).toBe("2026-10-20T06:00:00.000Z");
  });

  it("upgrades a version 1 snapshot: each repository takes the file's time", () => {
    const result = parseGitHubSnapshot(validSnapshot());
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.snapshot.formatVersion).toBe(2);
    expect(result.snapshot.repositories[0]?.retrievedAt).toBe("2026-10-29T06:00:00.000Z");
  });

  it("reads a snapshot without contributions as none, in both versions", () => {
    for (const data of [validSnapshot(), validSnapshotV2()]) {
      const result = parseGitHubSnapshot(data);
      expect(result.ok && result.snapshot.contributions).toEqual([]);
    }
  });

  it("accepts contributions, and rejects one read after the snapshot was written", () => {
    const contribution = {
      retrievedAt: "2026-10-20T06:00:00.000Z",
      sha: "a".repeat(40),
      title: "fix: handle empty input",
      htmlUrl: "https://github.com/other-org/tool/commit/abc",
      repository: "other-org/tool",
      repositoryUrl: "https://github.com/other-org/tool",
      repositoryDescription: null,
      authoredAt: "2026-09-30T23:30:00Z",
    };
    const data = { ...validSnapshotV2(), contributions: [contribution] };
    expect(parseGitHubSnapshot(data).ok).toBe(true);

    const late = { ...contribution, retrievedAt: "2026-10-30T06:00:00.000Z" };
    const result = parseGitHubSnapshot({ ...validSnapshotV2(), contributions: [late] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.path).toBe("contributions[0].retrievedAt");
  });

  it("rejects a repository read after the snapshot was written", () => {
    const result = parseGitHubSnapshot(validSnapshotV2("2026-10-30T06:00:00.000Z"));
    if (result.ok) throw new Error("Expected issues");
    expect(result.issues[0]?.path).toBe("repositories[0].retrievedAt");
  });

  it.each([
    [
      "an unknown format version",
      (s: ReturnType<typeof validSnapshot>) => ({ ...s, formatVersion: 3 }),
    ],
    [
      "version 2 without a time per repository",
      (s: ReturnType<typeof validSnapshot>) => ({ ...s, formatVersion: 2 }),
    ],
    ["an unknown key", (s: ReturnType<typeof validSnapshot>) => ({ ...s, extra: true })],
    [
      "an invalid time",
      (s: ReturnType<typeof validSnapshot>) => ({ ...s, retrievedAt: "yesterday" }),
    ],
    [
      "a non-https URL",
      (s: ReturnType<typeof validSnapshot>) => ({
        ...s,
        user: { ...s.user, htmlUrl: "http://github.com/jordan-example" },
      }),
    ],
    [
      "a README over 20,000 characters",
      (s: ReturnType<typeof validSnapshot>) => ({
        ...s,
        repositories: s.repositories.map((r) => ({ ...r, readme: "x".repeat(20_001) })),
      }),
    ],
    ["not an object", () => "[]"],
  ])("rejects %s with issues, without throwing", (_name, change) => {
    const result = parseGitHubSnapshot(change(validSnapshot()));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.length).toBeGreaterThan(0);
  });
});
