import { isChatId, loadVisitorChat } from "@promptfolio/ai";
import { createAppChatHistory, readOwner } from "@/server/chat/history";
import {
  chatChangesSchema,
  emptyResponse,
  historyUnavailable,
  isCrossSite,
  json,
  readSmallJson,
} from "@/server/chat/history-routes";

interface Context {
  params: Promise<{ id: string }>;
}

/**
 * One of the visitor's conversations: its summary and its messages, as text only. A conversation
 * of another visitor, or one that does not exist, is a 404 either way.
 */
export async function GET(request: Request, { params }: Context): Promise<Response> {
  const { id } = await params;
  const owner = isChatId(id) ? readOwner(request) : undefined;
  if (owner === undefined) return emptyResponse(404);
  const { store } = createAppChatHistory();
  try {
    const [thread, messages] = await Promise.all([
      store.summary(owner, id),
      loadVisitorChat(request, id, {
        history: { store, identifyOwner: async () => owner },
      }),
    ]);
    if (thread === undefined || messages === undefined) return emptyResponse(404);
    return json({ thread, messages });
  } catch (error) {
    return historyUnavailable("load", error);
  }
}

/** Renames, archives, or restores one of the visitor's conversations. */
export async function PATCH(request: Request, { params }: Context): Promise<Response> {
  if (isCrossSite(request)) return emptyResponse(403);
  const { id } = await params;
  const owner = isChatId(id) ? readOwner(request) : undefined;
  if (owner === undefined) return emptyResponse(404);
  const changes = chatChangesSchema.safeParse(await readSmallJson(request));
  if (!changes.success) return emptyResponse(400);
  try {
    const updated = await createAppChatHistory().store.update(owner, id, changes.data);
    return emptyResponse(updated ? 204 : 404);
  } catch (error) {
    return historyUnavailable("update", error);
  }
}

/** Deletes one of the visitor's conversations, its messages included. */
export async function DELETE(request: Request, { params }: Context): Promise<Response> {
  if (isCrossSite(request)) return emptyResponse(403);
  const { id } = await params;
  const owner = isChatId(id) ? readOwner(request) : undefined;
  if (owner === undefined) return emptyResponse(204);
  try {
    await createAppChatHistory().store.delete(owner, id);
    return emptyResponse(204);
  } catch (error) {
    return historyUnavailable("delete", error);
  }
}
