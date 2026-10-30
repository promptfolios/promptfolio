import { describe, expect, it } from "vitest";
import { carryForward } from "./carry-forward";
import type { FetchGitHubResult, GitHubFetchError } from "./fetch";
import type { GitHubSnapshot, SnapshotRepository } from "./snapshot";

const OLD = "2026-10-20T06:00:00.000Z";
const NOW = "2026-10-30T06:00:00.000Z";

function repository(name: string, retrievedAt: string, readme = `${name} at ${retrievedAt}`) {
  return {
    retrievedAt,
    name,
    fullName: `jordan-example/${name}`,
    htmlUrl: `https://github.com/jordan-example/${name}`,
    description: null,
    homepage: null,
    language: null,
    languages: {},
    topics: [],
    fork: false,
    archived: false,
    createdAt: null,
    pushedAt: null,
    license: null,
    pinned: false,
    readme,
    readmeTruncated: false,
  } satisfies SnapshotRepository;
}

function snapshot(repositories: SnapshotRepository[], retrievedAt = NOW, login = "jordan-example") {
  return {
    formatVersion: 2,
    retrievedAt,
    authenticated: false,
    user: { login, htmlUrl: `https://github.com/${login}` },
    repositories,
  } satisfies GitHubSnapshot;
}

function timeout(name: string): GitHubFetchError {
  return {
    kind: "timeout",
    target: `repos/jordan-example/${name}/readme`,
    message: "GitHub did not answer in time",
  };
}

const previous = snapshot([repository("a", OLD), repository("b", OLD), repository("c", OLD)], OLD);

/** This run: `a` read, `b` and the new `d` failed, `c` no longer selected. */
function partial(): FetchGitHubResult {
  return {
    status: "partial",
    snapshot: snapshot([repository("a", NOW)]),
    selected: ["jordan-example/a", "jordan-example/b", "jordan-example/d"],
    missing: [
      { fullName: "jordan-example/b", errors: [timeout("b")] },
      { fullName: "jordan-example/d", errors: [timeout("d")] },
    ],
    warnings: ["a note"],
    requests: 8,
  };
}

describe("carryForward", () => {
  it("returns a complete fetch unchanged", () => {
    const fetched: FetchGitHubResult = {
      status: "complete",
      snapshot: snapshot([repository("a", NOW)]),
      warnings: [],
      requests: 4,
    };
    const result = carryForward(previous, fetched);
    expect(result).toEqual({
      status: "complete",
      snapshot: fetched.snapshot,
      carriedOver: [],
      notAdded: [],
      errors: [],
      warnings: [],
    });
  });

  it("passes a failed fetch through", () => {
    const errors = [timeout("a")];
    expect(carryForward(previous, { status: "failed", errors, requests: 1 })).toEqual({
      status: "failed",
      errors,
    });
  });

  it("keeps the previous entry of a repository that could not be read, in selection order", () => {
    const result = carryForward(previous, partial());
    if (result.status === "failed") throw new Error("Expected partial");

    expect(result.status).toBe("partial");
    expect(result.snapshot.retrievedAt).toBe(NOW);
    expect(result.snapshot.repositories.map((entry) => [entry.name, entry.retrievedAt])).toEqual([
      ["a", NOW],
      ["b", OLD],
    ]);
    // The whole previous entry, not a mix of two runs.
    expect(result.snapshot.repositories[1]).toEqual(previous.repositories[1]);
    expect(result.carriedOver).toEqual([{ fullName: "jordan-example/b", retrievedAt: OLD }]);
    expect(result.notAdded).toEqual(["jordan-example/d"]);
    expect(result.errors).toEqual([timeout("b"), timeout("d")]);
    expect(result.warnings).toEqual(["a note"]);
  });

  it("drops a repository that is no longer selected", () => {
    const result = carryForward(previous, partial());
    if (result.status === "failed") throw new Error("Expected partial");
    expect(result.snapshot.repositories.map((entry) => entry.name)).not.toContain("c");
  });

  it("matches names case-insensitively, as GitHub does", () => {
    const fetched = partial();
    if (fetched.status !== "partial") throw new Error("fixture");
    fetched.selected = ["jordan-example/a", "Jordan-Example/B"];
    const result = carryForward(previous, fetched);
    if (result.status === "failed") throw new Error("Expected partial");
    expect(result.carriedOver.map((entry) => entry.retrievedAt)).toEqual([OLD]);
  });

  it("fails a partial fetch when there is no previous snapshot to fill the gaps", () => {
    const result = carryForward(undefined, partial());
    expect(result).toEqual({ status: "failed", errors: [timeout("b"), timeout("d")] });
  });

  it("does not carry data over from a snapshot of another account", () => {
    const other = snapshot([repository("b", OLD)], OLD, "someone-else");
    expect(carryForward(other, partial()).status).toBe("failed");
  });
});
