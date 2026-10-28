import type { Profile } from "@promptfolio/core";
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  type LanguageModel,
  streamText,
  toUIMessageStream,
  type UIMessageChunk,
} from "ai";
import { CHAT_LIMITS } from "./limits";
import { parseChatRequest } from "./request";
import { buildSystemPrompt } from "./system-prompt";

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

export interface ChatHandlerOptions {
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
 * Handles one chat turn: validates the request, builds the server-owned system prompt,
 * and streams the model's reply back as an AI SDK UI message stream.
 *
 * Framework-agnostic: takes a web `Request` and returns a web `Response`.
 * Server-only: the model carries the provider credentials.
 */
export async function handleChatRequest(
  request: Request,
  options: ChatHandlerOptions,
): Promise<Response> {
  const { model, profile, providerOptions, logger = console } = options;
  const requestId = crypto.randomUUID().slice(0, 8);

  const parsed = await parseChatRequest(request);
  if (!parsed.ok) return textResponse(parsed.status, parsed.message);

  const result = streamText({
    model,
    instructions: buildSystemPrompt(profile.identity),
    messages: await convertToModelMessages(parsed.messages),
    maxOutputTokens: options.maxOutputTokens ?? CHAT_LIMITS.maxOutputTokens,
    providerOptions,
    timeout: options.timeouts ?? CHAT_LIMITS.timeouts,
    maxRetries: CHAT_LIMITS.maxRetries,
    abortSignal: request.signal,
    onError: ({ error }) => {
      // Full details stay in the server log; visitors only see the generic message.
      logger.error(`[chat ${requestId}] model error`, error);
    },
    onEnd: (event) => {
      logger.info(`[chat ${requestId}] finished`, {
        finishReason: event.finishReason,
        // Aggregated across all steps (v7 renamed `totalUsage` to `usage`).
        usage: event.usage,
      });
    },
    onAbort: () => {
      // The AI SDK reports its own timeouts as aborts too.
      if (request.signal.aborted) logger.info(`[chat ${requestId}] aborted by the client`);
      else logger.error(`[chat ${requestId}] model timed out`);
    },
  });

  const stream = toUIMessageStream({
    stream: result.stream,
    sendReasoning: false,
    onError: () => genericErrorMessage(requestId),
  }).pipeThrough(forVisitor(request.signal, requestId));
  return createUIMessageStreamResponse({ stream });
}

/**
 * Adjusts the UI message stream before it reaches the browser:
 *
 * - Drops `custom` chunks: provider-specific metadata (for example Anthropic's message id,
 *   model, and token usage) that the visitor does not need. The client would otherwise
 *   store them in the assistant message and send them back, where the request allowlist
 *   rejects them.
 * - Turns an `abort` the visitor did not cause (a timeout) into the generic error. The
 *   browser treats `abort` like pressing Stop, so the reply would otherwise end silently.
 */
function forVisitor(
  clientSignal: AbortSignal,
  requestId: string,
): TransformStream<UIMessageChunk, UIMessageChunk> {
  return new TransformStream({
    transform(chunk, controller) {
      if (chunk.type === "custom") return;
      if (chunk.type === "abort" && !clientSignal.aborted) {
        controller.enqueue({ type: "error", errorText: genericErrorMessage(requestId) });
        return;
      }
      controller.enqueue(chunk);
    },
  });
}

function textResponse(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
