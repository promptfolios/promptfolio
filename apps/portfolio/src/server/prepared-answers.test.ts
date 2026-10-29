import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPreparedAnswers, preparedAnswersFileName } from "./prepared-answers";

const ENTRY = {
  question: "Give me a short professional overview.",
  text: "Jordan is an engineer.",
  profileFingerprint: `sha256:${"a".repeat(64)}`,
  instructionsFingerprint: `sha256:${"b".repeat(64)}`,
  evidenceIds: [],
  model: "google:gemini-3.8-flash",
  generatedAt: "2026-10-29T10:00:00.000Z",
};

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "promptfolio-answers-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function logger() {
  return { error: vi.fn() };
}

describe("preparedAnswersFileName", () => {
  it("puts .answers before the .json extension", () => {
    expect(preparedAnswersFileName("example.profile.json")).toBe("example.profile.answers.json");
    expect(preparedAnswersFileName("profile.local.json")).toBe("profile.local.answers.json");
    expect(preparedAnswersFileName("profile")).toBe("profile.answers.json");
  });
});

describe("loadPreparedAnswers", () => {
  it("reads a valid file", async () => {
    await writeFile(
      path.join(dir, "example.profile.answers.json"),
      JSON.stringify({ formatVersion: 1, answers: [ENTRY] }),
    );
    const log = logger();
    expect(await loadPreparedAnswers("example.profile.json", { dir, logger: log })).toEqual([
      ENTRY,
    ]);
    expect(log.error).not.toHaveBeenCalled();
  });

  it("gives no answers and logs nothing when the file does not exist", async () => {
    const log = logger();
    expect(await loadPreparedAnswers("example.profile.json", { dir, logger: log })).toEqual([]);
    expect(log.error).not.toHaveBeenCalled();
  });

  it.each([
    ["not JSON", "{ SECRET-MARKER"],
    [
      "of the wrong shape",
      JSON.stringify({
        formatVersion: 1,
        answers: [{ ...ENTRY, text: "", model: "SECRET-MARKER" }],
      }),
    ],
  ])(
    "gives no answers and logs once, without the contents, for a file %s",
    async (_name, contents) => {
      await writeFile(path.join(dir, "example.profile.answers.json"), contents);
      const log = logger();
      expect(await loadPreparedAnswers("example.profile.json", { dir, logger: log })).toEqual([]);
      expect(log.error).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(log.error.mock.calls)).not.toContain("SECRET-MARKER");
    },
  );

  it("gives no answers when the file is a schema mismatch", async () => {
    await writeFile(
      path.join(dir, "example.profile.answers.json"),
      JSON.stringify({ formatVersion: 2, answers: [] }),
    );
    const log = logger();
    expect(await loadPreparedAnswers("example.profile.json", { dir, logger: log })).toEqual([]);
    expect(log.error).toHaveBeenCalledTimes(1);
  });
});
