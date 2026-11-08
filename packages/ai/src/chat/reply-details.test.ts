import { loadStructuredProfile, type Profile } from "@promptfolio/core";
import {
  readUIMessageStream,
  simulateReadableStream,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { handleChatRequest } from "./chat-handler.ts";
import { createFailoverModel } from "./failover.ts";
import { type ChatHistory, createMemoryChatStore, loadVisitorChat } from "./history.ts";
import type { ReplyDetails } from "./reply-details.ts";

type StreamResult = Awaited<ReturnType<MockLanguageModelV4["doStream"]>>;
type StreamPart = StreamResult["stream"] extends ReadableStream<infer P> ? P : never;

/** Written by the model into tool arguments. */
const ARGUMENT_MARKER = "ARGUMENT-MARKER-29";
/** In the profile, so it appears in tool results. */
const RESULT_MARKER = "RESULT-MARKER-57";
/** A tool the server does not have. */
const INVENTED_TOOL = "sendInventedEmail";
/** The id the provider reports, which visitors must not see as it is. */
const PROVIDER_MODEL_ID = "provider-model-id-7";

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 4, text: 4, reasoning: 0 },
};

function testProfile(): Profile {
  const result = loadStructuredProfile(
    {
      schemaVersion: 1,
      identity: { name: "Jordan Example", headline: "Engineer", summary: "Builds web apps." },
      projects: [
        {
          id: "service-catalog",
          name: "Service Catalog",
          description: `An internal catalog. ${RESULT_MARKER}`,
          skills: ["TypeScript"],
        },
      ],
    },
    { sourceId: "owner-profile", label: "Test profile", observedAt: new Date("2026-10-01") },
  );
  if (!result.ok) throw new Error("test profile is invalid");
  return result.profile;
}

const listInput = JSON.stringify({ section: "projects", skill: ARGUMENT_MARKER });

/** A step with every kind of call: streamed, found, not found, invented, and invalid. */
const lookupStep: StreamPart[] = [
  { type: "stream-start", warnings: [] },
  // Streamed arguments, as most providers send them.
  { type: "tool-input-start", id: "c-list", toolName: "listProfileRecords" },
  { type: "tool-input-delta", id: "c-list", delta: listInput },
  { type: "tool-input-end", id: "c-list" },
  { type: "tool-call", toolCallId: "c-list", toolName: "listProfileRecords", input: listInput },
  {
    type: "tool-call",
    toolCallId: "c-found",
    toolName: "getProfileRecord",
    input: JSON.stringify({ id: "service-catalog" }),
  },
  {
    type: "tool-call",
    toolCallId: "c-missing",
    toolName: "getProfileRecord",
    input: JSON.stringify({ id: `missing-${ARGUMENT_MARKER.toLowerCase()}` }),
  },
  {
    type: "tool-call",
    toolCallId: "c-invented",
    toolName: INVENTED_TOOL,
    input: JSON.stringify({ to: ARGUMENT_MARKER }),
  },
  {
    type: "tool-call",
    toolCallId: "c-invalid",
    toolName: "listProfileRecords",
    input: JSON.stringify({ section: ARGUMENT_MARKER }),
  },
  { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_use" }, usage },
];

const answerStep: StreamPart[] = [
  { type: "stream-start", warnings: [] },
  { type: "response-metadata", modelId: PROVIDER_MODEL_ID },
  { type: "text-start", id: "t1" },
  { type: "text-delta", id: "t1", delta: "Jordan built the Service Catalog." },
  { type: "text-end", id: "t1" },
  { type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage },
];

function lookupModel() {
  return new MockLanguageModelV4({
    doStream: [lookupStep, answerStep].map((chunks) => ({
      stream: simulateReadableStream({ chunks }),
    })),
  });
}

const REPLY_DETAILS: ReplyDetails = {
  tools: true,
  model: (id) => (id === PROVIDER_MODEL_ID ? "Shown Model" : undefined),
};

const CHAT_ID = "chat-1";

/** Runs one question and returns the visitor's chunks and the store it was saved in. */
async function ask({
  replyDetails,
  model = lookupModel(),
}: {
  replyDetails?: ReplyDetails;
  model?: MockLanguageModelV4 | ReturnType<typeof createFailoverModel>;
} = {}) {
  const history: ChatHistory = {
    store: createMemoryChatStore(),
    identifyOwner: async () => "owner-1",
  };
  const response = await handleChatRequest(
    new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: CHAT_ID,
        message: {
          id: "u1",
          role: "user",
          parts: [{ type: "text", text: "What did they build?" }],
        },
        parentId: null,
      }),
    }),
    {
      model,
      profile: testProfile(),
      limit: null,
      history,
      ...(replyDetails && { replyDetails }),
      logger: { info: vi.fn(), error: vi.fn() },
    },
  );
  const body = await response.text();
  const chunks: UIMessageChunk[] = body
    .split("\n")
    .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .map((line) => JSON.parse(line.slice("data: ".length)));
  return { body, chunks, history };
}

/** The answer the browser builds from the chunks, as the AI SDK's `useChat` does. */
async function builtAnswer(chunks: UIMessageChunk[]): Promise<UIMessage | undefined> {
  let last: UIMessage | undefined;
  for await (const message of readUIMessageStream({ stream: simulateReadableStream({ chunks }) })) {
    last = message;
  }
  return last;
}

/** What the browser renders of a message, without fields only the live stream sets. */
function rendered(message: UIMessage | undefined) {
  return {
    metadata: message?.metadata,
    parts: (message?.parts ?? []).flatMap((part): Array<Record<string, unknown>> => {
      if (part.type === "text") return [{ type: "text", text: part.text }];
      if (part.type.startsWith("tool-") && "toolCallId" in part) {
        const { type, toolCallId, state } = part;
        return [
          {
            type,
            toolCallId,
            state,
            input: part.input,
            output: "output" in part ? part.output : undefined,
          },
        ];
      }
      return [];
    }),
  };
}

