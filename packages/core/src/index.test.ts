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
      "profileLinkUrls",
      "recordsUsingSkill",
    ]);
  });

  it("exposes no type built from zod, so a zod upgrade cannot change this API", () => {
    // @ts-expect-error `pnpm typecheck` fails if this type comes back.
    const input: core.ProfileInput | undefined = undefined;
    expect(input).toBeUndefined();
  });
});
