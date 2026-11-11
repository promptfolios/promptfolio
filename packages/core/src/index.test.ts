import { describe, expect, it } from "vitest";
import * as core from "./index.ts";

describe("public API", () => {
  it("exposes only the intended runtime exports", () => {
    expect(Object.keys(core).sort()).toEqual([
      "addObservedRecords",
      "canonicalProfileContent",
      "findContactDetails",
      "findRecordById",
      "isRecordId",
      "loadStructuredProfile",
      "profileFingerprint",
      "profileLinkUrls",
      "recordsUsingSkill",
    ]);
  });

  it("exposes the authoring format as plain types, adding no runtime export", () => {
    // A plain interface, not built from zod (see input.ts), so a zod upgrade cannot change it.
    const input: core.ProfileInput = {
      schemaVersion: 1,
      identity: { name: "Jordan Example", headline: "Engineer", summary: "Builds things." },
    };
    expect(input.links).toBeUndefined();
  });
});
