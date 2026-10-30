import { describe, expect, it } from "vitest";
import * as sourceGitHub from "./index";

describe("public API", () => {
  it("exposes only the intended runtime exports", () => {
    expect(Object.keys(sourceGitHub).sort()).toEqual([
      "CONFIG_LIMITS",
      "FETCH_DEFAULTS",
      "GITHUB_SOURCE_ID",
      "SELECTION_LIMITS",
      "SNAPSHOT_LIMITS",
      "carryForward",
      "fetchGitHubSnapshot",
      "normalizeGitHubSnapshot",
      "parseGitHubConfig",
      "parseGitHubSnapshot",
      "repositoryKey",
    ]);
  });
});