describe("replyDetails.tools", () => {
  it("sends each lookup with trimmed content, and nothing the model wrote or the result held", async () => {
    const { body, chunks } = await ask({ replyDetails: REPLY_DETAILS });

    expect(body).not.toContain(ARGUMENT_MARKER);
    expect(body).not.toContain(RESULT_MARKER);
    expect(body).not.toContain(INVENTED_TOOL);
    expect(body).not.toContain(PROVIDER_MODEL_ID);
    expect(chunks.some((chunk) => chunk.type === "tool-input-delta")).toBe(false);

    const outputs = Object.fromEntries(
      chunks.flatMap((chunk) =>
        chunk.type === "tool-output-available" ? [[chunk.toolCallId, chunk.output]] : [],
      ),
    );
    expect(outputs).toEqual({
      "c-list": { status: "listed" },
      "c-found": { status: "found", title: "Service Catalog" },
      "c-missing": { status: "not_found" },
      "c-invalid": { status: "failed" },
    });
    const inputs = Object.fromEntries(
      chunks.flatMap((chunk) =>
        chunk.type === "tool-input-available" ? [[chunk.toolCallId, chunk.input]] : [],
      ),
    );
    expect(inputs).toEqual({
      "c-list": { section: "projects", skillFilter: true },
      "c-found": {},
      "c-missing": {},
      "c-invalid": {},
    });
  });

  it("sends a call's start before its result, also when the provider streamed no arguments", async () => {
    const { chunks } = await ask({ replyDetails: REPLY_DETAILS });
    const position = (type: string, id: string) =>
      chunks.findIndex(
        (chunk) => chunk.type === type && "toolCallId" in chunk && chunk.toolCallId === id,
      );

    for (const id of ["c-list", "c-found", "c-missing", "c-invalid"]) {
      const start = position("tool-input-start", id);
      expect(start).toBeGreaterThanOrEqual(0);
      expect(start).toBeLessThan(position("tool-output-available", id));
    }
    // One start per call, even though the provider sent its own for c-list.
    expect(chunks.filter((chunk) => chunk.type === "tool-input-start")).toHaveLength(4);
  });

  it("sends no tool chunk and no model when the option is off, and still saves the full results", async () => {
    const { chunks, history } = await ask();

    expect(chunks.filter((chunk) => chunk.type.startsWith("tool-"))).toEqual([]);
    expect(chunks.find((chunk) => chunk.type === "finish")).toEqual({
      type: "finish",
      finishReason: "stop",
    });
    const stored = await history.store.load("owner-1", CHAT_ID);
    expect(JSON.stringify(stored)).toContain(RESULT_MARKER);
    expect(stored?.at(-1)?.metadata).toEqual({ modelId: PROVIDER_MODEL_ID });
  });
});

describe("replyDetails.model", () => {
  it("sends the display name on finish, and no metadata when the name is hidden", async () => {
    const { chunks } = await ask({ replyDetails: REPLY_DETAILS });
    expect(chunks.find((chunk) => chunk.type === "finish")).toEqual({
      type: "finish",
      finishReason: "stop",
      messageMetadata: { model: "Shown Model" },
    });

    const { chunks: hidden } = await ask({ replyDetails: { model: () => undefined } });
    expect(hidden.find((chunk) => chunk.type === "finish")).not.toHaveProperty("messageMetadata");
  });

  it("names a failover entry by its label when its provider reports no id", async () => {
    const failing = new MockLanguageModelV4({
      doStream: async () => {
        throw new Error("unavailable");
      },
    });
    const model = createFailoverModel({
      models: [
        { label: "first-label", model: failing },
        {
          label: "second-label",
          model: new MockLanguageModelV4({
            doStream: async () => ({
              stream: simulateReadableStream({
                chunks: answerStep.filter((part) => part.type !== "response-metadata"),
              }),
            }),
          }),
        },
      ],
      attemptFirstChunkMs: 1_000,
      logger: { info: vi.fn(), error: vi.fn() },
    });
    const { chunks } = await ask({ model, replyDetails: { model: (id) => `name:${id}` } });

    expect(chunks.find((chunk) => chunk.type === "finish")).toMatchObject({
      messageMetadata: { model: "name:second-label" },
    });
  });
});

describe("loadVisitorChat with replyDetails", () => {
  it("shows a reloaded chat as the live stream did, with nothing more", async () => {
    const { chunks, history } = await ask({ replyDetails: REPLY_DETAILS });
    const live = await builtAnswer(chunks);

    const reloaded = await loadVisitorChat(new Request("http://localhost/"), CHAT_ID, {
      history,
      replyDetails: REPLY_DETAILS,
      profile: testProfile(),
    });

    expect(reloaded).toHaveLength(2);
    expect(rendered(reloaded?.[1])).toEqual(rendered(live));
    expect(rendered(live).parts).toHaveLength(5);
    const shown = JSON.stringify(reloaded);
    expect(shown).not.toContain(ARGUMENT_MARKER);
    expect(shown).not.toContain(RESULT_MARKER);
    expect(shown).not.toContain(INVENTED_TOOL);
    expect(shown).not.toContain(PROVIDER_MODEL_ID);
  });

  it("shows text only without replyDetails", async () => {
    const { history } = await ask({ replyDetails: REPLY_DETAILS });
    const reloaded = await loadVisitorChat(new Request("http://localhost/"), CHAT_ID, { history });

    expect(reloaded?.[1]).toEqual({
      id: expect.any(String),
      role: "assistant",
      parts: [{ type: "text", text: "Jordan built the Service Catalog." }],
    });
  });
});
