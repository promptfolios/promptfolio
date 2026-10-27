import type { ThreadMessage } from "@assistant-ui/react";
import { describe, expect, it } from "vitest";
import { DEFAULT_TITLE, titleFromMessages } from "./thread-list-adapter";

/** Minimal message fixture; the function only reads `role` and `content`. */
function message(role: "user" | "assistant", text: string): ThreadMessage {
  return { role, content: [{ type: "text", text }] } as unknown as ThreadMessage;
}

describe("titleFromMessages", () => {
  it("uses the first user message", () => {
    expect(
      titleFromMessages([message("user", "What projects?"), message("user", "And skills?")]),
    ).toBe("What projects?");
  });

  it("collapses whitespace and truncates long messages", () => {
    const title = titleFromMessages([message("user", `  Tell   me ${"a".repeat(60)}`)]);
    expect(title.startsWith("Tell me a")).toBe(true);
    expect(title.endsWith("…")).toBe(true);
    expect(title.length).toBeLessThanOrEqual(41);
  });

  it("falls back to a default title without a user message", () => {
    expect(titleFromMessages([message("assistant", "Hello")])).toBe(DEFAULT_TITLE);
    expect(titleFromMessages([])).toBe(DEFAULT_TITLE);
  });
});
