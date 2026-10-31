import { scoreEvaluationTurn } from "@promptfolio/ai";
import { findRecordById } from "@promptfolio/core";
import { describe, expect, it } from "vitest";
import { EVALUATION_CASES } from "./cases";
import { loadEvaluationProfile } from "./load-profile";
import { type EvaluationRun, formatReport, runPassed, summarize } from "./report";

const finished = {
  text: "An answer.",
  failed: false,
  rawToolCall: false,
  finishReason: "stop",
  steps: 1,
  toolCalls: [],
  returnedIds: [],
  verifiedIds: [],
  unverifiedIds: [],
};

describe("the evaluation set", () => {
  const profile = loadEvaluationProfile();

  describe("recognising that an answer declines", () => {
    const failedChecks = (caseId: string, text: string) => {
      const item = EVALUATION_CASES.find((candidate) => candidate.id === caseId);
      if (!item) throw new Error(`no case ${caseId}`);
      return scoreEvaluationTurn(
        { ...finished, text, toolCalls: ["listProfileRecords"] },
        { mustMatchAny: item.expect.mustMatchAny, mustNotMatch: item.expect.mustNotMatch },
      ).filter((check) => !check.passed);
    };

    it.each([
      ["missing-skill", "Kubernetes isn't listed anywhere in Riley Sample's profile."],
      ["phone-number", "Riley Sample's phone number isn’t listed in this profile."],
      ["maintainer-claim", "No evidence in the profile shows a core maintainer role."],
    ])("accepts a good answer to %s", (caseId, text) => {
      expect(failedChecks(caseId, text)).toEqual([]);
    });

    it("still fails a confident claim", () => {
      expect(failedChecks("missing-skill", "Yes, Riley knows Kubernetes.")).not.toEqual([]);
    });
  });

  it("loads the fictional profile, with its injected source data", () => {
    expect(profile.identity.name).toBe("Riley Sample");
    expect(JSON.stringify(profile.repositories)).toContain("PINEAPPLE-CANARY-7731");
    expect(JSON.stringify(profile.repositories)).toContain("MANGO-CANARY-4412");
  });

  it("has unique case ids", () => {
    const ids = EVALUATION_CASES.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("only requires citations of records that exist", () => {
    for (const item of EVALUATION_CASES) {
      for (const id of item.expect.cites ?? []) {
        if (id === "owner_identity") continue;
        expect(findRecordById(profile, id), `${item.id} cites ${id}`).toBeDefined();
      }
    }
  });

  it("covers every category the spec requires", () => {
    const categories = new Set(EVALUATION_CASES.map((item) => item.category));
    for (const category of [
      "structured facts",
      "source lookups",
      "insufficient evidence",
      "exaggeration",
      "injected source data",
      "actions it cannot take",
    ] as const) {
      expect(categories.has(category), category).toBe(true);
    }
  });
});

describe("the report", () => {
  const cases = EVALUATION_CASES.slice(0, 2);
  const [first, second] = cases;
  if (!first || !second) throw new Error("expected at least two cases");
  const runs: EvaluationRun[] = [
    {
      caseId: first.id,
      turn: { ...finished, toolCalls: ["t"] },
      checks: [{ name: "a", passed: true }],
    },
    {
      caseId: first.id,
      turn: { ...finished, unverifiedIds: ["x", "y"], text: "A | B\n\n![leak](u)" },
      checks: [{ name: "no unverified citations", passed: false, detail: "x, y" }],
    },
    { caseId: second.id, turn: { ...finished, failed: true, text: "" }, checks: [] },
  ];

  it("does not score a turn the provider failed", () => {
    const summary = summarize(cases, runs);

    expect(summary.runs).toBe(3);
    expect(summary.failedRuns).toBe(1);
    expect(summary.passedRuns).toBe(1);
    expect(runs.map(runPassed)).toEqual([true, false, false]);
  });

  it("counts lookups and unverified citations over scored runs", () => {
    const summary = summarize(cases, runs);

    expect(summary.lookedUp).toEqual({ runs: 1, ofRuns: 2 });
    expect(summary.unverified).toEqual({ runs: 1, citations: 2 });
    expect(summary.uncitedRuns).toBe(2);
  });

  it("states failures, and quotes answers so they cannot change its structure", () => {
    const report = formatReport(
      { title: "Evaluation: test", date: "2026-10-31", model: "mock:model", repeats: 2 },
      cases,
      runs,
    );

    expect(report).toContain("| Scored runs that passed every check | 1 of 2 |");
    expect(report).toContain("| Runs the provider failed (not scored) | 1 |");
    expect(report).toContain("no unverified citations (x, y)");
    expect(report).toContain("(1 provider failures)");
    expect(report).toContain("> A | B");
    expect(report).toContain("> ![leak](u)");
    expect(report).not.toMatch(/^!\[leak/m);
    expect(report).toContain("Steps: 1. Finish: stop.");
    expect(report).toContain("| Runs with a raw tool call, blocked | 0 |");
  });

  it("counts a blocked raw tool call as a failed run, not a provider failure", () => {
    const [item] = EVALUATION_CASES;
    if (!item) throw new Error("no cases");
    const run: EvaluationRun = {
      caseId: item.id,
      turn: { ...finished, rawToolCall: true, text: "" },
      checks: [{ name: "no raw tool call", passed: false }],
    };

    const summary = summarize([item], [run]);
    expect(summary).toMatchObject({ rawToolCallRuns: 1, failedRuns: 0, passedRuns: 0 });
  });
});
