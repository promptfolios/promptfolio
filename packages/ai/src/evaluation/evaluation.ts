import { profileLinkUrls } from "@promptfolio/core";
import type { UIMessage, UIMessageChunk } from "ai";
import { type ChatTurnOptions, runChatTurn } from "../chat/chat-turn";
import { resolveChatLimits } from "../chat/limits";
import { resolveChatMessages } from "../chat/messages";

/**
 * Public entry point of `@promptfolio/ai/evaluation`, separate from the main one because only a
 * consumer's test tooling needs it.
 *
 * Evaluation: run a question through the same turn a visitor gets, and check what can be checked
 * without judgement: which tools ran, which records they returned, which links the answer holds, and
 * which phrases appear. A fluent answer proves nothing, and these checks do not prove an answer is
 * right either, so a person still reads the answers. No model judges another model.
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
  /** The URLs the answer links to, normalized. */
  links: string[];
  /** Those of `links` that are not in the profile, which the page shows as plain text. */
  unknownLinks: string[];
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
 *
 * @throws {TypeError} If `limits` or `visitorMessages` is invalid, which no retry could fix.
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
    limits: resolveChatLimits(options.limits),
    text: resolveChatMessages(options.visitorMessages),
  });
  const { text, failed } = await readVisitorText(stream);
  const rawToolCall = wasRawToolCallBlocked();

  const empty = {
    rawToolCall,
    steps: 0,
    toolCalls: [],
    returnedIds: [],
    links: [],
    unknownLinks: [],
  };
  // A blocked tool call also ends the stream in an error, but this turn can and must be scored.
  if (failed && !rawToolCall) return { ...empty, text, failed: true };
  try {
    const steps = await result.steps;
    const links = linkedUrls(text);
    const profileLinks = new Set(profileLinkUrls(options.profile));
    const usage = await result.usage;
    return {
      text,
      failed: false,
      rawToolCall,
      finishReason: await result.finishReason,
      steps: steps.length,
      toolCalls: steps.flatMap((step) => step.toolCalls.map((call) => call.toolName)),
      returnedIds: returnedIdsIn(steps.flatMap((step) => step.toolResults)),
      links,
      unknownLinks: links.filter((url) => !profileLinks.has(url)),
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
  /** The tools returned each of these records in this turn. */
  returns?: string[];
  /** The answer links to each of these URLs. */
  links?: string[];
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
 * something, and link only to the profile. The rest comes from the case. Exact wording is
 * deliberately not required.
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
      "no links outside the profile",
      turn.unknownLinks.length === 0,
      turn.unknownLinks.join(", "),
    ),
  ];
  const { lookup, returns, links, mustMatch, mustMatchAny, mustNotMatch } = expectation;

  if (lookup) checks.push(check("looked up", turn.toolCalls.length > 0));
  for (const id of returns ?? []) {
    checks.push(check(`returned ${id}`, turn.returnedIds.includes(id)));
  }
  for (const url of links ?? []) {
    checks.push(check(`links ${url}`, turn.links.includes(url)));
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

/**
 * The record ids in profile tool results: listed records, a fetched record, and the role summary
 * that comes with a project. Source ids are not record ids and are not collected.
 */
function returnedIdsIn(toolResults: ReadonlyArray<{ output: unknown }>): string[] {
  const ids = new Set<string>();
  const add = (value: unknown) => {
    if (isObject(value) && typeof value.id === "string") ids.add(value.id);
  };
  for (const { output } of toolResults) {
    if (!isObject(output)) continue;
    if (Array.isArray(output.records)) output.records.forEach(add);
    add(output.record);
    add(output.role);
    add(output.ownerNotes);
  }
  return [...ids];
}

/**
 * The URLs an answer links to, as a Markdown link or written out, which the page also makes a link.
 * Code is skipped. Reference-style links are not read here, though the page checks those too.
 */
function linkedUrls(text: string): string[] {
  const withoutCode = text.replace(/```[\s\S]*?```|`[^`\n]*`/g, "");
  const urls = Array.from(
    withoutCode.matchAll(/\]\(\s*<?([^)\s>]+)|\bhttps?:\/\/[^\s)\]>"']+/g),
    (match) => match[1] ?? match[0],
  );
  const normalized = urls.flatMap((url) => {
    try {
      return [new URL(url).href];
    } catch {
      return [url];
    }
  });
  return [...new Set(normalized)];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Reads the visitor stream to its end and returns its text: text parts joined by a blank
 * line, as they would appear in the chat. `failed` is set when the stream carried an error.
 */
async function readVisitorText(
  stream: ReadableStream<UIMessageChunk>,
): Promise<{ text: string; failed: boolean }> {
  const parts: string[] = [];
  let current: string | undefined;
  let failed = false;
  for await (const chunk of stream) {
    if (chunk.type === "text-start") current = "";
    else if (chunk.type === "text-delta") current = (current ?? "") + chunk.delta;
    else if (chunk.type === "text-end" && current !== undefined) {
      if (current.trim() !== "") parts.push(current.trim());
      current = undefined;
    } else if (chunk.type === "error" || chunk.type === "abort") failed = true;
  }
  return { text: parts.join("\n\n"), failed };
}
