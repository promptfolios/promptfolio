import { streamText, tool } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

// `server-only` throws outside a React Server Components build; tests run in plain Node.
vi.mock("server-only", () => ({}));

const { createChatModel } = await import("./model");

const bothKeys = { GOOGLE_GENERATIVE_AI_API_KEY: "google-key", ANTHROPIC_API_KEY: "anthropic-key" };
const openRouterKey = { OPENROUTER_API_KEY: "openrouter-key" };
const gatewayKey = { AI_GATEWAY_API_KEY: "gateway-key" };

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

    expect(google.ok && google.modelId).toBe("gemini-3.5-flash-lite");
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

describe("createChatModel with a list of models", () => {
  const list = "google:gemini-3.8-flash, gateway:openai/gpt-4o-mini";
  const keys = { GOOGLE_GENERATIVE_AI_API_KEY: "g", ...gatewayKey };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("makes a failover model that names every entry, and sets what moving on needs", () => {
    const result = createChatModel({ ...keys, PROMPTFOLIO_MODEL: list });

    if (!result.ok) throw new Error(result.problem);
    expect(result.provider).toBe("google");
    expect(result.modelId).toBe("google:gemini-3.8-flash,gateway:openai/gpt-4o-mini");
    expect(result.model.modelId).toBe(result.modelId);
    expect(result.limits?.maxRetries).toBe(0);
    expect(result.limits?.timeouts?.firstChunkMs).toBe(23_000);
  });

  it("keeps each provider's options together", () => {
    const result = createChatModel({
      ...keys,
      ...openRouterKey,
      PROMPTFOLIO_MODEL: "openrouter,google",
    });

    expect(result.ok && result.providerOptions).toEqual({
      openrouter: { reasoning: { effort: "low" } },
      google: { thinkingConfig: { thinkingLevel: "low" } },
    });
  });

  it("keeps a :free suffix when splitting", () => {
    const result = createChatModel({
      ...keys,
      ...openRouterKey,
      PROMPTFOLIO_MODEL: "openrouter:google/gemma-4-31b-it:free,google",
    });

    expect(result.ok && result.modelId).toBe(
      "openrouter:google/gemma-4-31b-it:free,google:gemini-3.5-flash-lite",
    );
  });

  it("skips an entry without a key, and says so naming only the variable", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = createChatModel({ ...keys, PROMPTFOLIO_MODEL: `anthropic,${list}` });

    expect(result.ok && result.provider).toBe("google");
    expect(warn).toHaveBeenCalledWith(
      "[chat] skipping a model: PROMPTFOLIO_MODEL selects anthropic, but ANTHROPIC_API_KEY is not set",
    );
  });

  it("skips an unknown provider, so a typo is reported and does not stop the others", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = createChatModel({ ...keys, PROMPTFOLIO_MODEL: `opnai:x,${list}` });

    expect(result.ok).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('got "opnai:x"'));
  });

  it("uses a single remaining model without a wrapper or changed limits", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = createChatModel({
      GOOGLE_GENERATIVE_AI_API_KEY: "g",
      PROMPTFOLIO_MODEL: list,
    });

    expect(result.ok && result.modelId).toBe("gemini-3.8-flash");
    expect(result.ok && result.limits).toBeUndefined();
  });

  it("reports every problem when no entry can be used", () => {
    const result = createChatModel({ PROMPTFOLIO_MODEL: list });

    expect(result).toEqual({
      ok: false,
      problem:
        "PROMPTFOLIO_MODEL selects google, but GOOGLE_GENERATIVE_AI_API_KEY is not set; PROMPTFOLIO_MODEL selects gateway, but AI_GATEWAY_API_KEY is not set",
    });
  });

  it("uses only the first entry, with no skipping, when failover is off", () => {
    const first = createChatModel({ ...keys, PROMPTFOLIO_MODEL: list }, { failover: false });
    const missing = createChatModel(gatewayKey, { failover: false });
    const missingFirst = createChatModel(
      { ...gatewayKey, PROMPTFOLIO_MODEL: list },
      { failover: false },
    );

    expect(first.ok && first.modelId).toBe("gemini-3.8-flash");
    expect(first.ok && first.limits).toBeUndefined();
    expect(missing.ok).toBe(true);
    expect(missingFirst.ok).toBe(false);
  });

  it("treats a stray comma as no entry", () => {
    const single = createChatModel({ ...keys, PROMPTFOLIO_MODEL: " google , " });
    const blank = createChatModel({ ...keys, PROMPTFOLIO_MODEL: " , " });

    expect(single.ok && single.limits).toBeUndefined();
    expect(blank.ok && blank.provider).toBe("google");
  });
});

