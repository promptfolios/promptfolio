import { handleChatRequest } from "@promptfolio/ai";
import { createChatLimit } from "@/server/chat/chat-limit";
import { createAppChatHistory, newOwnerId, ownerCookie, readOwner } from "@/server/chat/history";
import { chatInstructions } from "@/server/chat/instructions";
import { createChatModel } from "@/server/chat/model";
import { CHAT_REPLY_DETAILS } from "@/server/chat/reply-details";
import { isContactEnabled } from "@/server/contact/contact";
import { loadAppProfile } from "@/server/profile/profile";

/** Upper bound, in seconds, for one streamed reply on serverless hosts. */
export const maxDuration = 60;

/**
 * Chat endpoint. Configuration problems are logged for the owner; visitors only see a
 * generic message. Validation, limits, history, and streaming happen in `@promptfolio/ai`.
 *
 * A visitor without an owner cookie gets a new one with the response, and its first question
 * starts a conversation under it.
 */
export async function POST(request: Request): Promise<Response> {
  const chatModel = createChatModel();
  if (!chatModel.ok) {
    console.error(`[chat] not configured: ${chatModel.problem}`);
    return unavailable();
  }

  const { fileName, result } = await loadAppProfile();
  if (!result.ok) {
    console.error(`[chat] profile ${fileName} could not be loaded`);
    return unavailable();
  }

  const { store, retentionSeconds, secureCookie } = createAppChatHistory();
  const existing = readOwner(request);
  const owner = existing ?? newOwnerId();

  const response = await handleChatRequest(request, {
    model: chatModel.model,
    providerOptions: chatModel.providerOptions,
    limits: chatModel.limits,
    profile: result.profile,
    additionalInstructions: chatInstructions(isContactEnabled()),
    limit: createChatLimit(),
    history: { store, identifyOwner: async () => owner },
    replyDetails: CHAT_REPLY_DETAILS,
  });
  // Sent again on every answer too, so the cookie lasts as long as the conversations it names.
  response.headers.append("set-cookie", ownerCookie(owner, retentionSeconds, secureCookie));
  return response;
}

function unavailable(): Response {
  return new Response("The assistant is not available right now.", {
    status: 500,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
