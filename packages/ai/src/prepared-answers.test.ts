import { loadStructuredProfile, type Profile } from "@promptfolio/core";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { type ChatLogger, handleChatRequest } from "./chat-handler";
import { CHAT_LIMITS } from "./limits";
import {
  citedIds,
  evidenceIdsIn,
  generatePreparedAnswer,
  instructionsFingerprint,
  type PreparedAnswer,
  parsePreparedAnswers,
  profileFingerprint,
} from "./prepared-answers";

type StreamResult = Awaited<ReturnType<MockLanguageModelV4["doStream"]>>;
type StreamPart = StreamResult["stream"] extends ReadableStream<infer P> ? P : never;

const QUESTION = "Give me a short professional overview.";

function testProfile({
  description = "An internal catalog of services.",
  observedAt = new Date("2026-10-01"),
} = {}): Profile {
  const result = loadStructuredProfile(
    {
      schemaVersion: 1,
      identity: {
        name: "Jordan Example",
        headline: "Full-stack engineer",
        summary: "Builds web applications with TypeScript.",
      },
      experience: [
        {
          id: "globex-fullstack",
          organization: "Globex",
          title: "Full-stack Engineer",
          start: "2023-09",
        },
      ],
      projects: [
        { id: "service-catalog", name: "Service Catalog", description, roleId: "globex-fullstack" },
      ],
    },
    { sourceId: "owner-profile", label: "Test profile", observedAt },
  );
  if (!result.ok) throw new Error("test profile is invalid");
  return result.profile;
}

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 4, text: 4, reasoning: 0 },
};

function textChunks(text: string, finish: "stop" | "length" = "stop"): StreamPart[] {
  return [
    { type: "stream-start", warnings: [] },
    { type: "text-start", id: "t1" },
    { type: "text-delta", id: "t1", delta: text },
    { type: "text-end", id: "t1" },
    { type: "finish", finishReason: { unified: finish, raw: finish }, usage },
  ];
}

function listCallChunks(section: string): StreamPart[] {
  return [
    { type: "stream-start", warnings: [] },
    {
      type: "tool-call",
      toolCallId: "c1",
      toolName: "listProfileRecords",
      input: JSON.stringify({ section }),
    },
    { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_use" }, usage },
  ];
}

function stepsModel(...steps: StreamPart[][]) {
  return new MockLanguageModelV4({
    doStream: steps.map((chunks) => ({ stream: simulateReadableStream({ chunks }) })),
  });
}

function silentLogger() {
  return { info: vi.fn(), error: vi.fn() } satisfies ChatLogger;
}

function chatRequest(body: unknown): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function userMessage(text: string, id = "u1") {
  return { id, role: "user", parts: [{ type: "text", text }] };
}

async function readChunks(response: Response): Promise<Array<Record<string, unknown>>> {
  const text = await response.text();
  return text
    .split("\n")
    .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .map((line) => JSON.parse(line.slice("data: ".length)));
}

function textOf(chunks: Array<Record<string, unknown>>): string {
  return chunks
    .filter((chunk) => chunk.type === "text-delta")
    .map((chunk) => chunk.delta)
    .join("");
}

/** A prepared answer that is current for `profile`. */
async function currentAnswer(
  profile: Profile,
  overrides: Partial<PreparedAnswer> = {},
): Promise<PreparedAnswer> {
  return {
    question: QUESTION,
    text: "Jordan is a full-stack engineer at Globex [globex-fullstack].",
    profileFingerprint: await profileFingerprint(profile),
    instructionsFingerprint: await instructionsFingerprint(profile),
    evidenceIds: ["globex-fullstack"],
    model: "mock:model",
    generatedAt: "2026-10-29T10:00:00.000Z",
    ...overrides,
  };
}

const FINGERPRINT = `sha256:${"a".repeat(64)}`;

function validFile(answers: unknown[] = [validEntry()]) {
  return { formatVersion: 1, answers };
}

function validEntry(overrides: Record<string, unknown> = {}) {
  return {
    question: QUESTION,
    text: "An answer.",
    profileFingerprint: FINGERPRINT,
    instructionsFingerprint: FINGERPRINT,
    evidenceIds: ["globex-fullstack"],
    model: "google:gemini-3.8-flash",
    generatedAt: "2026-10-29T10:00:00.000Z",
    ...overrides,
  };
}

describe("parsePreparedAnswers", () => {
  it("accepts a valid file", () => {
    const result = parsePreparedAnswers(validFile());
    expect(result.ok && result.answers).toHaveLength(1);
  });

  it("accepts source keys as evidence ids", () => {
    const entry = validEntry({ evidenceIds: ["github.com/jordan-example/markdown-linter"] });
    expect(parsePreparedAnswers(validFile([entry])).ok).toBe(true);
  });

  it.each([
    ["not an object", "nonsense"],
    ["a wrong format version", { ...validFile(), formatVersion: 2 }],
    ["an unknown top-level key", { ...validFile(), extra: true }],
    ["an unknown answer key", validFile([validEntry({ tools: [] })])],
    ["duplicate questions", validFile([validEntry(), validEntry({ text: "Other." })])],
    ["an empty text", validFile([validEntry({ text: "" })])],
    [
      "a text over the message limit",
      validFile([validEntry({ text: "x".repeat(CHAT_LIMITS.maxMessageChars + 1) })]),
    ],
    [
      "too many answers",
      validFile(Array.from({ length: 21 }, (_, i) => validEntry({ question: `Q${i}?` }))),
    ],
    ["a malformed fingerprint", validFile([validEntry({ profileFingerprint: "md5:abc" })])],
    ["an invalid evidence id", validFile([validEntry({ evidenceIds: ["Not An Id"] })])],
    ["an invalid date", validFile([validEntry({ generatedAt: "yesterday" })])],
  ])("rejects %s without throwing", (_name, data) => {
    const result = parsePreparedAnswers(data);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.issues.length).toBeGreaterThan(0);
  });
});

