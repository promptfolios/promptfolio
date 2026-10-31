import { handleChatRequest } from "@promptfolio/ai";
import { loadStructuredProfile } from "@promptfolio/core";
import { readUIMessageStream, simulateReadableStream, type UIMessageChunk } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { createMemoryStorage } from "./browser-storage";
import { ThreadStore } from "./thread-store";

type StreamResult = Awaited<ReturnType<MockLanguageModelV4["doStream"]>>;
type StreamPart = StreamResult["stream"] extends ReadableStream<infer P> ? P : never;

const answer: StreamPart[] = [
  { type: "stream-start", warnings: [] },
  { type: "text-start", id: "t1" },
  { type: "text-delta", id: "t1", delta: "Sure." },
  { type: "text-end", id: "t1" },
  {
    type: "finish",
    finishReason: { unified: "stop", raw: "end_turn" },
    usage: {
      inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 1, text: 1, reasoning: 0 },
    },
  },
];

function profile() {
  const result = loadStructuredProfile(
    { schemaVersion: 1, identity: { name: "Jordan Example", headline: "Engineer", summary: "x" } },
    { sourceId: "owner-profile", label: "Test profile", observedAt: new Date("2026-10-01") },
  );
  if (!result.ok) throw new Error("test profile is invalid");
  return result.profile;
}

describe("a restored thread and the server", () => {
  it("is accepted by the server's request validation when continued", async () => {
    const store = new ThreadStore({ storage: createMemoryStorage(), warn: () => {} });
    store.createThread("t1");
    store.saveMessage("t1", {
      id: "u1",
      parentId: null,
      role: "user",
      parts: [{ type: "text", text: "What projects?" }],
    });
    // Whatever the runtime hands over, only what the server accepts is kept.
    store.saveMessage("t1", {
      id: "a1",
      parentId: "u1",
      role: "assistant",
      parts: [
        { type: "step-start" },
        { type: "tool-listProfileRecords", toolCallId: "c1", state: "output-available" },
        { type: "text", text: "Two projects.", providerMetadata: { google: {} } },
      ],
    });

    const restored = store.loadMessages("t1").map(({ id, role, parts }) => ({ id, role, parts }));
    expect(restored).toEqual([
      { id: "u1", role: "user", parts: [{ type: "text", text: "What projects?" }] },
      {
        id: "a1",
        role: "assistant",
        parts: [{ type: "step-start" }, { type: "text", text: "Two projects." }],
      },
    ]);
    const model = new MockLanguageModelV4({
      doStream: async () => ({ stream: simulateReadableStream({ chunks: answer }) }),
    });
    const request = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "t1",
        trigger: "submit-message",
        messages: [
          ...restored,
          { id: "u2", role: "user", parts: [{ type: "text", text: "Tell me more." }] },
        ],
      }),
    });
    const logger = { info: () => {}, warn: () => {}, error: () => {} };

    const response = await handleChatRequest(request, {
      model,
      profile: profile(),
      logger,
      limit: null,
    });
    await response.text();

    expect(response.status).toBe(200);
    expect(model.doStreamCalls).toHaveLength(1);
  });
});

