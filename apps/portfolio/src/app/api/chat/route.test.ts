import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `server-only` throws outside a React Server Components build; tests run in plain Node.
vi.mock("server-only", () => ({}));

const createChatModel = vi.fn();
vi.mock("@/server/chat/model", () => ({ createChatModel }));

const loadAppProfile = vi.fn();
vi.mock("@/server/profile/profile", () => ({ loadAppProfile }));

vi.mock("@upstash/redis", async () => {
  const { FakeRedis } = await import("@/test/fake-redis");
  return { Redis: FakeRedis };
});

const { fakeRedis } = await import("@/test/fake-redis");
/** Every key the app asks Redis to count, and how often. */
const redisCounts = fakeRedis.counts;

const { POST } = await import("./route");
const chats = await import("../chats/route");
const chat = await import("../chats/[id]/route");

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

const firstQuestion = { id: "chat-1", message: userMessage(), parentId: null };

function chatRequest(body: unknown = firstQuestion, address = "203.0.113.7", cookie?: string) {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": address,
      ...(cookie && { cookie }),
    },
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
  fakeRedis.reset();
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
    const response = await POST(chatRequest({ id: "chat-1", message: null, parentId: null }));

    expect(response.status).toBe(400);
    expect(redisCounts.size).toBe(0);
  });

  it("gives 503 with no model call when no address can be read", async () => {
    const response = await POST(chatRequest(undefined, "unknown"));

    expect(response.status).toBe(503);
    expect(model.doStreamCalls).toHaveLength(0);
  });

  it("gives 503 with no model call when the store fails, and keeps its error out of the log", async () => {
    fakeRedis.fails = true;

    const response = await POST(chatRequest());

    expect(response.status).toBe(503);
    expect(model.doStreamCalls).toHaveLength(0);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("redis_test_token");
  });
});

