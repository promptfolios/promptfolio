import { createUIMessageStreamResponse } from "ai";
import { type ChatLimit, checkChatLimit } from "./chat-limit";
import { type ChatTurnOptions, forVisitor, genericErrorMessage, runChatTurn } from "./chat-turn";
import {
  type PreparedAnswer,
  preparedAnswerStream,
  selectPreparedAnswer,
} from "./prepared-answers";
import { parseChatRequest } from "./request";

export {
  type ChatLogger,
  type ChatProviderOptions,
  type ChatTimeouts,
  genericErrorMessage,
} from "./chat-turn";

export interface ChatHandlerOptions extends ChatTurnOptions {
  /**
   * Answers prepared for the conversation starters (see `generatePreparedAnswer`). A first
   * message that matches one is answered without a model call, but only while the answer
   * is current for this profile. Absent or empty: every request is answered live.
   */
  preparedAnswers?: readonly PreparedAnswer[];
  /**
   * Bounds live answers. Required, so no consumer loses the limit by accident: `null` is a
   * deliberate choice for a setup with no public traffic, such as local development.
   */
  limit: ChatLimit | null;
}

const LIMIT_MESSAGES = {
  "visitor-limit": "You've reached the daily limit of live answers. Please try again tomorrow.",
  "site-limit":
    "The assistant has reached its daily limit of live answers. Please try again tomorrow.",
} as const;

/**
 * Handles one chat turn: validates the request, then either serves a current prepared
 * answer or, within the daily limits, lets the model look up profile records with server-side
 * tools, and streams the reply back as an AI SDK UI message stream. Tool activity stays on the
 * server.
 *
 * Framework-agnostic: takes a web `Request` and returns a web `Response`.
 * Server-only: the model carries the provider credentials.
 */
export async function handleChatRequest(
  request: Request,
  options: ChatHandlerOptions,
): Promise<Response> {
  const { profile, preparedAnswers = [], contactFormAvailable, limit, logger = console } = options;
  const requestId = crypto.randomUUID().slice(0, 8);

  const parsed = await parseChatRequest(request);
  if (!parsed.ok) return textResponse(parsed.status, parsed.message);

  if (preparedAnswers.length > 0) {
    const selection = await selectPreparedAnswer(
      parsed.messages,
      parsed.trigger,
      preparedAnswers,
      profile,
      { contactFormAvailable },
    );
    // Follow-ups are never candidates; logging them would only add noise.
    if (selection.outcome === "hit" || selection.reason !== "not-first-turn") {
      // The outcome and reason only: never the question, which may be visitor text.
      logger.info(
        `[chat ${requestId}] prepared answer`,
        selection.outcome === "hit"
          ? { outcome: "hit" }
          : { outcome: "miss", reason: selection.reason },
      );
    }
    if (selection.outcome === "hit") {
      const stream = preparedAnswerStream(selection.answer.text).pipeThrough(
        forVisitor(request.signal, requestId),
      );
      return createUIMessageStreamResponse({ stream });
    }
  }

  // Counted here, so invalid requests and prepared answers never reach the store. Every live turn
  // counts, including one that fails or is stopped, because the provider may bill it.
  if (limit !== null) {
    const check = await checkChatLimit(limit, request);
    if (check === "unavailable") {
      logger.error(`[chat ${requestId}] limit unavailable`);
      return textResponse(503, genericErrorMessage(requestId));
    }
    if (check !== "allowed") {
      logger.info(`[chat ${requestId}] limited`, { limit: check });
      return textResponse(429, LIMIT_MESSAGES[check]);
    }
  }

  const { stream } = await runChatTurn(parsed.messages, options, {
    requestId,
    signal: request.signal,
  });
  return createUIMessageStreamResponse({ stream });
}

function textResponse(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
