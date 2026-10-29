import { handleChatRequest } from "@promptfolio/ai";
import { createChatModel } from "@/server/model";
import { loadPreparedAnswers } from "@/server/prepared-answers";
import { loadAppProfile } from "@/server/profile";

/** Upper bound, in seconds, for one streamed reply on serverless hosts. */
export const maxDuration = 30;

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
    // Starter answers prepared by `pnpm prepare-answers`; used only while still current.
    preparedAnswers: await loadPreparedAnswers(fileName),
  });
}

function unavailable(): Response {
  return new Response("The assistant is not available right now.", {
    status: 500,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
