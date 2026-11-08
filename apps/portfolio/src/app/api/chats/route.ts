import { createAppChatHistory, readOwner } from "@/server/chat/history";
import { historyUnavailable, json } from "@/server/chat/history-routes";

/** The visitor's conversations, newest first. A visitor without an owner cookie has none. */
export async function GET(request: Request): Promise<Response> {
  const owner = readOwner(request);
  if (owner === undefined) return json({ threads: [] });
  try {
    const threads = await createAppChatHistory().store.list(owner);
    return json({ threads });
  } catch (error) {
    return historyUnavailable("list", error);
  }
}
