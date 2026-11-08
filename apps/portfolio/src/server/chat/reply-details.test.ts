import { describe, expect, it, vi } from "vitest";

// `server-only` throws outside a React Server Components build; tests run in plain Node.
vi.mock("server-only", () => ({}));

const { modelDisplayName } = await import("./reply-details");

describe("modelDisplayName", () => {
  it("shows the model name only, without provider, route, or variant", () => {
    expect(modelDisplayName("gpt-4o-mini")).toBe("gpt-4o-mini");
    expect(modelDisplayName("openai/gpt-4o-mini")).toBe("gpt-4o-mini");
    expect(modelDisplayName("gateway:openai/gpt-4o-mini")).toBe("gpt-4o-mini");
    expect(modelDisplayName("openrouter:google/gemma-4-31b-it:free")).toBe("gemma-4-31b-it");
    expect(modelDisplayName("google/gemma-4-31b-it:free")).toBe("gemma-4-31b-it");
    expect(modelDisplayName("gemini-3.5-flash-lite")).toBe("gemini-3.5-flash-lite");
  });

  it("shows nothing for a failover list or an id that is not a plain name", () => {
    expect(
      modelDisplayName("google:gemini-3.5-flash-lite,anthropic:claude-haiku-5-5"),
    ).toBeUndefined();
    expect(modelDisplayName("")).toBeUndefined();
    expect(modelDisplayName("model with spaces")).toBeUndefined();
    expect(modelDisplayName("<script>")).toBeUndefined();
  });
});