describe("createChatModel without PROMPTFOLIO_MODEL", () => {
  it("reports a missing API key instead of throwing", () => {
    expect(createChatModel({})).toEqual({
      ok: false,
      problem:
        "no model API key is set (GOOGLE_GENERATIVE_AI_API_KEY or ANTHROPIC_API_KEY or OPENROUTER_API_KEY or AI_GATEWAY_API_KEY)",
    });
    expect(createChatModel({ ANTHROPIC_API_KEY: "   " }).ok).toBe(false);
  });

  it("uses the first provider whose key is set, with its default model", () => {
    const both = createChatModel(bothKeys);
    const anthropicOnly = createChatModel({ ANTHROPIC_API_KEY: "anthropic-key" });

    expect(both.ok && [both.provider, both.modelId]).toEqual(["google", "gemini-3.5-flash-lite"]);
    expect(anthropicOnly.ok && [anthropicOnly.provider, anthropicOnly.modelId]).toEqual([
      "anthropic",
      "claude-haiku-5-5",
    ]);
  });
});

describe("createChatModel with OpenRouter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("selects the model id after the first colon, keeping a :free suffix", () => {
    const paid = createChatModel({
      ...openRouterKey,
      PROMPTFOLIO_MODEL: "openrouter:anthropic/claude-haiku-5.5",
    });
    const free = createChatModel({
      ...openRouterKey,
      PROMPTFOLIO_MODEL: "openrouter:google/gemma-4-31b-it:free",
    });

    expect(paid.ok && [paid.provider, paid.modelId]).toEqual([
      "openrouter",
      "anthropic/claude-haiku-5.5",
    ]);
    expect(free.ok && free.modelId).toBe("google/gemma-4-31b-it:free");
  });

  it("uses the free default model with low reasoning when only the provider is given", () => {
    const bare = createChatModel({ ...openRouterKey, PROMPTFOLIO_MODEL: "openrouter" });
    const empty = createChatModel({ ...openRouterKey, PROMPTFOLIO_MODEL: "openrouter:" });

    expect(bare.ok && bare.modelId).toBe("google/gemma-4-31b-it:free");
    expect(empty.ok && empty.modelId).toBe("google/gemma-4-31b-it:free");
    expect(bare.ok && bare.providerOptions).toEqual({
      openrouter: { reasoning: { effort: "low" } },
    });
  });

  it("reports a missing OPENROUTER_API_KEY", () => {
    expect(createChatModel({ ...bothKeys, PROMPTFOLIO_MODEL: "openrouter" })).toEqual({
      ok: false,
      problem: "PROMPTFOLIO_MODEL selects openrouter, but OPENROUTER_API_KEY is not set",
    });
  });

  it("comes last in the fallback order", () => {
    const only = createChatModel(openRouterKey);
    const withGoogle = createChatModel({ ...openRouterKey, GOOGLE_GENERATIVE_AI_API_KEY: "g" });

    expect(only.ok && [only.provider, only.modelId]).toEqual([
      "openrouter",
      "google/gemma-4-31b-it:free",
    ]);
    expect(withGoogle.ok && withGoogle.provider).toBe("google");
  });

  it("sends the model id, low reasoning, tools, and key in the request", async () => {
    const requests: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
    const sse = [
      {
        id: "gen-1",
        model: "m",
        choices: [{ index: 0, delta: { role: "assistant", content: "Hi" } }],
      },
      { id: "gen-1", model: "m", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    ]
      .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
      .concat("data: [DONE]\n\n")
      .join("");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        requests.push({
          url: String(url),
          headers: new Headers(init?.headers),
          body: JSON.parse(String(init?.body)),
        });
        return new Response(sse, { headers: { "content-type": "text/event-stream" } });
      }),
    );
    const created = createChatModel({
      ...openRouterKey,
      PROMPTFOLIO_MODEL: "openrouter:google/gemma-4-31b-it:free",
    });
    if (!created.ok) throw new Error(created.problem);

    const result = streamText({
      model: created.model,
      providerOptions: created.providerOptions,
      prompt: "Hello",
      tools: {
        listProfile: tool({ description: "List the profile", inputSchema: z.object({}) }),
      },
      maxRetries: 0,
    });

    expect(await result.text).toBe("Hi");
    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request?.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(request?.headers.get("authorization")).toBe("Bearer openrouter-key");
    expect(request?.body).toMatchObject({
      model: "google/gemma-4-31b-it:free",
      reasoning: { effort: "low" },
      tools: [{ type: "function", function: { name: "listProfile" } }],
    });
  });
});

