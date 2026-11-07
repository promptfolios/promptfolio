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
import {
  createProfileTools,
  listInputSchema,
  type ProfileTools,
} from "../grounding/profile-tools.ts";
import type { ChatLimitOverrides, ChatLimits } from "./limits.ts";
import { type ChatMessages, unavailableMessage } from "./messages.ts";
import { withoutRawToolCalls } from "./raw-tool-calls.ts";
import { buildSystemPrompt, type SystemPromptOptions } from "./system-prompt.ts";

type StreamTextOptions = Parameters<typeof streamText>[0];

/** Provider-specific settings, passed through unchanged (for example `{ anthropic: { effort: "low" } }`). */
export type ChatProviderOptions = NonNullable<StreamTextOptions["providerOptions"]>;

/** Where the handler reports errors and usage. Defaults to `console`. */
export type ChatLogger = Pick<Console, "info" | "error">;

/** Everything one model turn needs. Shared by live chat and the evaluation. */
export interface ChatTurnOptions extends SystemPromptOptions {
  /** Any AI SDK language model; the application chooses the provider. */
  model: LanguageModel;
  profile: Profile;
  providerOptions?: ChatProviderOptions;
  /** Changes to `CHAT_LIMITS`. Anything left out keeps its default. */
  limits?: ChatLimitOverrides;
  /** Changes to `CHAT_MESSAGES`. Anything left out keeps its default. */
  visitorMessages?: Partial<ChatMessages>;
  logger?: ChatLogger;
}

/** What one turn produced. */
export interface ChatTurn {
  /** The AI SDK result, for server-side details such as tool results. */
  result: ReturnType<typeof streamText<ProfileTools>>;
  /** The stream exactly as a visitor receives it. */
  stream: ReadableStream<UIMessageChunk>;
  /** Whether the stream stopped a raw tool call, which is known once it has been read. */
  wasRawToolCallBlocked: () => boolean;
}

/** One request's identity and its options with the defaults applied. */
export interface ChatTurnContext {
  requestId: string;
  signal: AbortSignal;
  limits: ChatLimits;
  text: ChatMessages;
}

/**
 * Runs one model turn over already validated messages: the server-owned system prompt, the
 * profile lookup tools, and the step and call budgets.
 */
