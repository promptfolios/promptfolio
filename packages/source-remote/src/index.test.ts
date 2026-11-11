import { describe, expect, it } from "vitest";
import * as remote from "./index.ts";

describe("public API", () => {
  it("exposes only the intended runtime exports", () => {
    expect(Object.keys(remote).sort()).toEqual(["fetchRemoteProfile"]);
  });
});
