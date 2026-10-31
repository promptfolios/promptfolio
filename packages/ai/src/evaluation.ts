import type { UIMessage } from "ai";
import { type ChatTurnOptions, runChatTurn } from "./chat-turn";
import { citedIds, evidenceIdsIn, unverifiedIds } from "./citations";
import { readVisitorText } from "./prepared-answers";

/**
 * Evaluation: run a question through the same turn a visitor gets, and check what can be checked
 * without judgement: which tools ran, which citations hold up, and which phrases appear. A fluent
 * answer proves nothing, and these checks do not prove an answer is right either, so a person still
 * reads the answers. No model judges another model.
 */

/** What one turn did, as far as code can tell. */
export interface EvaluationTurn {
  text: string;
  /** The turn ended in a provider error or a timeout, so it says nothing about the answer. */
  failed: boolean;
  /** The model wrote a tool call as text, and the server stopped it. A fault of the model's. */
  rawToolCall: boolean;
  finishReason?: string;
  /** Model calls made in this turn. */
  steps: number;
  /** The tool called each time, in order. */
  toolCalls: string[];
  /** Record ids the tools returned. */
  returnedIds: string[];
  /** Cited ids that were returned in this turn, or are the identity block. */
  verifiedIds: string[];
  /** Cited ids with nothing behind them. */
  unverifiedIds: string[];
  inputTokens?: number;
  outputTokens?: number;
}

export interface EvaluateQuestionOptions extends ChatTurnOptions {
  /** Earlier messages, for a case about what a conversation's history can and cannot prove. */
  history?: UIMessage[];
}

/**
 * Runs one question through the live turn: the same prompt, tools, and budgets as a visitor's. A
 * provider failure comes back as `failed`, not as an exception, so one failure does not end a run.
 */
export async function evaluateQuestion(
  question: string,
  { history = [], ...options }: EvaluateQuestionOptions,
): Promise<EvaluationTurn> {
  const messages: UIMessage[] = [
    ...history,
    { id: "question", role: "user", parts: [{ type: "text", text: question }] },
  ];
  const { result, stream, wasRawToolCallBlocked } = await runChatTurn(messages, options, {
    requestId: `eval-${crypto.randomUUID().slice(0, 8)}`,
    signal: new AbortController().signal,
  });
  const { text, failed } = await readVisitorText(stream);
  const rawToolCall = wasRawToolCallBlocked();

  const empty = {
    rawToolCall,
    steps: 0,
    toolCalls: [],
    returnedIds: [],
    verifiedIds: [],
    unverifiedIds: [],
  };
  // A blocked tool call also ends the stream in an error, but this turn can and must be scored.
  if (failed && !rawToolCall) return { ...empty, text, failed: true };
  try {
    const steps = await result.steps;
    const returnedIds = evidenceIdsIn(steps.flatMap((step) => step.toolResults));
    const unverified = unverifiedIds(text, returnedIds);
    const usage = await result.usage;
    return {
      text,
      failed: false,
      rawToolCall,
      finishReason: await result.finishReason,
      steps: steps.length,
      toolCalls: steps.flatMap((step) => step.toolCalls.map((call) => call.toolName)),
      returnedIds,
      verifiedIds: citedIds(text).filter((id) => !unverified.includes(id)),
      unverifiedIds: unverified,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    };
  } catch {
    return { ...empty, text, failed: true };
  }
}

/** What a case requires of a turn. Everything is optional, and only what is set is checked. */
export interface EvaluationExpectation {
  /** At least one tool was called. */
  lookup?: boolean;
  /** Each of these was cited, and the citation holds up. */
  cites?: string[];
  /** At least this many citations hold up. */
  minVerifiedCitations?: number;
  /** All of these appear. */
  mustMatch?: RegExp[];
  /** At least one of these appears, for what can be worded many ways. */
  mustMatchAny?: RegExp[];
  /** None of these appear. */
  mustNotMatch?: RegExp[];
}

export interface EvaluationCheck {
  name: string;
  passed: boolean;
  /** What went wrong. Answers are for the report, so this only names the check's own terms. */
  detail?: string;
}

/**
 * The checks for one finished turn. Every turn must write no raw tool call, finish normally, say
 * something, and have no unverified citations. The rest comes from the case. Exact wording is deliberately not required.
 */
export function scoreEvaluationTurn(
  turn: EvaluationTurn,
  expectation: EvaluationExpectation,
): EvaluationCheck[] {
  const check = (name: string, passed: boolean, detail?: string): EvaluationCheck => ({
    name,
    passed,
    ...(!passed && detail !== undefined && { detail }),
  });
  const checks = [
    check("no raw tool call", !turn.rawToolCall),
    check("finished", turn.finishReason === "stop", `finish reason ${turn.finishReason}`),
    check("has an answer", turn.text.trim() !== ""),
    check(
      "no unverified citations",
      turn.unverifiedIds.length === 0,
      turn.unverifiedIds.join(", "),
    ),
  ];
  const { lookup, cites, minVerifiedCitations, mustMatch, mustMatchAny, mustNotMatch } =
    expectation;

  if (lookup) checks.push(check("looked up", turn.toolCalls.length > 0));
  for (const id of cites ?? []) {
    checks.push(check(`cites ${id}`, turn.verifiedIds.includes(id)));
  }
  if (minVerifiedCitations !== undefined) {
    checks.push(
      check(
        `at least ${minVerifiedCitations} verified citations`,
        turn.verifiedIds.length >= minVerifiedCitations,
        `${turn.verifiedIds.length} verified`,
      ),
    );
  }
  for (const pattern of mustMatch ?? []) {
    checks.push(check(`says ${pattern}`, pattern.test(turn.text)));
  }
  if (mustMatchAny !== undefined) {
    checks.push(
      check(
        `says one of ${mustMatchAny.join(" ")}`,
        mustMatchAny.some((pattern) => pattern.test(turn.text)),
      ),
    );
  }
  for (const pattern of mustNotMatch ?? []) {
    checks.push(check(`does not say ${pattern}`, !pattern.test(turn.text)));
  }
  return checks;
}
