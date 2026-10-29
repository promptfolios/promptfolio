import { describe, expect, it } from "vitest";
import { parseGitHubConfig } from "./config";

describe("parseGitHubConfig", () => {
  it("accepts a username alone and defaults the exclusions", () => {
    expect(parseGitHubConfig({ formatVersion: 1, user: "Jordan-Example" })).toEqual({
      ok: true,
      config: { user: "Jordan-Example", exclude: [] },
    });
  });

  it("accepts exclusions", () => {
    const result = parseGitHubConfig({ formatVersion: 1, user: "jordan", exclude: ["old.repo_1"] });
    expect(result.ok && result.config.exclude).toEqual(["old.repo_1"]);
  });

  it.each([
    ["a wrong format version", { formatVersion: 2, user: "jordan" }, "formatVersion"],
    ["an unknown key", { formatVersion: 1, user: "jordan", repos: [] }, "(root)"],
    ["a missing user", { formatVersion: 1 }, "user"],
    ["an invalid user", { formatVersion: 1, user: "-jordan" }, "user"],
    ["a user over 39 characters", { formatVersion: 1, user: "a".repeat(40) }, "user"],
    ["an invalid exclusion", { formatVersion: 1, user: "jordan", exclude: ["a/b"] }, "exclude[0]"],
    [
      "more than 50 exclusions",
      { formatVersion: 1, user: "jordan", exclude: Array.from({ length: 51 }, (_, i) => `r${i}`) },
      "exclude",
    ],
  ])("rejects %s", (_name, data, path) => {
    const result = parseGitHubConfig(data);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.path)).toContain(path);
  });
});
