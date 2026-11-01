import type { EvaluationCheck, EvaluationTurn } from "@promptfolio/ai/evaluation";
import type { EvaluationCase } from "./cases";

/** One run of one case. A turn that failed says nothing about the answer, so it is not scored. */
export interface EvaluationRun {
  caseId: string;
  turn: EvaluationTurn;
  checks: EvaluationCheck[];
}

export function runPassed(run: EvaluationRun): boolean {
  return !run.turn.failed && run.checks.every((check) => check.passed);
}

export interface EvaluationSummary {
  runs: number;
  /** Runs the provider failed, which are not scored. */
  failedRuns: number;
  passedRuns: number;
  /** Of the scored runs in cases that require a lookup: how many made one. */
  lookedUp: { runs: number; ofRuns: number };
  /** Scored runs with any link outside the profile, and how many such links. */
  unknownLinks: { runs: number; links: number };
  /** Runs where the server stopped a tool call written as text. */
  rawToolCallRuns: number;
  averageInputTokens: number;
  averageOutputTokens: number;
}

export function summarize(cases: EvaluationCase[], runs: EvaluationRun[]): EvaluationSummary {
  const scored = runs.filter((run) => !run.turn.failed);
  const needsLookup = new Set(cases.filter((item) => item.expect.lookup).map((item) => item.id));
  const lookupRuns = scored.filter((run) => needsLookup.has(run.caseId));
  const average = (values: Array<number | undefined>) =>
    values.length === 0
      ? 0
      : Math.round(values.reduce<number>((sum, value) => sum + (value ?? 0), 0) / values.length);
  return {
    runs: runs.length,
    failedRuns: runs.length - scored.length,
    passedRuns: scored.filter(runPassed).length,
    lookedUp: {
      runs: lookupRuns.filter((run) => run.turn.toolCalls.length > 0).length,
      ofRuns: lookupRuns.length,
    },
    unknownLinks: {
      runs: scored.filter((run) => run.turn.unknownLinks.length > 0).length,
      links: scored.reduce((sum, run) => sum + run.turn.unknownLinks.length, 0),
    },
    rawToolCallRuns: scored.filter((run) => run.turn.rawToolCall).length,
    averageInputTokens: average(scored.map((run) => run.turn.inputTokens)),
    averageOutputTokens: average(scored.map((run) => run.turn.outputTokens)),
  };
}

export interface ReportHeader {
  title: string;
  date: string;
  model: string;
  repeats: number;
  notes?: string;
}

function failedCheckNames(run: EvaluationRun): string[] {
  return run.checks
    .filter((check) => !check.passed)
    .map((check) => (check.detail ? `${check.name} (${check.detail})` : check.name));
}

/** Text in a table cell: Markdown's table and line syntax would otherwise break the row. */
function cell(text: string): string {
  return text.replaceAll("|", "\\|").replaceAll("\n", " ");
}

/** The report: the numbers, a table per case, and every answer for a person to read. */
export function formatReport(
  header: ReportHeader,
  cases: EvaluationCase[],
  runs: EvaluationRun[],
): string {
  const summary = summarize(cases, runs);
  const lines = [
    `# ${header.title}`,
    "",
    `- **Date:** ${header.date}`,
    `- **Model:** ${header.model}`,
    `- **Cases:** ${cases.length}, each run ${header.repeats} times`,
    "- **Profile:** the fictional one in `apps/portfolio/evaluation/`",
    ...(header.notes ? [`- **Notes:** ${header.notes}`] : []),
    "",
    "## Summary",
    "",
    "| Measure | Result |",
    "| ------- | ------ |",
    `| Scored runs that passed every check | ${summary.passedRuns} of ${summary.runs - summary.failedRuns} |`,
    `| Runs the provider failed (not scored) | ${summary.failedRuns} |`,
    `| Looked up when the case requires it | ${summary.lookedUp.runs} of ${summary.lookedUp.ofRuns} |`,
    `| Runs with a link outside the profile | ${summary.unknownLinks.runs} (${summary.unknownLinks.links} links) |`,
    `| Runs with a raw tool call, blocked | ${summary.rawToolCallRuns} |`,
    `| Average tokens per turn | ${summary.averageInputTokens} in, ${summary.averageOutputTokens} out |`,
    "",
    "Passing means the checks found nothing wrong, not that the answer is right. Read the answers below.",
    "",
    "## Cases",
    "",
    "| Case | Category | Passed | Failed checks |",
    "| ---- | -------- | ------ | ------------- |",
  ];
  for (const item of cases) {
    const own = runs.filter((run) => run.caseId === item.id);
    const scored = own.filter((run) => !run.turn.failed);
    const failures = [...new Set(scored.flatMap(failedCheckNames))];
    const providerFailures = own.length - scored.length;
    lines.push(
      `| ${item.id} | ${item.category} | ${scored.filter(runPassed).length} of ${scored.length}${
        providerFailures > 0 ? ` (${providerFailures} provider failures)` : ""
      } | ${cell(failures.join("; ")) || "none"} |`,
    );
  }
  lines.push("", "## Answers", "");
  for (const item of cases) {
    lines.push(`### ${item.id}`, "", `**Question:** ${item.question}`, "");
    runs
      .filter((run) => run.caseId === item.id)
      .forEach((run, index) => {
        const { turn } = run;
        const heading = turn.failed
          ? "provider failure"
          : runPassed(run)
            ? "passed"
            : `failed: ${failedCheckNames(run).join("; ")}`;
        lines.push(
          `**Run ${index + 1}:** ${heading}`,
          "",
          `Steps: ${turn.steps}. Finish: ${turn.finishReason ?? "unknown"}. Tools: ${turn.toolCalls.join(", ") || "none"}. Returned: ${turn.returnedIds.join(", ") || "none"}. Links: ${turn.links.join(", ") || "none"}. Outside the profile: ${turn.unknownLinks.join(", ") || "none"}.`,
          "",
          // Quoted, so an answer's Markdown cannot change the report's structure.
          ...(turn.text.trim() === ""
            ? ["> (no text)"]
            : turn.text.split("\n").map((line) => `> ${line}`)),
          "",
        );
      });
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
