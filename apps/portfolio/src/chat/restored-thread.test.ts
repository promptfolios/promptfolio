import { handleChatRequest } from "@promptfolio/ai";
import { loadStructuredProfile } from "@promptfolio/core";
import { simulateReadableStream } from "ai";
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

    const response = await handleChatRequest(request, { model, profile: profile(), logger });
    await response.text();

    expect(response.status).toBe(200);
    expect(model.doStreamCalls).toHaveLength(1);
  });
});