describe("fingerprints", () => {
  it("are stable for the same content and ignore observation times", async () => {
    const a = await profileFingerprint(testProfile());
    expect(a).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(await profileFingerprint(testProfile())).toBe(a);
    expect(await profileFingerprint(testProfile({ observedAt: new Date("2027-01-01") }))).toBe(a);
  });

  it("change when a fact changes", async () => {
    expect(await profileFingerprint(testProfile({ description: "Something else." }))).not.toBe(
      await profileFingerprint(testProfile()),
    );
  });

  it("cover the instructions separately from the profile records", async () => {
    const instructions = await instructionsFingerprint(testProfile());
    expect(instructions).toMatch(/^sha256:[0-9a-f]{64}$/);
    // A project description is not part of the instructions (it reaches the model as a tool result).
    expect(await instructionsFingerprint(testProfile({ description: "Something else." }))).toBe(
      instructions,
    );
  });
});

describe("handleChatRequest with prepared answers", () => {
  async function handle(
    body: unknown,
    { profile = testProfile(), answers }: { profile?: Profile; answers?: PreparedAnswer[] } = {},
  ) {
    const model = stepsModel(textChunks("A live answer."));
    const logger = silentLogger();
    const response = await handleChatRequest(chatRequest(body), {
      model,
      profile,
      logger,
      preparedAnswers: answers ?? [await currentAnswer(testProfile())],
    });
    // The model is called only while the body streams, so read a copy before asserting on it.
    await response.clone().text();
    return { response, model, logger };
  }

  function preparedLog(logger: ReturnType<typeof silentLogger>) {
    return logger.info.mock.calls.find(([message]) =>
      String(message).includes("prepared answer"),
    )?.[1];
  }

  it("serves a current answer without calling the model", async () => {
    const { response, model, logger } = await handle({ messages: [userMessage(`  ${QUESTION} `)] });
    const body = await response.clone().text();
    const chunks = await readChunks(response);

    expect(model.doStreamCalls).toHaveLength(0);
    expect(textOf(chunks)).toBe("Jordan is a full-stack engineer at Globex [globex-fullstack].");
    expect(chunks.map((chunk) => chunk.type)).toEqual([
      "start",
      "start-step",
      "text-start",
      "text-delta",
      "text-end",
      "finish-step",
      "finish",
    ]);
    expect(body).not.toContain("providerMetadata");
    expect(preparedLog(logger)).toEqual({ outcome: "hit" });
  });

  it("goes live for a question without an entry, including different case", async () => {
    for (const question of ["What are the main technical skills?", QUESTION.toLowerCase()]) {
      const { response, model, logger } = await handle({ messages: [userMessage(question)] });
      expect(textOf(await readChunks(response))).toBe("A live answer.");
      expect(model.doStreamCalls).toHaveLength(1);
      expect(preparedLog(logger)).toEqual({ outcome: "miss", reason: "no-entry" });
    }
  });

  it("goes live after a profile change, but not after a new observation time", async () => {
    const changed = await handle(
      { messages: [userMessage(QUESTION)] },
      { profile: testProfile({ description: "A different catalog." }) },
    );
    expect(textOf(await readChunks(changed.response))).toBe("A live answer.");
    expect(preparedLog(changed.logger)).toEqual({ outcome: "miss", reason: "stale-profile" });

    const reobserved = await handle(
      { messages: [userMessage(QUESTION)] },
      { profile: testProfile({ observedAt: new Date("2027-01-01") }) },
    );
    expect(reobserved.model.doStreamCalls).toHaveLength(0);
    expect(preparedLog(reobserved.logger)).toEqual({ outcome: "hit" });
  });

  it("goes live when the instructions changed", async () => {
    const answers = [await currentAnswer(testProfile(), { instructionsFingerprint: FINGERPRINT })];
    const { model, logger } = await handle({ messages: [userMessage(QUESTION)] }, { answers });
    expect(model.doStreamCalls).toHaveLength(1);
    expect(preparedLog(logger)).toEqual({ outcome: "miss", reason: "stale-instructions" });
  });

  it("answers follow-ups live and does not log them", async () => {
    const { model, logger } = await handle({
      messages: [
        userMessage(QUESTION),
        { id: "a1", role: "assistant", parts: [{ type: "text", text: "Earlier answer." }] },
        userMessage(QUESTION, "u2"),
      ],
    });
    expect(model.doStreamCalls).toHaveLength(1);
    expect(preparedLog(logger)).toBeUndefined();
  });

  it("goes live on regenerate, and treats a missing or unknown trigger as a new message", async () => {
    const regenerate = await handle({
      messages: [userMessage(QUESTION)],
      trigger: "regenerate-message",
    });
    expect(regenerate.model.doStreamCalls).toHaveLength(1);
    expect(preparedLog(regenerate.logger)).toEqual({ outcome: "miss", reason: "regenerate" });

    for (const trigger of [undefined, "submit-message", "something-else", 42]) {
      const { model } = await handle({ messages: [userMessage(QUESTION)], trigger });
      expect(model.doStreamCalls).toHaveLength(0);
    }
  });

  it("goes live without prepared answers and logs nothing about them", async () => {
    const { model, logger } = await handle({ messages: [userMessage(QUESTION)] }, { answers: [] });
    expect(model.doStreamCalls).toHaveLength(1);
    expect(preparedLog(logger)).toBeUndefined();
  });

  it("still rejects an invalid request with a starter question before any lookup", async () => {
    const { response, model, logger } = await handle({
      messages: [{ id: "u1", role: "user", parts: [{ type: "tool-x", text: QUESTION }] }],
    });
    expect(response.status).toBe(400);
    expect(model.doStreamCalls).toHaveLength(0);
    expect(preparedLog(logger)).toBeUndefined();

    const tooLong = await handle({
      messages: [userMessage(`${QUESTION}${" ".repeat(CHAT_LIMITS.maxMessageChars)}`)],
    });
    expect(tooLong.response.status).toBe(413);
  });

  it("accepts a follow-up after a prepared answer and answers it live", async () => {
    const answer = await currentAnswer(testProfile());
    const { model } = await handle({
      messages: [
        userMessage(QUESTION),
        {
          id: "a1",
          role: "assistant",
          parts: [{ type: "step-start" }, { type: "text", text: answer.text }],
        },
        userMessage("Tell me more about that role.", "u2"),
      ],
    });
    expect(model.doStreamCalls).toHaveLength(1);
  });
});

