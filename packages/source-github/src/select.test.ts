import { describe, expect, it } from "vitest";
import { SELECTION_LIMITS, selectRepositories } from "./select";
import type { ListedRepository } from "./snapshot";

function listed(name: string, overrides: Partial<ListedRepository> = {}): ListedRepository {
  return {
    name,
    full_name: `jordan/${name}`,
    html_url: `https://github.com/jordan/${name}`,
    description: null,
    homepage: null,
    language: null,
    topics: [],
    fork: false,
    archived: false,
    private: false,
    visibility: "public",
    created_at: "2020-01-01T00:00:00Z",
    pushed_at: "2026-01-01T00:00:00Z",
    license: null,
    ...overrides,
  };
}

const config = { user: "Jordan", exclude: ["Hidden"], excludeContributionsTo: [] };
const names = (repositories: ListedRepository[]) =>
  repositories.map((repository) => repository.name);

describe("selectRepositories", () => {
  it("drops forks, private and internal repositories, exclusions, and other owners", () => {
    const selected = selectRepositories({
      config,
      authenticated: false,
      pinned: [],
      repositories: [
        listed("kept"),
        listed("fork", { fork: true }),
        listed("private", { private: true }),
        listed("internal", { visibility: "internal" }),
        listed("hidden"),
        listed("theirs", { full_name: "someone/theirs" }),
      ],
    });
    expect(names(selected)).toEqual(["kept"]);
  });

  it("orders pinned repositories first in pin order, then by last push", () => {
    const selected = selectRepositories({
      config,
      authenticated: true,
      pinned: ["jordan/old-b", "Jordan/Old-A"],
      repositories: [
        listed("recent", { pushed_at: "2026-10-01T00:00:00Z" }),
        listed("Old-A", { pushed_at: "2019-01-01T00:00:00Z" }),
        listed("older", { pushed_at: "2025-01-01T00:00:00Z" }),
        listed("old-b", { pushed_at: "2018-01-01T00:00:00Z" }),
        listed("never", { pushed_at: null }),
      ],
    });
    expect(names(selected)).toEqual(["old-b", "Old-A", "recent", "older", "never"]);
  });

  it("keeps 12 repositories without a token and 20 with one", () => {
    const many = Array.from({ length: 30 }, (_, index) => listed(`repo-${index}`));
    expect(
      selectRepositories({ config, authenticated: false, pinned: [], repositories: many }),
    ).toHaveLength(SELECTION_LIMITS.withoutToken);
    expect(
      selectRepositories({ config, authenticated: true, pinned: [], repositories: many }),
    ).toHaveLength(SELECTION_LIMITS.withToken);
  });

  it("keeps a repository listed twice only once", () => {
    const selected = selectRepositories({
      config,
      authenticated: true,
      pinned: [],
      repositories: [listed("same"), listed("same")],
    });
    expect(names(selected)).toEqual(["same"]);
  });
});