export async function runChatTurn(
  messages: UIMessage[],
  options: ChatTurnOptions,
  { requestId, signal, limits, text }: ChatTurnContext,
): Promise<ChatTurn> {
  const { model, profile, providerOptions, additionalInstructions, logger = console } = options;
  const errorText = unavailableMessage(text, requestId);
  // Model ids are the application's configuration, not visitor text, so they are safe to log.
  const configuredModelId = typeof model === "string" ? model : model.modelId;

  const result = streamText({
    model,
    instructions: buildSystemPrompt(profile.identity, { additionalInstructions }),
    messages: await convertToModelMessages(messages),
    // Only the server's tools exist; the client cannot add any (see parseChatRequest).
    tools: createProfileTools(profile, { maxCalls: limits.maxToolCalls }),
    stopWhen: isStepCount(limits.maxSteps),
    // The last allowed step must answer in text instead of ending on another tool call.
    prepareStep: ({ stepNumber }) =>
      stepNumber === limits.maxSteps - 1 ? { toolChoice: "none" } : undefined,
    // Per step: a turn with lookups makes several model calls.
    maxOutputTokens: limits.maxOutputTokens,
    providerOptions,
    timeout: limits.timeouts,
    maxRetries: limits.maxRetries,
    abortSignal: signal,
    onError: ({ error }) => {
      // Visitors only see the generic message, and the log only a summary (see below).
      // No response says which model failed, so this is the configured one. For a failover model
      // that is every label; its own log names the model that failed.
      logger.error(`[chat ${requestId}] model error`, {
        model: configuredModelId,
        ...modelErrorSummary(error),
      });
    },
    onEnd: (event) => {
      logger.info(`[chat ${requestId}] finished`, {
        // The model that answered the last step, as its provider reports it. A provider that
        // does not report one leaves the configured id (for a failover model, every label).
        model: event.finalStep.response.modelId || configuredModelId,
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

  let rawToolCallBlocked = false;
  const stream = toUIMessageStream({
    stream: result.stream,
    sendReasoning: false,
    onError: () => errorText,
  })
    .pipeThrough(logToolCalls(requestId, logger))
    .pipeThrough(
      withoutRawToolCalls({
        errorText,
        onBlocked: () => {
          rawToolCallBlocked = true;
          logger.error(`[chat ${requestId}] raw tool call blocked`);
        },
      }),
    )
    .pipeThrough(forVisitor(signal, errorText));
  return { result, stream, wasRawToolCallBlocked: () => rawToolCallBlocked };
}

/**
 * What the log keeps of a model error: its type, status, and whether a retry could help. The
 * error itself stays out, because an `APICallError` carries the whole request (the visitor's
 * conversation) and the provider's response, and other errors can repeat them in their message.
 */
export function modelErrorSummary(error: unknown) {
  // After its retries, the AI SDK wraps the provider's error.
  const cause = RetryError.isInstance(error) ? error.lastError : error;
  // Read by shape: AI Gateway's errors carry a status too, and `ai` does not export their class.
  const statusCode =
    typeof cause === "object" && cause !== null && "statusCode" in cause
      ? cause.statusCode
      : undefined;
  return {
    name: cause instanceof Error ? cause.name : "unknown",
    ...(typeof statusCode === "number" && { statusCode }),
    ...(APICallError.isInstance(cause) && { isRetryable: cause.isRetryable }),
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
 */
export function forVisitor(
  clientSignal: AbortSignal,
  errorText: string,
): TransformStream<UIMessageChunk, UIMessageChunk> {
  return new TransformStream({
    transform(chunk, controller) {
      if (!VISITOR_CHUNK_TYPES.has(chunk.type)) return;
      if (chunk.type === "abort" && !clientSignal.aborted) {
        controller.enqueue({ type: "error", errorText });
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
 *
 * Arguments are written by the model and may echo visitor text, so they are not logged as
 * they are. Only values that cannot carry free text are added, so that calls can be told apart:
 *
 * - `listProfileRecords`: `section`, which is one of the schema's fixed values, and
 *   `skillFilter: true` when a skill was given (never the skill itself);
 * - `getProfileRecord`: `id`, only when the outcome is `found`, because the id then matched one
 *   of the profile's own records. A `not_found` id is whatever the model wrote.
 *
 * An invalid call (unknown tool or arguments that fail the schema) arrives as a
 * `tool-input-error` followed by a `tool-output-error`; it is logged once, as `invalid`, with
 * no details. A `tool-output-error` on its own means `execute` threw, which is a bug.
 */
function logToolCalls(
  requestId: string,
  logger: ChatLogger,
): TransformStream<UIMessageChunk, UIMessageChunk> {
  const toolNames = new Map<string, string>();
  const inputs = new Map<string, unknown>();
  const invalidCalls = new Set<string>();
  return new TransformStream({
    transform(chunk, controller) {
      switch (chunk.type) {
        case "tool-input-available":
          toolNames.set(chunk.toolCallId, chunk.toolName);
          inputs.set(chunk.toolCallId, chunk.input);
          break;
        case "tool-input-error":
          invalidCalls.add(chunk.toolCallId);
          logger.info(`[chat ${requestId}] tool call`, {
            tool: chunk.toolName,
            outcome: "invalid",
          });
          break;
        case "tool-output-available": {
          const tool = toolNames.get(chunk.toolCallId);
          const outcome = outcomeOf(chunk.output);
          logger.info(`[chat ${requestId}] tool call`, {
            tool,
            outcome,
            ...safeCallDetails(tool, inputs.get(chunk.toolCallId), outcome),
          });
          break;
        }
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

/**
 * The parts of a call's input that are safe to log (see `logToolCalls`). The input is read by
 * shape and checked against the tool's own schema values, so nothing else gets through.
 */
function safeCallDetails(
  tool: string | undefined,
  input: unknown,
  outcome: string,
): Record<string, string | boolean> {
  if (typeof input !== "object" || input === null) return {};
  if (tool === "listProfileRecords") {
    const section =
      "section" in input ? listInputSchema.shape.section.safeParse(input.section) : undefined;
    return {
      ...(section?.success && { section: section.data }),
      ...("skill" in input && input.skill !== undefined && { skillFilter: true }),
    };
  }
  if (tool === "getProfileRecord" && outcome === "found" && "id" in input) {
    return typeof input.id === "string" ? { id: input.id } : {};
  }
  return {};
}

function outcomeOf(output: unknown): string {
  if (typeof output === "object" && output !== null && "status" in output) {
    return String(output.status);
  }
  return "unknown";
}
