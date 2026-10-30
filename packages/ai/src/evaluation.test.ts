import { loadStructuredProfile } from "@promptfolio/core";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { type EvaluationTurn, evaluateQuestion, scoreEvaluationTurn } from "./evaluation";

type StreamResult = Awaited<ReturnType<MockLanguageModelV4["doStream"]>>;
type StreamPart = StreamResult["stream"] extends ReadableStream<infer P> ? P : never;

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 4, text: 4, reasoning: 0 },
};

function profile() {
  const result = loadStructuredProfile(
    {
      schemaVersion: 1,
      identity: { name: "Jordan Example", headline: "Engineer", summary: "Builds tools." },
      projects: [{ id: "service-catalog", name: "Service Catalog", description: "A catalog." }],
    },
    { sourceId: "owner-profile", label: "Test", observedAt: new Date("2026-10-01") },
  );
  if (!result.ok) throw new Error("test profile is invalid");
  return result.profile;
}

const toolStep: StreamPart[] = [
  { type: "stream-start", warnings: [] },
  {
    type: "tool-call",
    toolCallId: "c1",
    toolName: "listProfileRecords",
    input: JSON.stringify({ section: "projects" }),
  },
  { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_use" }, usage },
];

function textStep(text: string): StreamPart[] {
  return [
    { type: "stream-start", warnings: [] },
    { type: "text-start", id: "t1" },
    { type: "text-delta", id: "t1", delta: text },
    { type: "text-end", id: "t1" },
    { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
  ];
}

function model(...steps: StreamPart[][]) {
  return new MockLanguageModelV4({
    doStream: steps.map((chunks) => ({ stream: simulateReadableStream({ chunks }) })),
  });
}

const options = () => ({ profile: profile(), logger: { info: () => {}, error: () => {} } });

describe("evaluateQuestion", () => {
  it("reports tools, citations, and usage for a live turn", async () => {
    const turn = await evaluateQuestion("Projects?", {
      ...options(),
      model: model(
        toolStep,
        textStep("A catalog [service-catalog]. Builds tools [owner_identity]. Also [invented]."),
      ),
    });

    expect(turn).toMatchObject({
      failed: false,
      finishReason: "stop",
      steps: 2,
      toolCalls: ["listProfileRecords"],
      returnedIds: ["service-catalog"],
      verifiedIds: ["service-catalog", "owner_identity"],
      unverifiedIds: ["invented"],
      inputTokens: 20,
      outputTokens: 8,
    });
  });

  it("does not count a citation from earlier messages as verified", async () => {
    const turn = await evaluateQuestion("And?", {
      ...options(),
      model: model(textStep("A catalog [service-catalog].")),
      history: [
        {
          id: "a1",
          role: "assistant",
          parts: [{ type: "text", text: "I looked it up [service-catalog]." }],
        },
      ],
    });

    expect(turn.unverifiedIds).toEqual(["service-catalog"]);
  });

  it("reports a provider failure without throwing", async () => {
    const turn = await evaluateQuestion("Hi", {
      ...options(),
      model: new MockLanguageModelV4({
        doStream: async () => {
          throw new Error("quota");
        },
      }),
    });

    expect(turn.failed).toBe(true);
  });
});

describe("scoreEvaluationTurn", () => {
  const turn: EvaluationTurn = {
    text: "Riley works at Northwind [northwind-backend].",
    failed: false,
    finishReason: "stop",
    steps: 2,
    toolCalls: ["listProfileRecords"],
    returnedIds: ["northwind-backend"],
    verifiedIds: ["northwind-backend"],
    unverifiedIds: [],
  };
  const failedNames = (checks: ReturnType<typeof scoreEvaluationTurn>) =>
    checks.filter((check) => !check.passed).map((check) => check.name);

  it("passes when every expectation holds", () => {
    const checks = scoreEvaluationTurn(turn, {
      lookup: true,
      cites: ["northwind-backend"],
      minVerifiedCitations: 1,
      mustMatch: [/Northwind/],
      mustMatchAny: [/nothing/, /works/],
      mustNotMatch: [/award/i],
    });

    expect(failedNames(checks)).toEqual([]);
  });

  it("fails every turn with an unverified citation, naming it", () => {
    const checks = scoreEvaluationTurn({ ...turn, unverifiedIds: ["invented"] }, {});

    expect(checks.find((check) => !check.passed)).toEqual({
      name: "no unverified citations",
      passed: false,
      detail: "invented",
    });
  });

  it("fails a turn that was cut off or empty", () => {
    expect(failedNames(scoreEvaluationTurn({ ...turn, finishReason: "length" }, {}))).toEqual([
      "finished",
    ]);
    expect(failedNames(scoreEvaluationTurn({ ...turn, text: " " }, {}))).toEqual(["has an answer"]);
  });

  it("names each thing a case required and did not get", () => {
    const checks = scoreEvaluationTurn(
      { ...turn, toolCalls: [], verifiedIds: [] },
      {
        lookup: true,
        cites: ["northwind-backend"],
        minVerifiedCitations: 2,
        mustMatch: [/Initech/],
        mustMatchAny: [/nothing/],
        mustNotMatch: [/Northwind/],
      },
    );

    expect(failedNames(checks)).toEqual([
      "looked up",
      "cites northwind-backend",
      "at least 2 verified citations",
      "says /Initech/",
      "says one of /nothing/",
      "does not say /Northwind/",
    ]);
  });
});