describe("conversations kept on the server", () => {
  beforeEach(configureLimit);

  /** The owner cookie a response sets, as a `Cookie` request header. */
  function cookieFrom(response: Response): string {
    const setCookie = response.headers.get("set-cookie") ?? "";
    return setCookie.split(";")[0] ?? "";
  }

  function get(url: string, cookie?: string) {
    return new Request(`http://localhost${url}`, { headers: cookie ? { cookie } : {} });
  }

  function change(url: string, method: "PATCH" | "DELETE", cookie: string, body?: unknown) {
    return new Request(`http://localhost${url}`, {
      method,
      headers: { cookie, "content-type": "application/json" },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
  }

  const params = (id: string) => ({ params: Promise.resolve({ id }) });

  async function firstAnswer() {
    const response = await POST(chatRequest());
    await response.text();
    return cookieFrom(response);
  }

  it("gives a new visitor an HttpOnly owner cookie, and keeps the conversation under it", async () => {
    const response = await POST(chatRequest());
    await response.text();

    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/^promptfolio-owner=[A-Za-z0-9_-]{22}; /);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain(`Max-Age=${30 * 24 * 60 * 60}`);
    const owner = cookieFrom(response).split("=")[1] ?? "";
    expect(fakeRedis.strings.has(`chat:history:${owner}:chat-1`)).toBe(true);
    expect(fakeRedis.expiries.get(`chat:history:${owner}:chat-1`)).toBe(30 * 24 * 60 * 60);
  });

  it("keeps the conversation for CHAT_HISTORY_DAYS", async () => {
    vi.stubEnv("CHAT_HISTORY_DAYS", "7");

    const response = await POST(chatRequest());
    await response.text();

    expect(response.headers.get("set-cookie")).toContain(`Max-Age=${7 * 24 * 60 * 60}`);
  });

  it("continues a conversation from the stored history", async () => {
    const cookie = await firstAnswer();
    const opened = await chat.GET(get("/api/chats/chat-1", cookie), params("chat-1"));
    const { messages } = (await opened.json()) as { messages: Array<{ id: string }> };

    const next = await POST(
      chatRequest(
        {
          id: "chat-1",
          message: { id: "u2", role: "user", parts: [{ type: "text", text: "And then?" }] },
          parentId: messages.at(-1)?.id,
        },
        "203.0.113.7",
        cookie,
      ),
    );

    expect(next.status).toBe(200);
    await next.text();
    const prompt = JSON.stringify(model.doStreamCalls.at(-1)?.prompt);
    expect(prompt).toContain("Who is Jordan?");
    expect(prompt).toContain("A live answer.");
  });

  it("lists and opens a visitor's conversation, as text only", async () => {
    const cookie = await firstAnswer();

    const list = await chats.GET(get("/api/chats", cookie));
    const { threads } = (await list.json()) as { threads: Array<{ id: string; title: string }> };
    expect(threads.map((thread) => thread.id)).toEqual(["chat-1"]);

    const opened = await chat.GET(get("/api/chats/chat-1", cookie), params("chat-1"));
    expect(opened.status).toBe(200);
    const body = (await opened.json()) as { messages: Array<{ role: string; parts: unknown[] }> };
    expect(body.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(body.messages.flatMap((message) => message.parts)).toEqual([
      { type: "text", text: "Who is Jordan?" },
      { type: "text", text: "A live answer." },
    ]);
  });

  it("shows another visitor, or a visitor without a cookie, nothing", async () => {
    await firstAnswer();
    const other = await firstAnswer();

    expect(await (await chats.GET(get("/api/chats"))).json()).toEqual({ threads: [] });
    expect((await chat.GET(get("/api/chats/chat-1"), params("chat-1"))).status).toBe(404);
    const otherList = (await (await chats.GET(get("/api/chats", other))).json()) as {
      threads: unknown[];
    };
    // The other visitor has its own chat-1, not the first visitor's.
    expect(otherList.threads).toHaveLength(1);
    const forged = "promptfolio-owner=AAAAAAAAAAAAAAAAAAAAAA";
    expect((await chat.GET(get("/api/chats/chat-1", forged), params("chat-1"))).status).toBe(404);
  });

  it("renames, archives, and deletes a conversation", async () => {
    const cookie = await firstAnswer();

    const renamed = await chat.PATCH(
      change("/api/chats/chat-1", "PATCH", cookie, { title: "About Jordan" }),
      params("chat-1"),
    );
    expect(renamed.status).toBe(204);
    const archived = await chat.PATCH(
      change("/api/chats/chat-1", "PATCH", cookie, { status: "archived" }),
      params("chat-1"),
    );
    expect(archived.status).toBe(204);
    const { threads } = (await (await chats.GET(get("/api/chats", cookie))).json()) as {
      threads: Array<{ title: string; status: string }>;
    };
    expect(threads[0]).toMatchObject({ title: "About Jordan", status: "archived" });

    const deleted = await chat.DELETE(change("/api/chats/chat-1", "DELETE", cookie), params("chat-1"));
    expect(deleted.status).toBe(204);
    expect((await chat.GET(get("/api/chats/chat-1", cookie), params("chat-1"))).status).toBe(404);
    expect([...fakeRedis.strings.keys()].some((key) => key.startsWith("chat:history:"))).toBe(false);
  });

  it("refuses a change from another site, and a change it does not allow", async () => {
    const cookie = await firstAnswer();
    const crossSite = new Request("http://localhost/api/chats/chat-1", {
      method: "DELETE",
      headers: { cookie, "sec-fetch-site": "cross-site" },
    });

    expect((await chat.DELETE(crossSite, params("chat-1"))).status).toBe(403);
    expect(
      (
        await chat.PATCH(
          change("/api/chats/chat-1", "PATCH", cookie, { messages: [] }),
          params("chat-1"),
        )
      ).status,
    ).toBe(400);
    expect(
      (await chat.PATCH(change("/api/chats/x:y", "PATCH", cookie, { title: "t" }), params("x:y")))
        .status,
    ).toBe(404);
  });

  it("answers 503 when the store fails, without its error in the log", async () => {
    const cookie = await firstAnswer();
    fakeRedis.fails = true;

    expect((await chats.GET(get("/api/chats", cookie))).status).toBe(503);
    expect((await chat.GET(get("/api/chats/chat-1", cookie), params("chat-1"))).status).toBe(503);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("redis_test_token");
  });
});
