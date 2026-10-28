import { describe, expect, it, vi } from "vitest";

// `server-only` throws outside a React Server Components build; tests run in plain Node.
vi.mock("server-only", () => ({}));

const { createChatModel } = await import("./model");

const bothKeys = { GOOGLE_GENERATIVE_AI_API_KEY: "google-key", ANTHROPIC_API_KEY: "anthropic-key" };

describe("createChatModel with PROMPTFOLIO_MODEL", () => {
  it("selects the provider and model from provider:model", () => {
    const google = createChatModel({
      ...bothKeys,
      PROMPTFOLIO_MODEL: "google:gemini-3.5-flash-lite",
    });
    const anthropic = createChatModel({
      ...bothKeys,
      PROMPTFOLIO_MODEL: "anthropic:claude-sonnet-5-5",
    });

    expect(google.ok && [google.provider, google.modelId]).toEqual([
      "google",
      "gemini-3.5-flash-lite",
    ]);
    expect(anthropic.ok && [anthropic.provider, anthropic.modelId]).toEqual([
      "anthropic",
      "claude-sonnet-5-5",
    ]);
  });

  it("uses the provider's default model when only the provider is given", () => {
    const google = createChatModel({ ...bothKeys, PROMPTFOLIO_MODEL: "google" });
    const anthropic = createChatModel({ ...bothKeys, PROMPTFOLIO_MODEL: "anthropic:" });

    expect(google.ok && google.modelId).toBe("gemini-3.8-flash");
    expect(anthropic.ok && anthropic.modelId).toBe("claude-haiku-5-5");
  });

  it("sets low thinking for each provider", () => {
    const google = createChatModel({ ...bothKeys, PROMPTFOLIO_MODEL: "google" });
    const anthropic = createChatModel({ ...bothKeys, PROMPTFOLIO_MODEL: "anthropic" });

    expect(google.ok && google.providerOptions).toEqual({
      google: { thinkingConfig: { thinkingLevel: "low" } },
    });
    expect(anthropic.ok && anthropic.providerOptions).toEqual({ anthropic: { effort: "low" } });
  });

  it("reports a missing key for the selected provider", () => {
    const result = createChatModel({
      GOOGLE_GENERATIVE_AI_API_KEY: "google-key",
      PROMPTFOLIO_MODEL: "anthropic:claude-haiku-5-5",
    });

    expect(result).toEqual({
      ok: false,
      problem: "PROMPTFOLIO_MODEL selects anthropic, but ANTHROPIC_API_KEY is not set",
    });
  });

  it.each(["openai:gpt-5", "gemini-3.8-flash", "toString:x"])(
    "rejects an unknown provider in %s",
    (setting) => {
      const result = createChatModel({ ...bothKeys, PROMPTFOLIO_MODEL: setting });

      expect(result.ok).toBe(false);
      expect(!result.ok && result.problem).toContain('PROMPTFOLIO_MODEL must be "provider:model"');
    },
  );
});

describe("createChatModel without PROMPTFOLIO_MODEL", () => {
  it("reports a missing API key instead of throwing", () => {
    expect(createChatModel({})).toEqual({
      ok: false,
      problem: "no model API key is set (GOOGLE_GENERATIVE_AI_API_KEY or ANTHROPIC_API_KEY)",
    });
    expect(createChatModel({ ANTHROPIC_API_KEY: "   " }).ok).toBe(false);
  });

  it("uses the first provider whose key is set, with its default model", () => {
    const both = createChatModel(bothKeys);
    const anthropicOnly = createChatModel({ ANTHROPIC_API_KEY: "anthropic-key" });

    expect(both.ok && [both.provider, both.modelId]).toEqual(["google", "gemini-3.8-flash"]);
    expect(anthropicOnly.ok && [anthropicOnly.provider, anthropicOnly.modelId]).toEqual([
      "anthropic",
      "claude-haiku-5-5",
    ]);
  });
});
