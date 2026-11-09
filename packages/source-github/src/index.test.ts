import { describe, expect, it } from "vitest";
import * as sourceGitHub from "./index.ts";

describe("public API", () => {
  it("exposes only the intended runtime exports", () => {
    expect(Object.keys(sourceGitHub).sort()).toEqual([
      "carryForward",
      "createBackgroundGitHubSource",
      "createMemorySnapshotStore",
      "fetchGitHubSnapshot",
      "mergeGitHubSnapshot",
      "normalizeGitHubSnapshot",
      "parseGitHubConfig",
      "parseGitHubSnapshot",
    ]);
  });
});
