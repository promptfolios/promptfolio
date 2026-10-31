import { canonicalProfileContent, isRecordId, type Profile } from "@promptfolio/core";
import { asSchema, type FlexibleSchema, type UIMessage, type UIMessageChunk } from "ai";
import { z } from "zod";
import { type ChatTurnOptions, runChatTurn } from "./chat-turn";
import { type ChatSources, evidenceIdsIn, sourcesChunk, unverifiedIds } from "./citations";
import { CHAT_LIMITS } from "./limits";
import { createProfileTools } from "./profile-tools";
import type { ChatTrigger } from "./request";
import { buildSystemPrompt, type SystemPromptOptions } from "./system-prompt";

/**
 * Prepared answers: answers to the conversation starters, generated ahead of time by the
 * same pipeline as a live answer and served without a model call while they are still
 * current. "Current" means both fingerprints match: the profile content and the
 * instructions and tools the model saw. Any mismatch falls back to live generation.
 */

export const PREPARED_ANSWER_LIMITS = {
  maxAnswers: 20,
  /**
   * A stored answer starts every thread it serves, so a long one would use up the conversation's
   * `maxTotalChars` for each of them.
   */
  maxTextChars: CHAT_LIMITS.maxMessageChars,
  maxEvidenceIds: 50,
} as const;

const fingerprintSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/, "Expected sha256:<64 hex>");
// The same rule as record ids in @promptfolio/core: a slug or a source key.
const recordIdSchema = z.string().refine(isRecordId, "Expected a record id");

const preparedAnswerSchema = z.strictObject({
  question: z.string().trim().min(1).max(CHAT_LIMITS.maxMessageChars),
  text: z.string().min(1).max(PREPARED_ANSWER_LIMITS.maxTextChars),
  profileFingerprint: fingerprintSchema,
  instructionsFingerprint: fingerprintSchema,
  /** Record ids the tools returned while generating; for review, not for the validity check. */
  evidenceIds: z.array(recordIdSchema).max(PREPARED_ANSWER_LIMITS.maxEvidenceIds),
  /** The model that wrote the answer, as configured by the app; for review only. */
  model: z.string().min(1).max(200),
  generatedAt: z.iso.datetime(),
});

const preparedAnswersFileSchema = z
  .strictObject({
    formatVersion: z.literal(1),
    answers: z.array(preparedAnswerSchema).max(PREPARED_ANSWER_LIMITS.maxAnswers),
  })
  .refine(
    (file) => new Set(file.answers.map((answer) => answer.question)).size === file.answers.length,
    { message: "Each question may appear only once", path: ["answers"] },
  );

export type PreparedAnswer = z.infer<typeof preparedAnswerSchema>;

export interface PreparedAnswersFile {
  formatVersion: 1;
  answers: PreparedAnswer[];
}

export type ParsePreparedAnswersResult =
  | { ok: true; answers: PreparedAnswer[] }
  | { ok: false; issues: string[] };

/**
 * Validates the content of a prepared-answers file. The file is untrusted input like any
 * other: anything that does not match the schema is rejected as a whole, and the caller
 * then serves every question live.
 */
export function parsePreparedAnswers(data: unknown): ParsePreparedAnswersResult {
  const parsed = preparedAnswersFileSchema.safeParse(data);
  if (parsed.success) return { ok: true, answers: parsed.data.answers };
  return {
    ok: false,
    issues: parsed.error.issues.map(
      (issue) => `${issue.path.join(".") || "(file)"}: ${issue.message}`,
    ),
  };
}

/** Fingerprint of the profile's content, without observation timestamps. */
export function profileFingerprint(profile: Profile): Promise<string> {
  return sha256(canonicalProfileContent(profile));
}

/**
 * Fingerprint of what the model is told: the system prompt and each tool's name,
 * description, and input schema. Changing any of them invalidates every prepared answer.
 */
export async function instructionsFingerprint(
  profile: Profile,
  promptOptions: SystemPromptOptions = {},
): Promise<string> {
  const tools = createProfileTools(profile, { maxCalls: 0 });
  const toolDefinitions = await Promise.all(
    Object.entries(tools).map(async ([name, tool]) => ({
      name,
      description: tool.description,
      // Each tool has its own input type; only the JSON schema is needed here.
      inputSchema: await asSchema(tool.inputSchema as FlexibleSchema<unknown>).jsonSchema,
    })),
  );
  return sha256(
    JSON.stringify({
      instructions: buildSystemPrompt(profile.identity, promptOptions),
      tools: toolDefinitions,
    }),
  );
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"));
  return `sha256:${hex.join("")}`;
}

export type PreparedAnswerMiss =
  | "not-first-turn"
  | "regenerate"
  | "no-entry"
  | "stale-profile"
  | "stale-instructions";

export type PreparedAnswerSelection =
  | { outcome: "hit"; answer: PreparedAnswer }
  | { outcome: "miss"; reason: PreparedAnswerMiss };

/**
 * Decides whether a validated request may be answered with a prepared answer.
 *
 * Only the first turn of a conversation qualifies, matched on the exact question text
 * (trimmed). A regenerate request always goes live: the visitor asked for a new answer.
 * Fingerprints are computed only when an entry matches.
 */
