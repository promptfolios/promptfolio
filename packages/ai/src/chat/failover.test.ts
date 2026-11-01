import { loadStructuredProfile, type Profile } from "@promptfolio/core";
import { APICallError, simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { generateStarterQuestions } from "../starters/starters.ts";
import { handleChatRequest } from "./chat-handler.ts";
import { createFailoverModel, type FailoverEntry } from "./failover.ts";

type StreamResult = Awaited<ReturnType<MockLanguageModelV4["doStream"]>>;
type StreamPart = StreamResult["stream"] extends ReadableStream<infer P> ? P : never;

const SECRET = "VISITOR-PRIVATE-TEXT";
const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 4, text: 4, reasoning: 0 },
};
const stop = { unified: "stop", raw: "stop" } as const;

function profile(): Profile {
  const result = loadStructuredProfile(
    { schemaVersion: 1, identity: { name: "Jordan", headline: "Engineer", summary: "Builds." } },
    { sourceId: "owner", label: "Test", observedAt: new Date("2026-10-01") },
  );
  if (!result.ok) throw new Error("test profile is invalid");
  return result.profile;
}

function text(...deltas: string[]): StreamPart[] {
  return [
    { type: "stream-start", warnings: [] },
    { type: "text-start", id: "t" },
    ...deltas.map((delta): StreamPart => ({ type: "text-delta", id: "t", delta })),
    { type: "text-end", id: "t" },
    { type: "finish", finishReason: stop, usage },
  ];
}

function replying(...deltas: string[]) {
  return new MockLanguageModelV4({
    doStream: async () => ({ stream: simulateReadableStream({ chunks: text(...deltas) }) }),
  });
}

function sending(chunks: StreamPart[]) {
  return new MockLanguageModelV4({
    doStream: async () => ({ stream: simulateReadableStream({ chunks }) }),
  });
}

function throwing(error: unknown = new Error(`failure about ${SECRET}`)) {
  return new MockLanguageModelV4({
    doStream: async () => {
      throw error;
    },
    doGenerate: async () => {
      throw error;
    },
  });
}

function toolCallStep(id: string): StreamPart[] {
  return [
    { type: "stream-start", warnings: [] },
    {
      type: "tool-call",
      toolCallId: id,
      toolName: "listProfileRecords",
      input: JSON.stringify({ section: "skills" }),
    },
    { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_use" }, usage },
  ];
}

const silentLogger = () => ({ info: vi.fn(), error: vi.fn() });

function entries(...models: MockLanguageModelV4[]): FailoverEntry[] {
  return models.map((model, index) => ({ label: `model-${index + 1}`, model }));
}

/** Runs a real chat request through the failover model, as the application does. */
async function ask(
  models: MockLanguageModelV4[],
  {
    attemptFirstChunkMs = 1_000,
    signal,
  }: { attemptFirstChunkMs?: number; signal?: AbortSignal } = {},
) {
  const logger = silentLogger();
  const response = await handleChatRequest(
    new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages: [{ id: "u", role: "user", parts: [{ type: "text", text: SECRET }] }],
      }),
      ...(signal && { signal }),
    }),
    {
      model: createFailoverModel({ models: entries(...models), attemptFirstChunkMs, logger }),
      profile: profile(),
      limit: null,
      limits: { maxRetries: 0 },
      logger,
    },
  );
  const body = await response.text();
  const chunks: Array<Record<string, unknown>> = body
    .split("\n")
    .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .map((line) => JSON.parse(line.slice("data: ".length)));
  const answer = chunks
    .filter((chunk) => chunk.type === "text-delta")
    .map((chunk) => chunk.delta)
    .join("");
  return { answer, chunks, logger };
}

