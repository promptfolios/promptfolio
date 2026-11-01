import { loadStructuredProfile } from "@promptfolio/core";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { type EvaluationTurn, evaluateQuestion, scoreEvaluationTurn } from "./evaluation.ts";

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
      links: [{ label: "Site", url: "https://jordan.example" }],
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
  it("reports tools, returned records, links, and usage for a live turn", async () => {
    const turn = await evaluateQuestion("Projects?", {
      ...options(),
      model: model(
        toolStep,
        textStep(
          "See [site](https://jordan.example/) and https://attacker.example/x and [other](https://evil.example). `https://in-code.example`",
        ),
      ),
    });

    expect(turn).toMatchObject({
      failed: false,
      finishReason: "stop",
      steps: 2,
      toolCalls: ["listProfileRecords"],
      returnedIds: ["service-catalog"],
      links: ["https://jordan.example/", "https://attacker.example/x", "https://evil.example/"],
      unknownLinks: ["https://attacker.example/x", "https://evil.example/"],
      inputTokens: 20,
      outputTokens: 8,
    });
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
    expect(turn.rawToolCall).toBe(false);
  });

  it("scores a raw tool call as the model's fault, not as a provider failure", async () => {
    const turn = await evaluateQuestion("Projects?", {
      ...options(),
      model: model(toolStep, textStep("<tool_call><function=listProfileRecords>")),
    });

    expect(turn).toMatchObject({ failed: false, rawToolCall: true, text: "", steps: 2 });
    expect(
      scoreEvaluationTurn(turn, {})
        .filter((check) => !check.passed)
        .map((check) => check.name),
    ).toContain("no raw tool call");
  });
});

describe("scoreEvaluationTurn", () => {
  const turn: EvaluationTurn = {
    text: "Riley works at [Northwind](https://northwind.example/).",
    failed: false,
    rawToolCall: false,
    finishReason: "stop",
    steps: 2,
    toolCalls: ["listProfileRecords"],
    returnedIds: ["northwind-backend"],
    links: ["https://northwind.example/"],
    unknownLinks: [],
  };
  const failedNames = (checks: ReturnType<typeof scoreEvaluationTurn>) =>
    checks.filter((check) => !check.passed).map((check) => check.name);

  it("passes when every expectation holds", () => {
    const checks = scoreEvaluationTurn(turn, {
      lookup: true,
      returns: ["northwind-backend"],
      links: ["https://northwind.example/"],
      mustMatch: [/Northwind/],
      mustMatchAny: [/nothing/, /works/],
      mustNotMatch: [/award/i],
    });

    expect(failedNames(checks)).toEqual([]);
  });

  it("fails every turn with a link outside the profile, naming it", () => {
    const checks = scoreEvaluationTurn(
      { ...turn, unknownLinks: ["https://attacker.example/"] },
      {},
    );

    expect(checks.find((check) => !check.passed)).toEqual({
      name: "no links outside the profile",
      passed: false,
      detail: "https://attacker.example/",
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
      { ...turn, toolCalls: [], returnedIds: [], links: [] },
      {
        lookup: true,
        returns: ["northwind-backend"],
        links: ["https://northwind.example/"],
        mustMatch: [/Initech/],
        mustMatchAny: [/nothing/],
        mustNotMatch: [/Northwind/],
      },
    );

    expect(failedNames(checks)).toEqual([
      "looked up",
      "returned northwind-backend",
      "links https://northwind.example/",
      "says /Initech/",
      "says one of /nothing/",
      "does not say /Northwind/",
    ]);
  });
});
