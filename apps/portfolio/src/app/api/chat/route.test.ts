import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `server-only` throws outside a React Server Components build; tests run in plain Node.
vi.mock("server-only", () => ({}));

const createChatModel = vi.fn();
vi.mock("@/server/model", () => ({ createChatModel }));

const loadAppProfile = vi.fn();
vi.mock("@/server/profile", () => ({ loadAppProfile }));

/** Every key the app asks Redis to count, and how often. */
const redisCounts = new Map<string, number>();
let redisFails = false;
vi.mock("@upstash/redis", () => ({
  Redis: class {
    multi() {
      let key = "";
      const transaction = {
        incr: (name: string) => {
          key = name;
          return transaction;
        },
        expire: () => transaction,
        exec: async () => {
          if (redisFails) throw new Error("store down with redis_test_token");
          const count = (redisCounts.get(key) ?? 0) + 1;
          redisCounts.set(key, count);
          return [count, 1];
        },
      };
      return transaction;
    }
  },
}));

const { POST } = await import("./route");

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 4, text: 4, reasoning: 0 },
};

function answeringModel() {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: "A live answer." },
          { type: "text-end", id: "t1" },
          { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
        ],
      }),
    }),
  });
}

function chatRequest(body: unknown = { messages: [userMessage()] }, address = "203.0.113.7") {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": address },
    body: JSON.stringify(body),
  });
}

function userMessage() {
  return { id: "u1", role: "user", parts: [{ type: "text", text: "Who is Jordan?" }] };
}

const profile = {
  ok: true,
  warnings: [],
  profile: {
    identity: {
      name: "Jordan Example",
      headline: "Engineer",
      summary: "Builds things.",
      provenance: { basis: "self-reported", sourceId: "owner", observedAt: "2026-10-01" },
    },
    experience: [],
    projects: [],
    repositories: [],
    contributions: [],
    education: [],
    skills: [],
    links: [],
    sources: [],
  },
};

let model: MockLanguageModelV4;

function configureLimit() {
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://store.example.test");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "redis_test_token");
  vi.stubEnv("VISITOR_HASH_SECRET", "s".repeat(32));
}

beforeEach(() => {
  redisCounts.clear();
  redisFails = false;
  model = answeringModel();
  createChatModel.mockReturnValue({ ok: true, model, providerOptions: {} });
  loadAppProfile.mockResolvedValue({ fileName: "test.json", result: profile });
  for (const name of [
    "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN",
    "VISITOR_HASH_SECRET",
    "RESEND_API_KEY",
    "CONTACT_TO_EMAIL",
    "CONTACT_FROM_EMAIL",
    "CONTACT_TOKEN_SECRET",
  ]) {
    vi.stubEnv(name, "");
  }
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/chat: configuration problems", () => {
  it("gives a generic 500 without a model, and names the problem only in the log", async () => {
    createChatModel.mockReturnValue({ ok: false, problem: "ANTHROPIC_API_KEY is not set" });

    const response = await POST(chatRequest());

    expect(response.status).toBe(500);
    expect(await response.text()).toBe("The assistant is not available right now.");
    expect(vi.mocked(console.error).mock.calls[0]?.[0]).toContain("ANTHROPIC_API_KEY");
  });

  it("gives a generic 500 when the profile cannot be loaded, naming only the file in the log", async () => {
    loadAppProfile.mockResolvedValue({
      fileName: "test.json",
      result: { ok: false, issues: [{ path: "identity", message: "a private detail" }] },
    });

    const response = await POST(chatRequest());

    expect(response.status).toBe(500);
    expect(await response.text()).toBe("The assistant is not available right now.");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("a private detail");
  });

  it("refuses a live answer outside development when the limit is not configured", async () => {
    const response = await POST(chatRequest());

    expect(response.status).toBe(503);
    expect(await response.text()).toMatch(/^The assistant could not answer right now\./);
    expect(model.doStreamCalls).toHaveLength(0);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).toContain("UPSTASH_REDIS_REST_URL");
  });

  it("answers in development without a limit", async () => {
    vi.stubEnv("NODE_ENV", "development");

    const response = await POST(chatRequest());

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("A live answer.");
  });
});

describe("POST /api/chat: the daily limit", () => {
  beforeEach(configureLimit);

  it("counts a live answer under a hash, and never stores the address", async () => {
    const response = await POST(chatRequest());

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("A live answer.");
    const keys = [...redisCounts.keys()];
    expect(keys).toHaveLength(2);
    expect(keys).toContain("chat:turns:site");
    expect(keys.join()).not.toContain("203.0.113.7");
  });

  it("refuses the 31st answer for an address without calling the model", async () => {
    for (let turn = 0; turn < 30; turn += 1) {
      const allowed = await POST(chatRequest());
      expect(allowed.status).toBe(200);
      await allowed.text();
    }
    const calls = model.doStreamCalls.length;

    const refused = await POST(chatRequest());

    expect(refused.status).toBe(429);
    expect(await refused.text()).toContain("daily limit");
    expect(model.doStreamCalls).toHaveLength(calls);
  });

  it("never reaches the store for an invalid request", async () => {
    const response = await POST(chatRequest({ messages: [] }));

    expect(response.status).toBe(400);
    expect(redisCounts.size).toBe(0);
  });

  it("gives 503 with no model call when no address can be read", async () => {
    const response = await POST(chatRequest(undefined, "unknown"));

    expect(response.status).toBe(503);
    expect(model.doStreamCalls).toHaveLength(0);
  });

  it("gives 503 with no model call when the store fails, and keeps its error out of the log", async () => {
    redisFails = true;

    const response = await POST(chatRequest());

    expect(response.status).toBe(503);
    expect(model.doStreamCalls).toHaveLength(0);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("redis_test_token");
  });
});
