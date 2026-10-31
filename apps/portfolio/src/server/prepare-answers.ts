import type { GeneratePreparedAnswerResult, PreparedAnswer } from "@promptfolio/ai";

/** Attempts per starter. Only a provider error is tried again, usually a timeout or a quota. */
export const MAX_ATTEMPTS = 3;
/** Long enough for a provider's limit per minute to reset. */
export const RETRY_WAIT_MS = 65_000;

export interface PrepareAnswersOptions {
  questions: readonly string[];
  /** The answers already in the file. */
  existing: readonly PreparedAnswer[];
  isCurrent: (answer: PreparedAnswer) => Promise<boolean>;
  generate: (question: string) => Promise<GeneratePreparedAnswerResult>;
  /** Writes the file. Called after each accepted answer, so a stopped run keeps its work. */
  save: (answers: PreparedAnswer[]) => Promise<void>;
  /** Regenerates current answers too, for example after changing model. */
  all?: boolean;
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>;
  logger?: Pick<Console, "log">;
}

export interface PrepareAnswersResult {
  answers: PreparedAnswer[];
  /** 0 every starter has a good answer, 2 some failed, 1 no answers at all, nothing written. */
  exitCode: 0 | 1 | 2;
}

/**
 * Prepares the answers to the starters, one at a time, keeping what is already good. A current
 * answer needs no model call, unless `all` is set, and it stays if its replacement fails. A stale
 * answer is dropped, because the server would never serve it. A rejected answer is not tried again
 * here: the owner should read why.
 */
export async function prepareAnswers({
  questions,
  existing,
  isCurrent,
  generate,
  save,
  all = false,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  logger = console,
}: PrepareAnswersOptions): Promise<PrepareAnswersResult> {
  const answers = new Map<string, PreparedAnswer>();
  for (const answer of existing) {
    if (questions.includes(answer.question) && (await isCurrent(answer))) {
      answers.set(answer.question, answer);
    }
  }
  const inOrder = () => questions.flatMap((question) => answers.get(question) ?? []);
  const droppedAny = answers.size !== existing.length;

  let failed = 0;
  let accepted = 0;
  for (const question of questions) {
    if (!all && answers.has(question)) {
      logger.log(`  kept      ${question}`);
      continue;
    }
    const generated = await generateWithRetries(question, generate, sleep, logger);
    if (generated.ok) {
      answers.set(question, generated.answer);
      accepted += 1;
      await save(inOrder());
      logger.log(`  accepted  ${question}`);
    } else {
      failed += 1;
      const detail = generated.detail ? ` (${generated.detail})` : "";
      logger.log(`  rejected  ${question}: ${generated.reason}${detail}`);
    }
  }

  const result = inOrder();
  if (result.length === 0) return { answers: result, exitCode: 1 };
  if (accepted === 0 && droppedAny) await save(result);
  return { answers: result, exitCode: failed > 0 ? 2 : 0 };
}

async function generateWithRetries(
  question: string,
  generate: PrepareAnswersOptions["generate"],
  sleep: NonNullable<PrepareAnswersOptions["sleep"]>,
  logger: NonNullable<PrepareAnswersOptions["logger"]>,
): Promise<GeneratePreparedAnswerResult> {
  let generated = await generate(question);
  for (let attempt = 2; attempt <= MAX_ATTEMPTS; attempt += 1) {
    if (generated.ok || generated.reason !== "error") break;
    logger.log(`  provider error, trying again soon: ${question}`);
    await sleep(RETRY_WAIT_MS);
    generated = await generate(question);
  }
  return generated;
}
