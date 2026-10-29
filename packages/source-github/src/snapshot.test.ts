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

describe("parseGitHubSnapshot", () => {
  it("accepts a snapshot written by the fetcher", () => {
    expect(parseGitHubSnapshot(validSnapshot()).ok).toBe(true);
  });

  it.each([
    [
      "a wrong format version",
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
