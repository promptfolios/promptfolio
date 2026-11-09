import { loadStructuredProfile, type Profile, type ProfileLoadResult } from "@promptfolio/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FetchGitHubResult } from "../fetch/fetch.ts";
import type { GitHubSnapshot, SnapshotRepository } from "../snapshot/snapshot.ts";
import { createWithFetcher, type RefreshOutcome } from "./refresh.ts";
import { createMemorySnapshotStore, type GitHubSnapshotStore } from "./store.ts";

const CONFIG = { user: "jordan-example", exclude: [], excludeContributionsTo: [] };
const OLD = "2026-10-20T06:00:00.000Z";
const NOW = "2026-10-30T06:00:00.000Z";
const START = Date.parse(NOW);
const HOUR = 60 * 60 * 1000;

function ownerResult(): ProfileLoadResult & { ok: true } {
  const loaded = loadStructuredProfile(
    {
      schemaVersion: 1,
      identity: { name: "Jordan Example", headline: "Engineer", summary: "Builds things." },
    },
    { sourceId: "owner-profile", label: "Test profile", observedAt: new Date("2026-10-01") },
  );
  if (!loaded.ok) throw new Error("test profile is invalid");
  return loaded;
}
const owner = (): Profile => ownerResult().profile;

function repository(name: string, retrievedAt: string): SnapshotRepository {
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
    readme: `${name} at ${retrievedAt}`,
    readmeTruncated: false,
  };
}

function snapshot(repositories: SnapshotRepository[], retrievedAt = NOW, login = "jordan-example") {
  return {
    formatVersion: 2,
    retrievedAt,
    authenticated: false,
    user: { login, htmlUrl: `https://github.com/${login}` },
    repositories,
    contributions: [],
  } satisfies GitHubSnapshot;
}

const previous = snapshot([repository("a", OLD), repository("b", OLD)], OLD);
const complete = (value = snapshot([repository("a", NOW)])): FetchGitHubResult => ({
  status: "complete",
  snapshot: value,
  warnings: [],
  requests: 3,
});
/** `a` read again, `b` could not be read. */
const partial: FetchGitHubResult = {
  status: "partial",
  snapshot: snapshot([repository("a", NOW)]),
  selected: ["jordan-example/a", "jordan-example/b"],
  missing: [{ fullName: "jordan-example/b", errors: [] }],
  contributionErrors: [],
  warnings: [],
  requests: 4,
};
const failed: FetchGitHubResult = {
  status: "failed",
  errors: [{ kind: "rate-limited", target: "users/jordan-example", message: "rate limited" }],
  requests: 1,
};

/** A source over `store` with a fixed clock; scheduled work is collected, not run. */
function setup(store: GitHubSnapshotStore, fetched: FetchGitHubResult | Error = complete()) {
  const fetchSnapshot = vi.fn(async () => {
    if (fetched instanceof Error) throw fetched;
    return fetched;
  });
  const scheduled: (() => Promise<void>)[] = [];
  const source = createWithFetcher(
    {
      store,
      config: CONFIG,
      runAfterResponse: (work) => {
        scheduled.push(work);
      },
      now: () => START,
    },
    fetchSnapshot,
  );
  return { source, fetchSnapshot, scheduled };
}

