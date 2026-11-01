/**
 * Runs the evaluation set against the configured model and writes a report to `docs/evaluation/`.
 * Run by the owner, never by `pnpm verify`, because it makes real model calls:
 *
 *   pnpm --filter portfolio evaluate --label=baseline
 *
 * Options: `--repeats=3`, `--cases=a,b` (ids), `--notes=text`, and `--call-gap-ms=4500`, the time
 * allowed per model call so a free tier's requests per minute are not used up (0 on a paid plan). It
 * uses the model and key from `.env.local`, and always the fictional profile in `evaluation/`, never
 * `profile/`.
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { evaluateQuestion, scoreEvaluationTurn } from "@promptfolio/ai/evaluation";
import { EVALUATION_CASES, type EvaluationCase } from "../evaluation/cases";
import { loadEvaluationProfile } from "../evaluation/load-profile";
import { type EvaluationRun, formatReport, runPassed, summarize } from "../evaluation/report";
import { chatInstructions } from "../src/server/chat/instructions";
import { createChatModel } from "../src/server/chat/model";

/** After a provider failure, usually a quota: wait for the minute to reset, and try again. */
const RETRY_WAIT_MS = 65_000;
const MAX_ATTEMPTS = 3;

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<number> {
  // One model only, so a report says which model wrote its answers. A list's first entry is evaluated.
  const chatModel = createChatModel(process.env, { failover: false });
  if (!chatModel.ok) {
    console.error(`Model not configured: ${chatModel.problem}`);
    return 1;
  }
  const label = option("label");
  if (!label || !/^[a-z0-9-]+$/.test(label)) {
    console.error("Pass --label=<lowercase-name>, which names the report file.");
    return 1;
  }
  const repeats = Number(option("repeats") ?? 3);
  const callGapMs = Number(option("call-gap-ms") ?? 4_500);
  const wanted = option("cases")?.split(",");
  const cases = wanted
    ? EVALUATION_CASES.filter((item) => wanted.includes(item.id))
    : EVALUATION_CASES;

  const profile = loadEvaluationProfile();
  const modelLabel = `${chatModel.provider}:${chatModel.modelId}`;
  const ask = (item: EvaluationCase) =>
    evaluateQuestion(item.question, {
      model: chatModel.model,
      providerOptions: chatModel.providerOptions,
      profile,
      additionalInstructions: chatInstructions(true),
      // Errors are summaries (type and status), which say why a run failed. The rest is noise here.
      logger: { info: () => {}, error: (...details) => console.error("   ", ...details) },
      ...(item.history && { history: item.history }),
    });
  console.log(`Evaluating ${cases.length} cases, ${repeats} times each, with ${modelLabel}\n`);

  const date = new Date().toISOString().slice(0, 10);
  const outFile = path.join(process.cwd(), "..", "..", "docs", "evaluation", `${date}-${label}.md`);
  const notes = option("notes");
  const runs: EvaluationRun[] = [];
  // Written after every case, so a run that is stopped still leaves its results.
  const writeReport = () =>
    writeFile(
      outFile,
      formatReport(
        {
          title: `Evaluation: ${label}`,
          date,
          model: modelLabel,
          repeats,
          ...(notes && { notes }),
        },
        cases.filter((item) => runs.some((run) => run.caseId === item.id)),
        runs,
      ),
    );
  for (const item of cases) {
    for (let repeat = 1; repeat <= repeats; repeat += 1) {
      let turn = await ask(item);
      for (let attempt = 2; turn.failed && attempt <= MAX_ATTEMPTS; attempt += 1) {
        console.log(`  ${item.id} #${repeat}: provider failure, waiting to retry`);
        await sleep(RETRY_WAIT_MS);
        turn = await ask(item);
      }
      const run: EvaluationRun = {
        caseId: item.id,
        turn,
        checks: turn.failed ? [] : scoreEvaluationTurn(turn, item.expect),
      };
      runs.push(run);
      const outcome = turn.failed ? "provider failure" : runPassed(run) ? "passed" : "failed";
      console.log(`  ${item.id} #${repeat}: ${outcome}`);
      await sleep(Math.max(turn.steps, 1) * callGapMs);
    }
    await writeReport();
  }

  const summary = summarize(cases, runs);
  console.log(
    `\n${summary.passedRuns} of ${summary.runs - summary.failedRuns} scored runs passed; ${summary.failedRuns} provider failures.`,
  );
  console.log(`Wrote ${outFile}. Read the answers: passing the checks does not make one right.`);
  return 0;
}

process.exitCode = await main();
