import { readdirSync, readFileSync } from "node:fs";
import type { ContactEmail, ContactPrepared, ContactSendLimiter } from "@promptfolio/contact";
import { parseGitHubSnapshot } from "@promptfolio/source-github";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { createConsumer, loadProfile, memoryLimiter, refreshSnapshot } from "./consumer";
import snapshotData from "./data/github-snapshot.json";

type StreamResult = Awaited<ReturnType<MockLanguageModelV4["doStream"]>>;
type StreamPart = StreamResult["stream"] extends ReadableStream<infer P> ? P : never;

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 4, text: 4, reasoning: 0 },
};

/** A model that looks up the repositories once, then answers. */
function lookupModel() {
  const stream = (chunks: StreamPart[]) => ({ stream: simulateReadableStream({ chunks }) });
  return new MockLanguageModelV4({
    doStream: [
      stream([
        { type: "stream-start", warnings: [] },
        {
          type: "tool-call",
          toolCallId: "call-1",
          toolName: "listProfileRecords",
          input: JSON.stringify({ section: "repositories" }),
        },
        { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_use" }, usage },
      ]),
      stream([
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: "Avery wrote reports." },
        { type: "text-end", id: "t1" },
        { type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage },
      ]),
    ],
  });
}

const openLimiter: ContactSendLimiter = {
  claim: async () => "claimed",
  release: async () => {},
};

function setup(allowance = 30) {
  const sent: ContactEmail[] = [];
  const model = lookupModel();
  const consumer = createConsumer({
    model,
    profile: loadProfile(snapshotData),
    limiter: memoryLimiter(allowance),
    contact: {
      limiter: openLimiter,
      tokenSecret: "test-secret-that-is-long-enough-to-sign-with",
      sender: {
        send: async (email) => {
          sent.push(email);
          return { status: "sent", id: "email-1" };
        },
      },
    },
  });
  return { consumer, model, sent };
}

function post(url: string, body: unknown): Request {
  return new Request(`http://localhost${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-visitor": "visitor-1" },
    body: JSON.stringify(body),
  });
}

function chatRequest(): Request {
  return post("/chat", {
    id: "chat-1",
    message: { id: "u1", role: "user", parts: [{ type: "text", text: "What has Avery built?" }] },
    parentId: null,
  });
}

async function chunksOf(response: Response): Promise<Array<Record<string, unknown>>> {
  return (await response.text())
    .split("\n")
    .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .map((line) => JSON.parse(line.slice("data: ".length)));
}

describe("a second consumer, through public APIs only", () => {
  it("answers from its own profile and GitHub data, with tool activity hidden", async () => {
    const { consumer } = setup();

    const response = await consumer.chat(chatRequest());

    expect(response.status).toBe(200);
    const chunks = await chunksOf(response);
    const text = chunks.flatMap((chunk) => (chunk.type === "text-delta" ? [chunk.delta] : []));
    expect(text.join("")).toContain("Avery wrote reports");
    expect(chunks.some((chunk) => String(chunk.type).startsWith("tool-"))).toBe(false);
  });

  it("keeps the conversation on the server, and shows it again as text only", async () => {
    const { consumer } = setup();
    await (await consumer.chat(chatRequest())).text();

    const shown = await consumer.openChat(post("/chats/chat-1", {}), "chat-1");

    expect(shown?.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(JSON.stringify(shown)).not.toContain("tool-");
    expect(JSON.stringify(shown)).toContain("Avery wrote reports");
  });

  it("applies its own limiter before any model call", async () => {
    const { consumer, model } = setup(0);

    const response = await consumer.chat(chatRequest());

    expect(response.status).toBe(429);
    expect(model.doStreamCalls).toHaveLength(0);
  });

  it("sends a confirmed contact message only to its own recipient", async () => {
    const { consumer, sent } = setup();

    const prepared = await consumer.prepareContact(
      post("/contact/prepare", {
        name: "Sam Visitor",
        email: "sam@example.test",
        message: "Hello, I would like to talk about a role.",
      }),
    );
    const { token } = (await prepared.json()) as ContactPrepared;
    expect(sent).toHaveLength(0);

    const response = await consumer.sendContact(post("/contact/send", { token }));

    expect(response.status).toBe(200);
    expect(sent.map((email) => email.to)).toEqual(["avery@example.test"]);
  });
});

describe("its refresh", () => {
  const previous = parseGitHubSnapshot(snapshotData);
  if (!previous.ok) throw new Error("the snapshot fixture is invalid");

  /** Answers like GitHub for an account with one repository, without a token. */
  const github = (async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname;
    const json = (body: unknown) => new Response(JSON.stringify(body));
    if (path === "/users/avery-sample") {
      return json({
        login: "avery-sample",
        type: "User",
        html_url: "https://github.com/avery-sample",
      });
    }
    if (path === "/users/avery-sample/repos") {
      return json([
        {
          name: "harbor-maps",
          full_name: "avery-sample/harbor-maps",
          private: false,
          html_url: "https://github.com/avery-sample/harbor-maps",
          description: "Maps of a harbor.",
          homepage: null,
          language: "Python",
          topics: [],
          fork: false,
          archived: false,
          created_at: "2025-01-01T00:00:00Z",
          pushed_at: "2026-10-01T00:00:00Z",
          license: null,
          stargazers_count: 0,
        },
      ]);
    }
    if (path.endsWith("/languages")) return json({ Python: 100 });
    if (path.endsWith("/readme")) return new Response("# Harbor Maps\n");
    if (path === "/search/commits") {
      return json({ total_count: 0, incomplete_results: false, items: [] });
    }
    throw new Error(`unexpected request: ${path}`);
  }) as typeof fetch;

  it("replaces the snapshot with what it fetched", async () => {
    const snapshot = await refreshSnapshot(previous.snapshot, github);

    expect(snapshot?.repositories.map((repository) => repository.name)).toEqual(["harbor-maps"]);
    if (!snapshot) throw new Error("expected a snapshot");
    expect(loadProfile(snapshot).repositories.map((repository) => repository.id)).toEqual([
      "github.com/avery-sample/harbor-maps",
    ]);
  });

  it("keeps the previous snapshot when GitHub cannot be read", async () => {
    const down = (async () => new Response("{}", { status: 500 })) as typeof fetch;

    expect(await refreshSnapshot(previous.snapshot, down)).toBe(previous.snapshot);
  });
});

describe("its imports", () => {
  it("uses only the packages' public entry points and nothing from the reference app", () => {
    const directory = new URL("./", import.meta.url);
    const sources = readdirSync(directory)
      .filter((name) => name.endsWith(".ts"))
      .map((name) => readFileSync(new URL(name, directory), "utf8"));
    const specifiers = sources.flatMap((source) =>
      [...source.matchAll(/from "([^"]+)"/g)].map((match) => match[1] ?? ""),
    );

    const packages = specifiers.filter((specifier) => specifier.startsWith("@promptfolio/"));
    expect(packages.length).toBeGreaterThan(0);
    expect(packages.every((specifier) => /^@promptfolio\/[a-z-]+$/.test(specifier))).toBe(true);
    expect(specifiers.some((specifier) => specifier.includes("portfolio/"))).toBe(false);
  });
});
