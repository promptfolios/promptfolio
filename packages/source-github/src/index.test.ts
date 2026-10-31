import { describe, expect, it } from "vitest";
import * as sourceGitHub from "./index";

describe("public API", () => {
  it("exposes only the intended runtime exports", () => {
    expect(Object.keys(sourceGitHub).sort()).toEqual([
      "carryForward",
      "fetchGitHubSnapshot",
      "mergeGitHubSnapshot",
      "normalizeGitHubSnapshot",
      "parseGitHubConfig",
      "parseGitHubSnapshot",
    ]);
  });
});
