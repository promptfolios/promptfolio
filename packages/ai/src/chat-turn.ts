import type { Profile } from "@promptfolio/core";
import {
  APICallError,
  convertToModelMessages,
  isStepCount,
  type LanguageModel,
  RetryError,
  streamText,
  toUIMessageStream,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import { CHAT_LIMITS } from "./limits";
import { createProfileTools } from "./profile-tools";
import { buildSystemPrompt, type SystemPromptOptions } from "./system-prompt";

type StreamTextOptions = Parameters<typeof streamText>[0];

/** Provider-specific settings, passed through unchanged (for example `{ anthropic: { effort: "low" } }`). */
export type ChatProviderOptions = NonNullable<StreamTextOptions["providerOptions"]>;

/** Provider timeouts in milliseconds. Defaults to `CHAT_LIMITS.timeouts`. */
export interface ChatTimeouts {
  firstChunkMs: number;
  chunkMs: number;
  totalMs: number;
}

/** Where the handler reports errors and usage. Defaults to `console`. */
export type ChatLogger = Pick<Console, "info" | "error">;

/** Everything one model turn needs. Shared by live chat and prepared-answer generation. */
export interface ChatTurnOptions extends SystemPromptOptions {
  /** Any AI SDK language model; the application chooses the provider. */
  model: LanguageModel;
  profile: Profile;
  providerOptions?: ChatProviderOptions;
  /** Defaults to `CHAT_LIMITS.maxOutputTokens`. */
  maxOutputTokens?: number;
  timeouts?: ChatTimeouts;
  logger?: ChatLogger;
}

/** Shown to visitors for any failure that is not their input's fault. */
export function genericErrorMessage(requestId: string): string {
  return `The assistant could not answer right now. Please try again later. (ref ${requestId})`;
}

/**
 * Runs one model turn over already validated messages: the server-owned system prompt, the
 * profile lookup tools, and the step and call budgets. Returns the AI SDK result (for
 * server-side details such as tool results) and the stream exactly as a visitor receives it.
 */
export async function runChatTurn(
  messages: UIMessage[],
  options: ChatTurnOptions,
  { requestId, signal }: { requestId: string; signal: AbortSignal },
) {
  const { model, profile, providerOptions, contactFormAvailable, logger = console } = options;

  const result = streamText({
    model,
    instructions: buildSystemPrompt(profile.identity, { contactFormAvailable }),
    messages: await convertToModelMessages(messages),
    // Only the server's tools exist; the client cannot add any (see parseChatRequest).
    tools: createProfileTools(profile, { maxCalls: CHAT_LIMITS.maxToolCalls }),
    stopWhen: isStepCount(CHAT_LIMITS.maxSteps),
    // The last allowed step must answer in text instead of ending on another tool call.
    prepareStep: ({ stepNumber }) =>
      stepNumber === CHAT_LIMITS.maxSteps - 1 ? { toolChoice: "none" } : undefined,
    // Per step: a turn with lookups makes several model calls.
    maxOutputTokens: options.maxOutputTokens ?? CHAT_LIMITS.maxOutputTokens,
    providerOptions,
    timeout: options.timeouts ?? CHAT_LIMITS.timeouts,
    maxRetries: CHAT_LIMITS.maxRetries,
    abortSignal: signal,
    onError: ({ error }) => {
      // Visitors only see the generic message, and the log only a summary (see below).
      logger.error(`[chat ${requestId}] model error`, modelErrorSummary(error));
    },
    onEnd: (event) => {
      logger.info(`[chat ${requestId}] finished`, {
        finishReason: event.finishReason,
        steps: event.stepNumber + 1,
        // Aggregated across all steps (v7 renamed `totalUsage` to `usage`).
        usage: event.usage,
      });
    },
    onAbort: () => {
      // The AI SDK reports its own timeouts as aborts too.
      if (signal.aborted) logger.info(`[chat ${requestId}] aborted by the client`);
      else logger.error(`[chat ${requestId}] model timed out`);
    },
  });

  const stream = toUIMessageStream({
    stream: result.stream,
    sendReasoning: false,
    onError: () => genericErrorMessage(requestId),
  })
    .pipeThrough(logToolCalls(requestId, logger))
    .pipeThrough(forVisitor(signal, requestId));
  return { result, stream };
}

/**
 * What the log keeps of a model error: its type, status, and whether a retry could help. The
 * error itself stays out, because an `APICallError` carries the whole request (the visitor's
 * conversation) and the provider's response, and other errors can repeat them in their message.
 */
function modelErrorSummary(error: unknown) {
  // After its retries, the AI SDK wraps the provider's error.
  const cause = RetryError.isInstance(error) ? error.lastError : error;
  return {
    name: cause instanceof Error ? cause.name : "unknown",
    ...(APICallError.isInstance(cause) && {
      statusCode: cause.statusCode,
      isRetryable: cause.isRetryable,
    }),
    ...(RetryError.isInstance(error) && { attempts: error.errors.length }),
  };
}

/**
 * The only chunk types the browser receives: enough to render a streamed text answer.
 * Everything else is dropped, including:
 *
 * - tool calls, results, and errors: tool activity stays on the server, so the browser
 *   never learns tool names, schemas, or result fields, and never has tool parts to send
 *   back (the request allowlist rejects them);
 * - `custom` chunks: provider-specific metadata such as Anthropic's message id and usage;
 * - any chunk type a future AI SDK version adds, until it is allowed here on purpose.
 */
const VISITOR_CHUNK_TYPES: ReadonlySet<UIMessageChunk["type"]> = new Set([
  "start",
  "start-step",
  "finish-step",
  "text-start",
  "text-delta",
  "text-end",
  "finish",
  "error",
  "abort",
]);

/**
 * Filters the UI message stream before it reaches the browser:
 *
 * - passes only `VISITOR_CHUNK_TYPES`;
 * - removes `providerMetadata` from the chunks it passes. Allowed text chunks can still carry
 *   provider data, such as Gemini's encrypted `thoughtSignature` on every `text-delta`; the
 *   browser does not need it, and the request allowlist would drop it on the way back anyway;
 * - turns an `abort` the visitor did not cause (a timeout) into the generic error. The browser
 *   treats `abort` like pressing Stop, so the reply would otherwise end silently.
 *
 * Prepared answers go through the same filter, so both paths share one allowlist.
 */
export function forVisitor(
  clientSignal: AbortSignal,
  requestId: string,
): TransformStream<UIMessageChunk, UIMessageChunk> {
  return new TransformStream({
    transform(chunk, controller) {
      if (!VISITOR_CHUNK_TYPES.has(chunk.type)) return;
      if (chunk.type === "abort" && !clientSignal.aborted) {
        controller.enqueue({ type: "error", errorText: genericErrorMessage(requestId) });
        return;
      }
      controller.enqueue(withoutProviderMetadata(chunk));
    },
  });
}

function withoutProviderMetadata(chunk: UIMessageChunk): UIMessageChunk {
  if (!("providerMetadata" in chunk)) return chunk;
  const { providerMetadata: _providerMetadata, ...rest } = chunk;
  return rest;
}

/**
 * Logs each tool call's name and outcome on the server, and passes every chunk through.
 * Arguments are not logged, because they may echo visitor text.
 *
 * An invalid call (unknown tool or arguments that fail the schema) arrives as a
 * `tool-input-error` followed by a `tool-output-error`; it is logged once, as `invalid`.
 * A `tool-output-error` on its own means `execute` threw, which is a bug.
 */
function logToolCalls(
  requestId: string,
  logger: ChatLogger,
): TransformStream<UIMessageChunk, UIMessageChunk> {
  const toolNames = new Map<string, string>();
  const invalidCalls = new Set<string>();
  return new TransformStream({
    transform(chunk, controller) {
      switch (chunk.type) {
        case "tool-input-available":
          toolNames.set(chunk.toolCallId, chunk.toolName);
          break;
        case "tool-input-error":
          invalidCalls.add(chunk.toolCallId);
          logger.info(`[chat ${requestId}] tool call`, {
            tool: chunk.toolName,
            outcome: "invalid",
          });
          break;
        case "tool-output-available":
          logger.info(`[chat ${requestId}] tool call`, {
            tool: toolNames.get(chunk.toolCallId),
            outcome: outcomeOf(chunk.output),
          });
          break;
        case "tool-output-error":
          if (!invalidCalls.has(chunk.toolCallId)) {
            logger.error(`[chat ${requestId}] tool failed`, {
              tool: toolNames.get(chunk.toolCallId),
            });
          }
          break;
      }
      controller.enqueue(chunk);
    },
  });
}

function outcomeOf(output: unknown): string {
  if (typeof output === "object" && output !== null && "status" in output) {
    return String(output.status);
  }
  return "unknown";
}
