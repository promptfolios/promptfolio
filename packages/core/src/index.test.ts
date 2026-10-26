import { describe, expect, it } from "vitest";
import { coreInfo } from "./index";

describe("coreInfo", () => {
  it("identifies the package", () => {
    expect(coreInfo.name).toBe("@promptfolio/core");
  });
});