describe("createChatModel with AI Gateway", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("selects the provider and model from gateway:vendor/model", () => {
    const result = createChatModel({
      ...gatewayKey,
      PROMPTFOLIO_MODEL: "gateway:anthropic/claude-haiku-5.5",
    });

    expect(result.ok && [result.provider, result.modelId]).toEqual([
      "gateway",
      "anthropic/claude-haiku-5.5",
    ]);
  });

  it("uses the $0 default model and per-vendor low reasoning when only the provider is given", () => {
    const bare = createChatModel({ ...gatewayKey, PROMPTFOLIO_MODEL: "gateway" });
    const empty = createChatModel({ ...gatewayKey, PROMPTFOLIO_MODEL: "gateway:" });

    expect(bare.ok && bare.modelId).toBe("nvidia/nemotron-3.5-lightning-free");
    expect(empty.ok && empty.modelId).toBe("nvidia/nemotron-3.5-lightning-free");
    expect(bare.ok && bare.providerOptions).toEqual({
      anthropic: { effort: "low" },
      google: { thinkingConfig: { thinkingLevel: "low" } },
    });
  });

  it("reports a missing AI_GATEWAY_API_KEY", () => {
    expect(createChatModel({ ...openRouterKey, PROMPTFOLIO_MODEL: "gateway" })).toEqual({
      ok: false,
      problem: "PROMPTFOLIO_MODEL selects gateway, but AI_GATEWAY_API_KEY is not set",
    });
  });

  it("comes last in the fallback order", () => {
    const only = createChatModel(gatewayKey);
    const withOpenRouter = createChatModel({ ...gatewayKey, ...openRouterKey });

    expect(only.ok && [only.provider, only.modelId]).toEqual([
      "gateway",
      "nvidia/nemotron-3.5-lightning-free",
    ]);
    expect(withOpenRouter.ok && withOpenRouter.provider).toBe("openrouter");
  });

  it("sends the model id, provider options, tools, and key to the gateway", async () => {
    const requests: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        requests.push({
          url: String(url),
          headers: new Headers(init?.headers),
          body: JSON.parse(String(init?.body)),
        });
        return new Response(JSON.stringify({ error: { message: "stubbed", type: "test" } }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    const created = createChatModel({
      ...gatewayKey,
      PROMPTFOLIO_MODEL: "gateway:anthropic/claude-haiku-5.5",
    });
    if (!created.ok) throw new Error(created.problem);

    const result = streamText({
      model: created.model,
      providerOptions: created.providerOptions,
      prompt: "Hello",
      tools: {
        listProfile: tool({ description: "List the profile", inputSchema: z.object({}) }),
      },
      maxRetries: 0,
      onError: () => {},
    });
    await result.consumeStream();

    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request?.url).toBe("https://ai-gateway.vercel.sh/v4/ai/language-model");
    expect(request?.headers.get("authorization")).toBe("Bearer gateway-key");
    expect(request?.headers.get("ai-language-model-id")).toBe("anthropic/claude-haiku-5.5");
    expect(request?.body).toMatchObject({
      providerOptions: { anthropic: { effort: "low" } },
      tools: [{ type: "function", name: "listProfile" }],
    });
    expect(request?.body.providerOptions).not.toHaveProperty("gateway");
  });
});
