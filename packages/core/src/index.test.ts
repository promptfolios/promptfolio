import { describe, expect, it } from "vitest";
import * as core from "./index";

describe("public API", () => {
  it("exposes only the intended runtime exports", () => {
    expect(Object.keys(core).sort()).toEqual([
      "addObservedRecords",
      "canonicalProfileContent",
      "findRecordById",
      "isRecordId",
      "loadStructuredProfile",
      "profileFingerprint",
      "recordsUsingSkill",
    ]);
  });
});