/** A memory store whose methods named in `failing` reject. */
function failingStore(failing: { get?: boolean; setSnapshot?: boolean; lock?: boolean }) {
  const inner = createMemorySnapshotStore();
  const unlock = vi.fn(inner.unlock);
  const store: GitHubSnapshotStore = {
    get: (key) => (failing.get ? Promise.reject(new Error("secret://store")) : inner.get(key)),
    set: (key, value) =>
      failing.setSnapshot && key === "snapshot"
        ? Promise.reject(new Error("secret://store"))
        : inner.set(key, value),
    lock: (ttl) => (failing.lock ? Promise.reject(new Error("secret://store")) : inner.lock(ttl)),
    unlock,
  };
  return { store, inner, unlock };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("loadProfile", () => {
  it("returns the owner profile alone when nothing is stored, and schedules a refresh", async () => {
    const { source, fetchSnapshot, scheduled } = setup(createMemorySnapshotStore());

    const loaded = await source.loadProfile(ownerResult());

    if (!loaded.ok) throw new Error("expected a profile");
    expect(loaded.profile.repositories).toEqual([]);
    expect(scheduled).toHaveLength(1);
    expect(fetchSnapshot).not.toHaveBeenCalled();
  });

  it("adds the stored snapshot's repositories", async () => {
    const store = createMemorySnapshotStore();
    await store.set("snapshot", previous);
    const { source } = setup(store);

    const loaded = await source.loadProfile(ownerResult());

    if (!loaded.ok) throw new Error("expected a profile");
    expect(loaded.profile.repositories.map((record) => record.id)).toEqual([
      "github.com/jordan-example/a",
      "github.com/jordan-example/b",
    ]);
  });

  it("keeps the owner profile, with warnings, when the stored snapshot is invalid", async () => {
    const store = createMemorySnapshotStore();
    await store.set("snapshot", { ...previous, repositories: "none" });
    const { source } = setup(store);

    const loaded = await source.loadProfile(ownerResult());

    if (!loaded.ok) throw new Error("expected a profile");
    expect(loaded.profile.repositories).toEqual([]);
    expect(loaded.warnings[0]?.path).toBe("stored GitHub snapshot: repositories");
  });

  it("keeps the owner profile, with a warning naming no error, when the store fails", async () => {
    const { source } = setup(failingStore({ get: true }).store);

    const loaded = await source.loadProfile(ownerResult());

    if (!loaded.ok) throw new Error("expected a profile");
    expect(loaded.warnings).toHaveLength(1);
    expect(JSON.stringify(loaded.warnings)).not.toContain("secret");
  });

  it("returns a failed owner profile unchanged and schedules nothing", async () => {
    const { source, scheduled } = setup(createMemorySnapshotStore());
    const failedOwner: ProfileLoadResult = { ok: false, issues: [{ path: "x", message: "bad" }] };

    expect(await source.loadProfile(failedOwner)).toBe(failedOwner);
    expect(scheduled).toEqual([]);
  });

  it("still answers when runAfterResponse throws", async () => {
    const source = createWithFetcher(
      {
        store: createMemorySnapshotStore(),
        config: CONFIG,
        runAfterResponse: () => {
          throw new Error("outside a request");
        },
      },
      async () => complete(),
    );

    expect((await source.loadProfile(ownerResult())).ok).toBe(true);
  });

  it("runs the refresh when the scheduled work runs", async () => {
    const store = createMemorySnapshotStore();
    const { source, scheduled } = setup(store);
    await source.loadProfile(ownerResult());

    await scheduled[0]?.();

    expect(await store.get("snapshot")).toEqual(snapshot([repository("a", NOW)]));
  });
});

describe("refreshIfDue", () => {
  async function refreshAfter(store: GitHubSnapshotStore) {
    return (await store.get("refresh-after")) as number;
  }

  it("stores a complete refresh, waits 6 hours, and releases the lock", async () => {
    const store = createMemorySnapshotStore();
    const { source } = setup(store);

    expect(await source.refreshIfDue(owner())).toBe<RefreshOutcome>("complete");
    expect(await store.get("snapshot")).toEqual(snapshot([repository("a", NOW)]));
    expect(await refreshAfter(store)).toBe(START + 6 * HOUR);
    expect(await store.lock(1)).toBeDefined();
  });

  it("does nothing before the next refresh is due", async () => {
    const store = createMemorySnapshotStore();
    await store.set("refresh-after", START + 1);
    const { source, fetchSnapshot } = setup(store);

    expect(await source.refreshIfDue(owner())).toBe("not-due");
    expect(fetchSnapshot).not.toHaveBeenCalled();
  });

  it("does nothing while another run holds the lock", async () => {
    const store = createMemorySnapshotStore();
    await store.lock(60);
    const { source, fetchSnapshot } = setup(store);

    expect(await source.refreshIfDue(owner())).toBe("locked");
    expect(fetchSnapshot).not.toHaveBeenCalled();
  });

  it("stores a partial refresh with earlier data kept, and retries in 1 hour", async () => {
    const store = createMemorySnapshotStore();
    await store.set("snapshot", previous);
    const { source } = setup(store, partial);

    expect(await source.refreshIfDue(owner())).toBe("partial");
    const stored = (await store.get("snapshot")) as GitHubSnapshot;
    expect(stored.repositories.map((entry) => entry.retrievedAt)).toEqual([NOW, OLD]);
    expect(await refreshAfter(store)).toBe(START + HOUR);
  });

  it("keeps the stored snapshot when the fetch fails, and retries in 1 hour", async () => {
    const store = createMemorySnapshotStore();
    await store.set("snapshot", previous);
    const { source } = setup(store, failed);

    expect(await source.refreshIfDue(owner())).toBe("failed");
    expect(await store.get("snapshot")).toEqual(previous);
    expect(await refreshAfter(store)).toBe(START + HOUR);
  });

  it("keeps the stored snapshot when the new one does not fit the profile", async () => {
    const store = createMemorySnapshotStore();
    await store.set("snapshot", previous);
    const { source } = setup(
      store,
      complete(snapshot([repository("a", NOW)], NOW, "someone-else")),
    );

    expect(await source.refreshIfDue(owner())).toBe("failed");
    expect(await store.get("snapshot")).toEqual(previous);
  });

  it("overwrites an invalid stored snapshot", async () => {
    const store = createMemorySnapshotStore();
    await store.set("snapshot", { formatVersion: 99 });
    const { source } = setup(store);

    expect(await source.refreshIfDue(owner())).toBe("complete");
    expect(await store.get("snapshot")).toEqual(snapshot([repository("a", NOW)]));
  });

  it("fails without fetching when the store cannot be read or locked", async () => {
    for (const failing of [{ get: true }, { lock: true }]) {
      const { source, fetchSnapshot } = setup(failingStore(failing).store);

      expect(await source.refreshIfDue(owner())).toBe("failed");
      expect(fetchSnapshot).not.toHaveBeenCalled();
    }
  });

  it("releases the lock and retries in 1 hour when storing the snapshot fails", async () => {
    const { store, inner, unlock } = failingStore({ setSnapshot: true });
    const { source } = setup(store);

    expect(await source.refreshIfDue(owner())).toBe("failed");
    expect(unlock).toHaveBeenCalledOnce();
    expect(await refreshAfter(inner)).toBe(START + HOUR);
  });

  it("releases the lock when the fetch throws, and logs no error message", async () => {
    const { store, unlock } = failingStore({});
    const { source } = setup(store, new Error("secret://token"));

    expect(await source.refreshIfDue(owner())).toBe("failed");
    expect(unlock).toHaveBeenCalledOnce();
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("secret");
  });

  it("rejects intervals that are not positive", () => {
    expect(() =>
      createWithFetcher(
        {
          store: createMemorySnapshotStore(),
          config: CONFIG,
          runAfterResponse: () => {},
          intervals: { retryMs: 0 },
        },
        async () => complete(),
      ),
    ).toThrow(RangeError);
  });
});

describe("createMemorySnapshotStore", () => {
  it("lets a lock be taken again once it expires, and an old token not release the new one", async () => {
    let now = 0;
    const store = createMemorySnapshotStore({ now: () => now });
    const first = await store.lock(10);
    expect(await store.lock(10)).toBeUndefined();

    now = 10_000;
    const second = await store.lock(10);
    expect(second).toBeDefined();
    await store.unlock(first as string);
    expect(await store.lock(10)).toBeUndefined();

    await store.unlock(second as string);
    expect(await store.lock(10)).toBeDefined();
  });
});
