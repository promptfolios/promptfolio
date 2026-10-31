import { handleChatRequest } from "@promptfolio/ai";
import { createChatLimit } from "@/server/chat/chat-limit";
import { createChatModel } from "@/server/chat/model";
import { isContactEnabled } from "@/server/contact/contact";
import { loadAppProfile } from "@/server/profile/profile";

/** Upper bound, in seconds, for one streamed reply on serverless hosts. */
export const maxDuration = 60;

/**
 * Chat endpoint. Configuration problems are logged for the owner; visitors only see a
 * generic message. Validation, limits, and streaming happen in `@promptfolio/ai`.
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

  return handleChatRequest(request, {
    model: chatModel.model,
    providerOptions: chatModel.providerOptions,
    profile: result.profile,
    // The same check that shows the Contact button, so the assistant only mentions a real one.
    contactFormAvailable: isContactEnabled(),
    limit: createChatLimit(),
  });
}

function unavailable(): Response {
  return new Response("The assistant is not available right now.", {
    status: 500,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