describe("generatePreparedAnswer", () => {
  function options(model: MockLanguageModelV4, extra: Record<string, unknown> = {}) {
    return {
      model,
      profile: testProfile(),
      logger: silentLogger(),
      modelLabel: "mock:model",
      now: () => new Date("2026-10-29T10:00:00.000Z"),
      ...extra,
    };
  }

  it("records what a visitor would receive, with evidence ids and current fingerprints", async () => {
    const text = "Jordan's profile lists the Service Catalog [service-catalog].";
    const model = stepsModel(listCallChunks("projects"), textChunks(text));
    const result = await generatePreparedAnswer(`  ${QUESTION}  `, options(model));

    expect(result).toEqual({
      ok: true,
      answer: {
        question: QUESTION,
        text,
        profileFingerprint: await profileFingerprint(testProfile()),
        instructionsFingerprint: await instructionsFingerprint(testProfile()),
        evidenceIds: ["service-catalog"],
        model: "mock:model",
        generatedAt: "2026-10-29T10:00:00.000Z",
      },
    });
    expect(JSON.stringify(result)).not.toContain("listProfileRecords");
    // The generated entry is accepted by the file schema.
    expect(
      parsePreparedAnswers({ formatVersion: 1, answers: [result.ok && result.answer] }).ok,
    ).toBe(true);
  });

  it("accepts an answer from the identity block without any lookup", async () => {
    const result = await generatePreparedAnswer(
      QUESTION,
      options(stepsModel(textChunks("Jordan Example is a full-stack engineer."))),
    );
    expect(result.ok && result.answer.evidenceIds).toEqual([]);
  });

  it.each([
    ["an id no tool returned", "See [globex-fullstack]."],
    ["the identity tag", "Jordan builds apps [owner_identity]."],
    ["two ids in one bracket", "See [service-catalog, globex-fullstack]."],
  ])("rejects an answer that cites %s", async (_name, text) => {
    const model = stepsModel(listCallChunks("projects"), textChunks(text));
    const result = await generatePreparedAnswer(QUESTION, options(model));
    expect(result).toMatchObject({ ok: false, reason: "unsupported-citation" });
  });

  it("rejects an answer longer than the message limit", async () => {
    const text = "x".repeat(CHAT_LIMITS.maxMessageChars + 1);
    const result = await generatePreparedAnswer(QUESTION, options(stepsModel(textChunks(text))));
    expect(result).toMatchObject({ ok: false, reason: "too-long" });
  });

  it("rejects an empty answer and one cut off by the token limit", async () => {
    expect(
      await generatePreparedAnswer(QUESTION, options(stepsModel(textChunks("  ")))),
    ).toMatchObject({ ok: false, reason: "empty" });
    expect(
      await generatePreparedAnswer(
        QUESTION,
        options(stepsModel(textChunks("Jordan is", "length"))),
      ),
    ).toMatchObject({ ok: false, reason: "not-finished", detail: "length" });
  });

  it("rejects a model error and a timeout", async () => {
    const failing = new MockLanguageModelV4({
      doStream: async () => {
        throw new Error("503 overloaded");
      },
    });
    expect(await generatePreparedAnswer(QUESTION, options(failing))).toMatchObject({
      ok: false,
      reason: "error",
    });

    const stalling = new MockLanguageModelV4({
      doStream: async () => ({
        stream: new ReadableStream<StreamPart>({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
          },
        }),
      }),
    });
    const timeouts = { firstChunkMs: 50, chunkMs: 50, totalMs: 500 };
    expect(await generatePreparedAnswer(QUESTION, options(stalling, { timeouts }))).toMatchObject({
      ok: false,
      reason: "error",
    });
  });
});

describe("citations and evidence", () => {
  it("finds bracketed ids but not Markdown links", () => {
    expect(citedIds("A [service-catalog], B [a, b], [GitHub](https://github.com) [x]")).toEqual([
      "service-catalog",
      "a, b",
      "x",
    ]);
  });

  it("collects record ids from lists, fetched records, and role summaries, but not sources", () => {
    expect(
      evidenceIdsIn([
        {
          output: {
            status: "listed",
            records: [{ id: "a" }, { name: "TypeScript" }],
            sources: [{ id: "owner-profile" }],
          },
        },
        { output: { status: "found", record: { id: "b" }, role: { id: "c" } } },
        { output: { status: "not_found", id: "nasa-rover" } },
        { output: "not an object" },
      ]),
    ).toEqual(["a", "b", "c"]);
  });

  it("accepts a cited repository id that a tool returned", () => {
    const id = "github.com/jordan-example/markdown-linter";
    const text = `The public repository checks links [${id}].`;
    const evidence = evidenceIdsIn([
      { output: { status: "found", kind: "repository", record: { id }, ownerNotes: { id } } },
    ]);
    expect(evidence).toEqual([id]);
    expect(citedIds(text).every((cited) => evidence.includes(cited))).toBe(true);
  });
});