describe("an answer's sources in a saved thread", () => {
  const sources = {
    sources: [
      {
        id: "service-catalog",
        record: "Service Catalog",
        evidence: [
          { basis: "self-reported", source: "Test", observedAt: "2026-10-01T00:00:00.000Z" },
        ],
      },
    ],
    unverifiedCitations: 0,
  };

  function saved(parts: unknown[]) {
    const store = new ThreadStore({ storage: createMemoryStorage(), warn: () => {} });
    store.createThread("t1");
    store.saveMessage("t1", {
      id: "u1",
      parentId: null,
      role: "user",
      parts: [{ type: "text", text: "Projects?" }],
    });
    store.saveMessage("t1", { id: "a1", parentId: "u1", role: "assistant", parts });
    return store.loadMessages("t1").map(({ id, role, parts: kept }) => ({ id, role, parts: kept }));
  }

  it("survives a reload, and the server accepts the thread when it is continued", async () => {
    const restored = saved([
      { type: "text", text: "A catalog [service-catalog]." },
      { type: "data-sources", id: "sources", data: sources, extra: "dropped" },
    ]);

    expect(restored[1]?.parts).toEqual([
      { type: "text", text: "A catalog [service-catalog]." },
      { type: "data-sources", id: "sources", data: sources },
    ]);

    const model = new MockLanguageModelV4({
      doStream: async () => ({ stream: simulateReadableStream({ chunks: answer }) }),
    });
    const response = await handleChatRequest(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: [
            ...restored,
            { id: "u2", role: "user", parts: [{ type: "text", text: "More?" }] },
          ],
        }),
      }),
      { model, profile: profile(), logger: { info: () => {}, error: () => {} }, limit: null },
    );
    await response.text();

    expect(response.status).toBe(200);
    expect(JSON.stringify(model.doStreamCalls[0]?.prompt)).not.toContain("Service Catalog");
  });

  it("is dropped if invalid, and the answer's text is kept", () => {
    const restored = saved([
      { type: "text", text: "A catalog." },
      { type: "data-sources", data: { sources: "not a list" } },
      { type: "data-other", data: {} },
    ]);

    expect(restored[1]?.parts).toEqual([{ type: "text", text: "A catalog." }]);
  });
});

describe("an answer saved in a thread", () => {
  const question = "Give me a short professional overview.";
  const logger = { info: () => {}, error: () => {} };

  function chatRequest(messages: unknown[]): Request {
    return new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "t1", messages }),
    });
  }

  function answeringModel() {
    return new MockLanguageModelV4({
      doStream: async () => ({ stream: simulateReadableStream({ chunks: answer }) }),
    });
  }

  /** The assistant message the browser builds from a response, as `useChat` does. */
  async function receivedMessage(response: Response) {
    const chunks = (await response.text())
      .split("\n")
      .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
      .map((line) => JSON.parse(line.slice("data: ".length)) as UIMessageChunk);
    // Each state is the message so far; the last one is the finished message.
    return lastOf(readUIMessageStream({ stream: streamOf(chunks) }));
  }

  it("is saved, restored, and continued", async () => {
    const firstModel = answeringModel();
    const served = await handleChatRequest(
      chatRequest([{ id: "u1", role: "user", parts: [{ type: "text", text: question }] }]),
      { model: firstModel, profile: profile(), logger, limit: null },
    );
    const received = await receivedMessage(served);
    expect(firstModel.doStreamCalls).toHaveLength(1);

    const store = new ThreadStore({ storage: createMemoryStorage(), warn: () => {} });
    store.createThread("t1");
    store.saveMessage("t1", {
      id: "u1",
      parentId: null,
      role: "user",
      parts: [{ type: "text", text: question }],
    });
    store.saveMessage("t1", {
      id: "a1",
      parentId: "u1",
      role: "assistant",
      parts: received?.parts ?? [],
    });
    const restored = store.loadMessages("t1").map(({ id, role, parts }) => ({ id, role, parts }));
    const text = received?.parts.find((part) => part.type === "text")?.text;
    expect(text).toBeTruthy();
    expect(restored[1]?.parts).toEqual([{ type: "step-start" }, { type: "text", text }]);

    const followUpModel = answeringModel();
    const followUp = await handleChatRequest(
      chatRequest([
        ...restored,
        { id: "u2", role: "user", parts: [{ type: "text", text: "Tell me more." }] },
      ]),
      { model: followUpModel, profile: profile(), logger, limit: null },
    );
    await followUp.text();
    expect(followUp.status).toBe(200);
    expect(followUpModel.doStreamCalls).toHaveLength(1);
  });
});

function streamOf(chunks: UIMessageChunk[]): ReadableStream<UIMessageChunk> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

async function lastOf<T>(iterable: AsyncIterable<T>): Promise<T | undefined> {
  let last: T | undefined;
  for await (const item of iterable) last = item;
  return last;
}