describe("createFailoverModel: moving on before the first content", () => {
  it("uses the first model when it works, and never calls the next", async () => {
    const second = replying("Second.");
    const { answer, logger } = await ask([replying("First."), second]);

    expect(answer).toBe("First.");
    expect(second.doStreamCalls).toHaveLength(0);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("moves on when a model throws at the start, and logs no conversation text", async () => {
    const providerError = new APICallError({
      message: `Rate limited about ${SECRET}`,
      url: "https://provider.example",
      requestBodyValues: { messages: SECRET },
      statusCode: 429,
      isRetryable: true,
    });
    const { answer, chunks, logger } = await ask([throwing(providerError), replying("Second.")]);

    expect(answer).toBe("Second.");
    expect(chunks.some((chunk) => chunk.type === "error")).toBe(false);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("model-1 failed"), {
      name: "AI_APICallError",
      statusCode: 429,
      isRetryable: true,
    });
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(SECRET);
  });

  it("moves on when a stream reports an error before any content", async () => {
    const { answer } = await ask([
      sending([
        { type: "stream-start", warnings: [] },
        { type: "error", error: new Error("overloaded") },
      ]),
      replying("Second."),
    ]);

    expect(answer).toBe("Second.");
  });

  it("moves on from a model that stays silent, even if it ignores the signal", async () => {
    const silent = new MockLanguageModelV4({
      doStream: async () => ({
        stream: new ReadableStream<StreamPart>({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
          },
        }),
      }),
    });
    const { answer, logger } = await ask([silent, replying("Second.")], {
      attemptFirstChunkMs: 30,
    });

    expect(answer).toBe("Second.");
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("model-1 failed"), {
      name: "AttemptTimedOut",
    });
  });

  it("does not count thinking as content, and moves on from thinking to the token limit", async () => {
    const { answer, logger } = await ask([
      sending([
        { type: "stream-start", warnings: [] },
        { type: "reasoning-start", id: "r" },
        { type: "reasoning-delta", id: "r", delta: "Thinking at length" },
        { type: "reasoning-end", id: "r" },
        { type: "finish", finishReason: { unified: "length", raw: "max_tokens" }, usage },
      ]),
      replying("Second."),
    ]);

    expect(answer).toBe("Second.");
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("model-1 failed"), {
      name: "AttemptWithoutContent",
    });
  });

  it("moves on from blank text, which is not an answer", async () => {
    const { answer } = await ask([replying("  \n"), replying("Second.")]);

    expect(answer).toBe("Second.");
  });

  it("gives a last model longer than the others, so a slow one can still answer", async () => {
    const slow = new MockLanguageModelV4({
      doStream: async () => {
        await new Promise((resolve) => setTimeout(resolve, 80));
        return { stream: simulateReadableStream({ chunks: text("Slow but fine.") }) };
      },
    });
    const { answer } = await ask([throwing(), slow], { attemptFirstChunkMs: 10 });

    expect(answer).toBe("Slow but fine.");
  });

  it("sends the next model the same request", async () => {
    const second = replying("Second.");
    await ask([throwing(), second]);

    const prompt = JSON.stringify(second.doStreamCalls[0]?.prompt);
    expect(prompt).toContain(SECRET);
    expect(prompt).toContain("Never guess or invent facts");
    expect(second.doStreamCalls[0]?.tools?.map((tool) => tool.name).sort()).toEqual([
      "getProfileRecord",
      "listProfileRecords",
    ]);
  });
});

describe("createFailoverModel: a model that never responds", () => {
  /** Never answers at all, like a connection that hangs before any headers. */
  const hanging = () =>
    new MockLanguageModelV4({
      doStream: () => new Promise<StreamResult>(() => {}),
    });

  it("ends the call with the generic error when the last model hangs", async () => {
    const logger = silentLogger();
    const started = Date.now();
    const response = await handleChatRequest(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: [{ id: "u", role: "user", parts: [{ type: "text", text: "Hi" }] }],
        }),
      }),
      {
        model: createFailoverModel({
          models: entries(throwing(), hanging()),
          attemptFirstChunkMs: 20,
          lastAttemptFirstChunkMs: 50,
          logger,
        }),
        profile: profile(),
        limit: null,
        limits: { maxRetries: 0 },
        logger,
      },
    );
    const body = await response.text();

    expect(Date.now() - started).toBeLessThan(2_000);
    expect(body).toContain("The assistant could not answer right now");
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("model error"), {
      name: "AttemptTimedOut",
    });
  });

  it("moves on from a model that hangs before the last", async () => {
    const { answer } = await ask([hanging(), replying("Second.")], { attemptFirstChunkMs: 20 });

    expect(answer).toBe("Second.");
  });
});

describe("createFailoverModel: what must not move on", () => {
  it("keeps the partial answer and reports the error once content has started", async () => {
    const second = replying("Second.");
    const { answer, chunks } = await ask([
      sending([
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "t" },
        { type: "text-delta", id: "t", delta: "Jordan is" },
        { type: "error", error: new Error("lost") },
      ]),
      second,
    ]);

    expect(answer).toBe("Jordan is");
    expect(second.doStreamCalls).toHaveLength(0);
    expect(chunks.find((chunk) => chunk.type === "error")?.errorText).toMatch(
      /^The assistant could not answer right now\./,
    );
  });

  it("does not try the next model after a visitor stops", async () => {
    const visitor = new AbortController();
    const second = replying("Second.");
    const stopping = new MockLanguageModelV4({
      doStream: async () => {
        visitor.abort();
        throw new DOMException("Aborted", "AbortError");
      },
    });
    const { answer, chunks } = await ask([stopping, second], { signal: visitor.signal });

    expect(answer).toBe("");
    expect(second.doStreamCalls).toHaveLength(0);
    expect(chunks.some((chunk) => chunk.type === "abort")).toBe(true);
  });

  it("reports the generic error when every model fails, and only the last error's summary", async () => {
    const { chunks, logger } = await ask([throwing(), throwing(new TypeError(SECRET))]);

    expect(chunks.find((chunk) => chunk.type === "error")?.errorText).toMatch(
      /^The assistant could not answer right now\./,
    );
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("model error"), {
      name: "TypeError",
    });
    expect(JSON.stringify(chunks)).not.toContain(SECRET);
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(SECRET);
  });
});

