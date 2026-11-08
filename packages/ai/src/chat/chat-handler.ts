import { createUIMessageStreamResponse, type UIMessage } from "ai";
import { createProfileTools } from "../grounding/profile-tools.ts";
import { type ChatLimit, checkChatLimit, withinTimeout } from "./chat-limit.ts";
import { type ChatTurnContext, type ChatTurnOptions, runChatTurn } from "./chat-turn.ts";
import {
  type ChatHistory,
  continueConversation,
  conversationChars,
  validateStoredConversation,
} from "./history.ts";
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
  /** Where conversations are kept between turns. The browser sends only the new question. */
  history: ChatHistory;
}

/**
 * Handles one chat turn: validates the request, continues the visitor's stored conversation and,
 * within the daily limits, lets the model look up profile records with server-side tools. It streams
 * the reply back as an AI SDK UI message stream and saves the whole conversation when the reply ends.
 * Tool activity stays on the server.
 *
 * The request is `{ id, message, parentId }`: the conversation, the new question, and the message
 * it follows (see `parseChatRequest`). Earlier messages come only from the store.
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
  const { limit, history, logger = console } = options;
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
    const { chatId, message, parentId } = parsed;

    // Loaded before the daily limit, so a request that cannot continue does not use an answer.
    let owner: string | undefined;
    let stored: UIMessage[] | undefined;
    try {
      owner = await withinTimeout(history.identifyOwner(request), limits.historyTimeoutMs);
      if (owner !== undefined) {
        stored = await withinTimeout(history.store.load(owner, chatId), limits.historyTimeoutMs);
      }
    } catch (error) {
      // Only the type: a store error can repeat its credentials.
      logger.error(`[chat ${requestId}] history unavailable`, {
        name: error instanceof Error ? error.name : "unknown",
      });
      return textResponse(503, unavailableMessage(text, requestId));
    }
    if (owner === undefined) {
      logger.error(`[chat ${requestId}] no history owner`);
      return textResponse(503, unavailableMessage(text, requestId));
    }

    const tools = createProfileTools(options.profile, { maxCalls: limits.maxToolCalls });
    const checked = await validateStoredConversation(stored, tools);
    let messages: UIMessage[] | undefined;
    if (checked.ok) {
      messages = continueConversation(checked.messages, parentId, message);
      if (messages === undefined) return textResponse(409, text.unknownConversation);
    } else {
      // Written by an older version of this code. The visitor's tab still shows it, but the model
      // cannot use it, so the question starts the conversation again and the save replaces it.
      logger.error(`[chat ${requestId}] stored conversation invalid, starting again`);
      messages = [message];
    }
    if (
      messages.length > limits.maxMessages ||
      conversationChars(messages) > limits.maxTotalChars
    ) {
      return textResponse(413, text.conversationTooLong);
    }

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

    const historyOwner = owner;
    const { stream } = await runChatTurn(messages, options, {
      ...context,
      // A stopped or failed reply is saved as far as it got. A failed save is only logged, because
      // the visitor already has the answer; a follow-up to it then answers 409, since the store
      // does not have the message it follows.
      onEnd: async (all) => {
        try {
          await withinTimeout(
            history.store.save(historyOwner, chatId, all),
            limits.historyTimeoutMs,
          );
        } catch (error) {
          logger.error(`[chat ${requestId}] history not saved`, {
            name: error instanceof Error ? error.name : "unknown",
          });
        }
      },
    });
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
