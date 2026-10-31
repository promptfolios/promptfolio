import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadStructuredProfile } from "@promptfolio/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `server-only` throws outside a React Server Components build; tests run in plain Node.
vi.mock("server-only", () => ({}));

const { cachedStarterQuestions, loadStarterQuestions } = await import("./starters");

const STARTERS = [
  { label: "Work history", question: "Where has Jordan worked?" },
  { label: "Projects", question: "What has Jordan built?" },
  { label: "Skills", question: "Which skills does Jordan list?" },
];

function profile(summary = "Builds tools.") {
  const result = loadStructuredProfile(
    { schemaVersion: 1, identity: { name: "Jordan Example", headline: "Engineer", summary } },
    { sourceId: "owner-profile", label: "Test", observedAt: new Date("2026-10-01") },
  );
  if (!result.ok) throw new Error("test profile is invalid");
  return result.profile;
}

let dir: string;
let time: number;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "promptfolio-starters-"));
  time = 0;
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function setup({ fails = false } = {}) {
  const generate = vi.fn(async () => (fails ? undefined : STARTERS));
  const ask = (summary?: string) =>
    cachedStarterQuestions({ profile: profile(summary), generate, dir, now: () => time });
  return { generate, ask };
}

describe("cachedStarterQuestions", () => {
  it("makes no model call for a build with an unchanged profile", async () => {
    const { generate, ask } = setup();

    expect(await ask()).toEqual(STARTERS);
    expect(await ask()).toEqual(STARTERS);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("does not expire starters that worked", async () => {
    const { generate, ask } = setup();

    await ask();
    time = 365 * 24 * 60 * 60_000;
    await ask();

    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("generates again when the profile changes", async () => {
    const { generate, ask } = setup();

    await ask("Builds tools.");
    await ask("Builds other tools.");

    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("shows none after a failure, and does not ask again for ten minutes", async () => {
    const { generate, ask } = setup({ fails: true });

    expect(await ask()).toEqual([]);
    time = 10 * 60_000 - 1;
    expect(await ask()).toEqual([]);
    expect(generate).toHaveBeenCalledTimes(1);

    time = 10 * 60_000;
    await ask();
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("treats a cache file it cannot read as no entry", async () => {
    const { generate, ask } = setup();
    await ask();
    const [file] = await readdir(dir);
    if (!file) throw new Error("no cache file");
    await writeFile(path.join(dir, file), "not json");

    expect(await ask()).toEqual(STARTERS);
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("still returns starters when the cache cannot be written", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const blocked = path.join(dir, "file");
    await writeFile(blocked, "");

    const starters = await cachedStarterQuestions({
      profile: profile(),
      generate: async () => STARTERS,
      // A directory cannot be made inside a file.
      dir: path.join(blocked, "cache"),
    });

    expect(starters).toEqual(STARTERS);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("leaves no temporary files behind", async () => {
    const { ask } = setup();

    await ask();

    expect((await readdir(dir)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });
});

describe("loadStarterQuestions", () => {
  it("has none, and makes no call, without a configured model", async () => {
    expect(await loadStarterQuestions(profile(), {})).toEqual([]);
  });
});
