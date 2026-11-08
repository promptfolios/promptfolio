import { safeValidateUIMessages, type ToolSet, type UIMessage } from "ai";
import { z } from "zod";
import { withinTimeout } from "./chat-limit.ts";
import type { ChatLogger } from "./chat-turn.ts";
import { CHAT_LIMITS } from "./limits.ts";
import { isChatId, textOf } from "./request.ts";

/**
 * Where conversations are kept between requests. The application implements it, because it needs
 * state shared between requests, so this package names no store.
 *
 * Every call takes the owner, and a conversation must be stored under the owner and the chat id
 * together, so one visitor's chat id never finds another visitor's conversation.
 */
export interface ChatStore {
  /** The stored messages, or `undefined` for a conversation this owner does not have. */
  load(owner: string, chatId: string): Promise<UIMessage[] | undefined>;
  /** Replaces the stored conversation. */
  save(owner: string, chatId: string, messages: UIMessage[]): Promise<void>;
}

/**
 * A store that keeps conversations in this process's memory, for tests and local development. Each
 * server instance has its own, and a restart loses everything, so it is not for a deployed site.
 */
export function createMemoryChatStore(): ChatStore {
  const conversations = new Map<string, UIMessage[]>();
  // Two strings joined by a character neither may contain, so no two pairs share a key.
  const key = (owner: string, chatId: string) => `${owner}\u0000${chatId}`;
  return {
    load: async (owner, chatId) => {
      const messages = conversations.get(key(owner, chatId));
      return messages === undefined ? undefined : structuredClone(messages);
    },
    save: async (owner, chatId, messages) => {
      conversations.set(key(owner, chatId), structuredClone(messages));
    },
  };
}

export interface ChatHistory {
  store: ChatStore;
  /**
   * Whose conversations a request may read and write, or `undefined` if it does not show. What
   * identifies an owner depends on the application (for example a random id in an `HttpOnly`
   * cookie). It must be hard to guess, because it is the only key to a visitor's conversations, and
   * it is never logged.
   */
  identifyOwner: (request: Request) => Promise<string | undefined>;
}

export type StoredConversation =
  | { ok: true; messages: UIMessage[] }
  | { ok: false; reason: "invalid" };

/**
 * Checks stored messages against the current tools before they reach the model. The server wrote
 * them, but they outlive the code: a renamed tool, a changed result, or a new AI SDK message format
 * would otherwise fail in the middle of a turn.
 *
 * The AI SDK keeps a finished call to a tool that no longer exists, as a dynamic tool part, so only a
 * call whose arguments or result no longer match its tool, or a message of the wrong shape, fails.
 */
export async function validateStoredConversation(
  stored: UIMessage[] | undefined,
  tools: ToolSet,
): Promise<StoredConversation> {
  if (stored === undefined || (Array.isArray(stored) && stored.length === 0)) {
    return { ok: true, messages: [] };
  }
  const result = await safeValidateUIMessages({ messages: stored, tools });
  return result.success ? { ok: true, messages: result.data } : { ok: false, reason: "invalid" };
}

/**
 * The conversation with the new message after `parentId`. Whatever came after `parentId` is
 * dropped, which is what an edited question or a regenerated answer means; a new question names the
 * last message. `undefined` if `parentId` is not in the history, or the new message's id is already
 * used before it.
 *
 * The history is a list, not a tree: after an edit, the replaced messages are gone.
 */
export function continueConversation(
  history: UIMessage[],
  parentId: string | null,
  message: UIMessage,
): UIMessage[] | undefined {
  const parentIndex =
    parentId === null ? -1 : history.findIndex((earlier) => earlier.id === parentId);
  if (parentId !== null && parentIndex === -1) return undefined;
  const kept = history.slice(0, parentIndex + 1);
  if (kept.some((earlier) => earlier.id === message.id)) return undefined;
  return [...kept, message];
}

/** The text characters of a conversation, which `maxTotalChars` bounds. */
export function conversationChars(messages: UIMessage[]): number {
  return messages.reduce((sum, message) => sum + textOf(message.parts).length, 0);
}

/** What the browser may hold of a stored message: its text. */
const visitorMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  parts: z.array(z.unknown()),
});

/**
 * Stored messages as the browser may see them: user and assistant text only, the same as the live
 * stream sends. Tool calls and results, reasoning, provider metadata, and anything else stay on the
 * server. Read by shape, so a stored entry this code does not understand is left out, not passed on.
 */
export function visitorMessages(stored: unknown): UIMessage[] {
  if (!Array.isArray(stored)) return [];
  return stored.flatMap((entry) => {
    const parsed = visitorMessageSchema.safeParse(entry);
    if (!parsed.success) return [];
    const parts = parsed.data.parts.flatMap((part) =>
      typeof part === "object" &&
      part !== null &&
      "type" in part &&
      part.type === "text" &&
      "text" in part &&
      typeof part.text === "string"
        ? [{ type: "text" as const, text: part.text }]
        : [],
    );
    return parts.length === 0 ? [] : [{ id: parsed.data.id, role: parsed.data.role, parts }];
  });
}

export interface LoadVisitorChatOptions {
  history: ChatHistory;
  /** Defaults to `CHAT_LIMITS.historyTimeoutMs`. */
  timeoutMs?: number;
  /** Defaults to `console`. */
  logger?: ChatLogger;
}

/**
 * One of the requesting visitor's conversations, as the browser may see it (see `visitorMessages`),
 * for showing a conversation again when it is opened. `undefined` when the visitor has no such
 * conversation, including when the request shows no owner or the id is not a chat id.
 *
 * @throws {Error} If the store fails or takes too long. The error names no request data.
 */
export async function loadVisitorChat(
  request: Request,
  chatId: string,
  { history, timeoutMs = CHAT_LIMITS.historyTimeoutMs, logger = console }: LoadVisitorChatOptions,
): Promise<UIMessage[] | undefined> {
  if (!isChatId(chatId)) return undefined;
  let stored: UIMessage[] | undefined;
  try {
    const owner = await withinTimeout(history.identifyOwner(request), timeoutMs);
    if (owner === undefined) return undefined;
    stored = await withinTimeout(history.store.load(owner, chatId), timeoutMs);
  } catch (error) {
    // Only the type: a store error can repeat its credentials.
    logger.error("[chat] history unavailable", {
      name: error instanceof Error ? error.name : "unknown",
    });
    throw new Error("history unavailable");
  }
  return stored === undefined ? undefined : visitorMessages(stored);
}
