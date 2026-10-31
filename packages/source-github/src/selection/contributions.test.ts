import { describe, expect, it } from "vitest";
import type { CommitSearchItem } from "../snapshot/snapshot";
import {
  CONTRIBUTION_LIMITS,
  eligibleCommits,
  firstLine,
  repositoriesWithSharedCommits,
  selectContributions,
} from "./contributions";

const CONFIG = {
  user: "Jordan",
  exclude: [],
  excludeContributionsTo: ["other-org/Hidden"],
};

let nextSha = 0;
function hash(): string {
  nextSha += 1;
  return nextSha.toString(16).padStart(40, "0");
}

function item(fullName: string, overrides: Partial<CommitSearchItem> = {}): CommitSearchItem {
  const owner = fullName.split("/")[0] ?? "";
  return {
    sha: hash(),
    html_url: `https://github.com/${fullName}/commit/abc`,
    commit: { message: "fix: something", author: { date: "2026-09-01T00:00:00Z" } },
    author: { login: "jordan" },
    parents: [{}],
    repository: {
      full_name: fullName,
      html_url: `https://github.com/${fullName}`,
      description: null,
      private: false,
      fork: false,
      owner: { login: owner },
    },
    ...overrides,
  };
}

function withRepository(
  fullName: string,
  change: Partial<CommitSearchItem["repository"]>,
): CommitSearchItem {
  const base = item(fullName);
  return { ...base, repository: { ...base.repository, ...change } };
}

describe("eligibleCommits", () => {
  it("keeps a commit attributed to the user in another owner's public repository", () => {
    const commit = item("other-org/tool");
    expect(eligibleCommits([commit], CONFIG)).toEqual([commit]);
  });

  it.each([
    ["the user's own repository", item("JORDAN/own")],
    ["a private repository", withRepository("other-org/tool", { private: true })],
    ["a fork", withRepository("other-org/tool", { fork: true })],
    ["an excluded repository", item("Other-Org/hidden")],
    ["a merge commit", item("other-org/tool", { parents: [{}, {}] })],
    ["a commit linked to no account", item("other-org/tool", { author: null })],
    ["a commit linked to someone else", item("other-org/tool", { author: { login: "sam" } })],
    [
      "an empty message",
      item("other-org/tool", {
        commit: { message: "  \n\nbody", author: { date: "2026-09-01T00:00:00Z" } },
      }),
    ],
  ])("drops %s", (_name, commit) => {
    expect(eligibleCommits([commit], CONFIG)).toEqual([]);
  });
});

describe("repositoriesWithSharedCommits", () => {
  it("names only repositories that share a hash", () => {
    const shared = item("other-org/tool");
    expect(
      repositoriesWithSharedCommits([
        shared,
        { ...item("a-mirror/tool"), sha: shared.sha },
        item("other-org/alone"),
      ]),
    ).toEqual(["a-mirror/tool", "other-org/tool"]);
  });
});

describe("selectContributions", () => {
  it("keeps a shared commit in the repository with most stars", () => {
    const original = item("other-org/tool");
    const mirror = { ...item("a-mirror/tool"), sha: original.sha };
    const stars = new Map([
      ["other-org/tool", 900],
      ["a-mirror/tool", 1],
    ]);
    const selected = selectContributions({ items: [mirror, original], stars, pinned: [] });
    expect(selected.map((commit) => commit.repository.full_name)).toEqual(["other-org/tool"]);
  });

  it("is stable when stars are equal or unknown: alphabetically first", () => {
    const original = item("other-org/tool");
    const mirror = { ...item("a-mirror/tool"), sha: original.sha };
    for (const items of [
      [mirror, original],
      [original, mirror],
    ]) {
      const selected = selectContributions({ items, stars: new Map(), pinned: [] });
      expect(selected.map((commit) => commit.repository.full_name)).toEqual(["a-mirror/tool"]);
    }
  });

  it("orders pinned repositories in pin order, then the latest commit", () => {
    const at = (fullName: string, date: string) =>
      item(fullName, { commit: { message: "x", author: { date } } });
    const selected = selectContributions({
      items: [
        at("other-org/newest", "2026-10-01T00:00:00Z"),
        at("pin/second", "2026-01-01T00:00:00Z"),
        at("other-org/older", "2026-05-01T00:00:00Z"),
        at("pin/first", "2025-01-01T00:00:00Z"),
      ],
      stars: new Map(),
      pinned: ["PIN/first", "pin/second"],
    });
    expect(selected.map((commit) => commit.repository.full_name)).toEqual([
      "pin/first",
      "pin/second",
      "other-org/newest",
      "other-org/older",
    ]);
  });

  it("caps per repository and in total", () => {
    const busy = Array.from({ length: 20 }, () => item("other-org/busy"));
    const others = Array.from({ length: 20 }, (_, index) => item(`org-${index}/tool`));
    const selected = selectContributions({
      items: [...busy, ...others],
      stars: new Map(),
      pinned: [],
    });
    expect(selected).toHaveLength(CONTRIBUTION_LIMITS.total);
    expect(
      selected.filter((commit) => commit.repository.full_name === "other-org/busy"),
    ).toHaveLength(CONTRIBUTION_LIMITS.perRepository);
  });
});

describe("firstLine", () => {
  it("takes the headline of a commit message", () => {
    expect(firstLine(" fix: a \r\n\r\nbody")).toBe("fix: a");
    expect(firstLine("")).toBe("");
  });
});
