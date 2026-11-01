import { createUIMessageStreamResponse } from "ai";
import { type ChatLimit, checkChatLimit } from "./chat-limit.ts";
import { type ChatTurnContext, type ChatTurnOptions, runChatTurn } from "./chat-turn.ts";
import { resolveChatLimits } from "./limits.ts";
import { CHAT_MESSAGES, resolveChatMessages, unavailableMessage } from "./messages.ts";
import { parseChatRequest } from "./request.ts";

export type { ChatLogger, ChatProviderOptions } from "./chat-turn.ts";

export interface ChatHandlerOptions extends ChatTurnOptions {
  /**
   * Bounds live answers. Required, so no consumer loses the limit by accident: `null` is a
   * deliberate choice for a setup with no public traffic, such as local development.
   */
  limit: ChatLimit | null;
}

/**
 * Handles one chat turn: validates the request and then, within the daily limits, lets the model
 * look up profile records with server-side tools, and streams the reply back as an AI SDK UI message
 * stream. Tool activity stays on the server.
 *
 * Every failure before the stream starts comes back as a `Response`, so a route needs no error
 * handling of its own. Later failures arrive as an `error` chunk in the stream.
 *
 * Framework-agnostic: takes a web `Request` and returns a web `Response`.
 * Server-only: the model carries the provider credentials.
 */
export async function handleChatRequest(
  request: Request,
  options: ChatHandlerOptions,
): Promise<Response> {
  const { limit, logger = console } = options;
  const requestId = crypto.randomUUID().slice(0, 8);

  let context: ChatTurnContext;
  try {
    context = {
      requestId,
      signal: request.signal,
      limits: resolveChatLimits(options.limits),
      text: resolveChatMessages(options.visitorMessages),
    };
  } catch (error) {
    // These errors are this package's own: they name an option and hold no request data.
    logger.error(`[chat ${requestId}] invalid options`, {
      problem: error instanceof Error ? error.message : "unknown",
    });
    return textResponse(500, unavailableMessage(CHAT_MESSAGES, requestId));
  }
  const { limits, text } = context;

  try {
    const parsed = await parseChatRequest(request, limits, text);
    if (!parsed.ok) return textResponse(parsed.status, parsed.message);

    // Counted here, so invalid requests never reach the store. Every turn counts, including one that
    // fails or is stopped, because the provider may bill it.
    if (limit !== null) {
      const check = await checkChatLimit(limit, request, limits.limiterTimeoutMs);
      if (check === "unavailable") {
        logger.error(`[chat ${requestId}] limit unavailable`);
        return textResponse(503, unavailableMessage(text, requestId));
      }
      if (check !== "allowed") {
        logger.info(`[chat ${requestId}] limited`, { limit: check });
        return textResponse(429, check === "visitor-limit" ? text.visitorLimit : text.siteLimit);
      }
    }

    const { stream } = await runChatTurn(parsed.messages, options, context);
    return createUIMessageStreamResponse({ stream });
  } catch (error) {
    // Only the type: the error could repeat the visitor's conversation.
    logger.error(`[chat ${requestId}] could not start`, {
      name: error instanceof Error ? error.name : "unknown",
    });
    return textResponse(500, unavailableMessage(text, requestId));
  }
}

function textResponse(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