export async function selectPreparedAnswer(
  messages: UIMessage[],
  trigger: ChatTrigger,
  answers: readonly PreparedAnswer[],
  profile: Profile,
  promptOptions: SystemPromptOptions = {},
): Promise<PreparedAnswerSelection> {
  if (messages.length !== 1) return miss("not-first-turn");
  if (trigger === "regenerate-message") return miss("regenerate");

  const question = textOf(messages[0]).trim();
  const answer = answers.find((entry) => entry.question === question);
  if (answer === undefined) return miss("no-entry");

  const stale = await staleReason(answer, profile, promptOptions);
  return stale === undefined ? { outcome: "hit", answer } : miss(stale);
}

/**
 * Whether the server would still serve this answer: its profile and instructions fingerprints both
 * match. So a command that regenerates answers uses the same rule as the server.
 */
export async function isPreparedAnswerCurrent(
  answer: PreparedAnswer,
  profile: Profile,
  promptOptions: SystemPromptOptions = {},
): Promise<boolean> {
  return (await staleReason(answer, profile, promptOptions)) === undefined;
}

async function staleReason(
  answer: PreparedAnswer,
  profile: Profile,
  promptOptions: SystemPromptOptions,
): Promise<"stale-profile" | "stale-instructions" | undefined> {
  if (answer.profileFingerprint !== (await profileFingerprint(profile))) return "stale-profile";
  if (answer.instructionsFingerprint !== (await instructionsFingerprint(profile, promptOptions))) {
    return "stale-instructions";
  }
  return undefined;
}

function miss(reason: PreparedAnswerMiss): PreparedAnswerSelection {
  return { outcome: "miss", reason };
}

function textOf(message: UIMessage | undefined): string {
  return (message?.parts ?? []).map((part) => (part.type === "text" ? part.text : "")).join("");
}

/**
 * The UI message chunks of a one-step text answer, as the AI SDK would stream them, with its
 * sources if it has any. No model is involved; the caller still sends them through the visitor
 * filter.
 */
export function preparedAnswerStream(
  text: string,
  sources?: ChatSources,
): ReadableStream<UIMessageChunk> {
  const chunks: UIMessageChunk[] = [
    { type: "start" },
    { type: "start-step" },
    { type: "text-start", id: "prepared" },
    { type: "text-delta", id: "prepared", delta: text },
    { type: "text-end", id: "prepared" },
    { type: "finish-step" },
    ...(sources === undefined ? [] : [sourcesChunk(sources)]),
    { type: "finish", finishReason: "stop" },
  ];
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

export interface GeneratePreparedAnswerOptions extends ChatTurnOptions {
  /** How the app names the model, for example `google:gemini-3.8-flash`; stored for review. */
  modelLabel: string;
  /** Defaults to the current time. */
  now?: () => Date;
}

export type PreparedAnswerRejection =
  | "error"
  | "not-finished"
  | "empty"
  | "too-long"
  | "unsupported-citation";

export type GeneratePreparedAnswerResult =
  | { ok: true; answer: PreparedAnswer }
  | { ok: false; reason: PreparedAnswerRejection; detail?: string };

/**
 * Generates a prepared answer by running the live turn for `question` and recording what a
 * visitor would have received. The answer is accepted only if the turn finished normally,
 * the text fits the message limit, and every `[id]` it cites was returned by a tool in this
 * turn or is the identity block (a stored answer is served to every visitor, so it is held to a
 * stricter rule than a live one, where an unverified citation is only reported).
 */
export async function generatePreparedAnswer(
  question: string,
  options: GeneratePreparedAnswerOptions,
): Promise<GeneratePreparedAnswerResult> {
  const requestId = `prep-${crypto.randomUUID().slice(0, 8)}`;
  const messages: UIMessage[] = [
    { id: "question", role: "user", parts: [{ type: "text", text: question.trim() }] },
  ];
  const { result, stream } = await runChatTurn(messages, options, {
    requestId,
    signal: new AbortController().signal,
  });

  const { text, failed } = await readVisitorText(stream);
  if (failed) return { ok: false, reason: "error" };

  let finishReason: string;
  let evidenceIds: string[];
  try {
    finishReason = await result.finishReason;
    evidenceIds = evidenceIdsIn((await result.steps).flatMap((step) => step.toolResults));
  } catch {
    return { ok: false, reason: "error" };
  }

  if (finishReason !== "stop") return { ok: false, reason: "not-finished", detail: finishReason };
  if (text.trim() === "") return { ok: false, reason: "empty" };
  if (text.length > PREPARED_ANSWER_LIMITS.maxTextChars) {
    return { ok: false, reason: "too-long", detail: `${text.length} characters` };
  }
  const unsupported = unverifiedIds(text, evidenceIds);
  if (unsupported.length > 0) {
    return { ok: false, reason: "unsupported-citation", detail: unsupported.join(", ") };
  }

  const { profile, contactFormAvailable, modelLabel, now = () => new Date() } = options;
  return {
    ok: true,
    answer: {
      question: question.trim(),
      text,
      profileFingerprint: await profileFingerprint(profile),
      instructionsFingerprint: await instructionsFingerprint(profile, { contactFormAvailable }),
      evidenceIds: evidenceIds.slice(0, PREPARED_ANSWER_LIMITS.maxEvidenceIds),
      model: modelLabel,
      generatedAt: now().toISOString(),
    },
  };
}

/**
 * Reads the visitor stream to its end and returns its text: text parts joined by a blank
 * line, as they would appear in the chat. `failed` is set when the stream carried an error.
 */
export async function readVisitorText(
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
