import { describe, expect, it } from "vitest";
import { withoutSources } from "./sources";

describe("withoutSources", () => {
  it("removes only the sources parts, and does not change the originals", () => {
    const messages = [
      { id: "u1", parts: [{ type: "text", text: "Hi" }] },
      {
        id: "a1",
        parts: [
          { type: "step-start" },
          { type: "text", text: "Hello [a]." },
          { type: "data-sources", data: { sources: [], unverifiedCitations: 1 } },
        ],
      },
    ];

    expect(withoutSources(messages)).toEqual([
      { id: "u1", parts: [{ type: "text", text: "Hi" }] },
      { id: "a1", parts: [{ type: "step-start" }, { type: "text", text: "Hello [a]." }] },
    ]);
    expect(messages[1]?.parts).toHaveLength(3);
  });
});
