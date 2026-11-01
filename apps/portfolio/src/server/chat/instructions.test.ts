import { describe, expect, it } from "vitest";
import { chatInstructions } from "./instructions";

describe("chatInstructions", () => {
  it("names the Contact button only when it exists", () => {
    expect(chatInstructions(true)).toContain("Contact button");
    expect(chatInstructions(false)).toBeUndefined();
  });
});