describe("createFailoverModel: several model calls in one turn", () => {
  it("stays on the model that worked for the turn's later steps", async () => {
    const first = throwing();
    const second = new MockLanguageModelV4({
      doStream: [
        { stream: simulateReadableStream({ chunks: toolCallStep("c1") }) },
        { stream: simulateReadableStream({ chunks: text("Go and TypeScript.") }) },
      ],
    });
    const { answer } = await ask([first, second]);

    expect(answer).toBe("Go and TypeScript.");
    expect(first.doStreamCalls).toHaveLength(1);
    expect(second.doStreamCalls).toHaveLength(2);
  });

  it("moves on in a later step, sending the tool results so far", async () => {
    const first = new MockLanguageModelV4({
      doStream: async () => {
        if (first.doStreamCalls.length > 1) throw new Error("overloaded");
        return { stream: simulateReadableStream({ chunks: toolCallStep("c1") }) };
      },
    });
    const second = replying("From the records.");
    const { answer } = await ask([first, second]);

    expect(answer).toBe("From the records.");
    const roles = second.doStreamCalls[0]?.prompt.map((message) => message.role);
    expect(roles).toContain("tool");
  });
});

describe("createFailoverModel: another model's thinking", () => {
  it("does not reach a model that took over partway through a turn", async () => {
    const first = new MockLanguageModelV4({
      doStream: async () => {
        if (first.doStreamCalls.length > 1) throw new Error("overloaded");
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start", warnings: [] },
              { type: "reasoning-start", id: "r" },
              { type: "reasoning-delta", id: "r", delta: `Thinking about ${SECRET}` },
              { type: "reasoning-end", id: "r" },
              ...toolCallStep("c1").slice(1),
            ],
          }),
        };
      },
    });
    const second = replying("From the records.");
    const { answer } = await ask([first, second]);

    expect(answer).toBe("From the records.");
    const assistant = second.doStreamCalls[0]?.prompt.filter(
      (message) => message.role === "assistant",
    );
    expect(JSON.stringify(assistant)).toContain("tool-call");
    expect(JSON.stringify(assistant)).not.toContain("Thinking about");
    // The first model's own later call keeps it, because nothing has moved on yet.
    expect(JSON.stringify(first.doStreamCalls[1]?.prompt)).toContain("Thinking about");
  });
});

describe("createFailoverModel: generated text", () => {
  const starters = JSON.stringify([
    { label: "Projects", question: "What did Jordan build?" },
    { label: "Education", question: "Where did Jordan study?" },
    { label: "Skills", question: "Which skills are listed?" },
  ]);

  it("moves on for a model that fails to generate", async () => {
    const logger = silentLogger();
    const second = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{ type: "text", text: starters }],
        finishReason: stop,
        usage,
        warnings: [],
      }),
    });
    const questions = await generateStarterQuestions({
      model: createFailoverModel({
        models: entries(throwing(), second),
        attemptFirstChunkMs: 1_000,
        logger,
      }),
      profile: profile(),
      logger,
    });

    expect(questions).toHaveLength(3);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("model-1 failed"),
      expect.anything(),
    );
  });
});

describe("createFailoverModel: options", () => {
  it("names every model, so a log or report cannot mistake it for the first", () => {
    const model = createFailoverModel({
      models: entries(replying("a"), replying("b")),
      attemptFirstChunkMs: 1_000,
    });

    expect(model.modelId).toBe("model-1,model-2");
  });

  it.each([
    ["no model", [], 1_000, "models"],
    ["a zero timeout", [{ label: "a", model: replying("a") }], 0, "attemptFirstChunkMs"],
    ["a fractional timeout", [{ label: "a", model: replying("a") }], 1.5, "attemptFirstChunkMs"],
  ])("refuses %s", (_name, models, attemptFirstChunkMs, key) => {
    expect(() => createFailoverModel({ models, attemptFirstChunkMs })).toThrow(key);
  });

  it("refuses a bad timeout for the last model", () => {
    expect(() =>
      createFailoverModel({
        models: entries(replying("a")),
        attemptFirstChunkMs: 1_000,
        lastAttemptFirstChunkMs: 0,
      }),
    ).toThrow("lastAttemptFirstChunkMs");
  });
});
