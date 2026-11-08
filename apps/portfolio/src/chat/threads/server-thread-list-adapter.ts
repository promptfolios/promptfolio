import {
  type AssistantClient,
  type GenericThreadHistoryAdapter,
  type MessageFormatAdapter,
  type RemoteThreadListAdapter,
  type ThreadHistoryAdapter,
  useAui,
} from "@assistant-ui/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { createAssistantStream } from "assistant-stream";
import { useEffect, useMemo, useRef } from "react";
import { z } from "zod";
import { titleFromMessages } from "./thread-title";

/** The storage format `useAISDKRuntime` asks for: AI SDK `UIMessage`s without their id. */
export const AI_SDK_FORMAT = "ai-sdk/v6";

/** What the adapters need from a thread: assistant-ui's thread list item satisfies it. */
export interface ThreadHandle {
  getState(): { remoteId: string | undefined };
  /** Creates the thread in the thread list on first use; resolves to its id. */
  initialize(): Promise<{ remoteId: string }>;
}

const summarySchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(["regular", "archived"]),
  lastMessageAt: z.number(),
});

const listSchema = z.object({ threads: z.array(summarySchema) });

const chatSchema = z.object({
  thread: summarySchema,
  messages: z.array(
    z.object({
      id: z.string(),
      role: z.enum(["user", "assistant"]),
      parts: z.array(z.object({ type: z.literal("text"), text: z.string() })),
    }),
  ),
});

async function getJson<T>(url: string, schema: z.ZodType<T>): Promise<T | undefined> {
  const response = await fetch(url, { cache: "no-store" });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`Conversations are not available right now (${response.status}).`);
  return schema.parse(await response.json());
}

async function send(url: string, method: "PATCH" | "DELETE", body?: unknown): Promise<void> {
  const response = await fetch(url, {
    method,
    ...(body !== undefined && {
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  });
  // A conversation the server no longer has (expired, or never answered) has nothing to change.
  if (!response.ok && response.status !== 404) {
    throw new Error(`The conversation could not be changed (${response.status}).`);
  }
}

const chatUrl = (id: string) => `/api/chats/${encodeURIComponent(id)}`;

/** One conversation's messages as the server shows them, each after the one before it. */
export async function loadServerMessages(remoteId: string): Promise<UIMessage[]> {
  const chat = await getJson(chatUrl(remoteId), chatSchema);
  return chat?.messages ?? [];
}

/**
 * Message history of one thread. The server saves every turn itself, so only `load` does
 * anything: it fetches the conversation when the thread is opened. Only the AI SDK format is
 * supported, which is the only one `useAISDKRuntime` uses.
 */
export function createServerThreadHistory(getThread: () => ThreadHandle): ThreadHistoryAdapter {
  const none = { load: () => Promise.resolve({ messages: [] }), append: () => Promise.resolve() };
  return {
    ...none,
    withFormat<TMessage, TStorageFormat extends Record<string, unknown>>(
      formatAdapter: MessageFormatAdapter<TMessage, TStorageFormat>,
    ): GenericThreadHistoryAdapter<TMessage> {
      if (formatAdapter.format !== AI_SDK_FORMAT) return none;
      return {
        load: async () => {
          const remoteId = getThread().getState().remoteId;
          if (remoteId === undefined) return { messages: [] };
          const messages = await loadServerMessages(remoteId);
          return {
            messages: messages.map(({ id, role, parts }, index) =>
              formatAdapter.decode({
                id,
                parent_id: index === 0 ? null : (messages[index - 1]?.id ?? null),
                format: AI_SDK_FORMAT,
                // The AI SDK format stores a `UIMessage` without its id.
                content: { role, parts } as unknown as TStorageFormat,
              }),
            ),
          };
        },
        append: () => Promise.resolve(),
        update: () => Promise.resolve(),
        delete: () => Promise.resolve(),
      };
    },
  };
}

/**
 * Posts `{ id, message, parentId }` to our server route: the thread's id, the new message, and
 * the one it follows, as `handleChatRequest` expects. The server holds the rest of the
 * conversation. Unlike assistant-ui's `AssistantChatTransport`, it sends no `system` prompt or
 * `tools`: the server owns both.
 */
export function createChatTransport(getThread: () => ThreadHandle): DefaultChatTransport<UIMessage> {
  return new DefaultChatTransport({
    api: "/api/chat",
    prepareSendMessagesRequest: async ({ messages }) => {
      const { remoteId } = await getThread().initialize();
      return {
        body: {
          id: remoteId,
          message: messages.at(-1),
          parentId: messages.at(-2)?.id ?? null,
        },
      };
    },
  });
}

/**
 * The thread list item this runtime belongs to, looked up by id so it stays the same thread
 * after a switch (`aui.threadListItem` follows the main thread).
 */
function stableThreadItem(aui: AssistantClient): ThreadHandle {
  const live = aui.threadListItem;
  const id = live.getState().id;
  const listed = aui.threads
    .getState()
    .threadItems.some((item) => item.id === id || item.remoteId === id);
  return listed ? aui.threads.item({ id }) : live;
}

/**
 * The current thread, pinned on first use, so a request or load that finishes after the
 * visitor switched threads still belongs to the thread it started in.
 */
export function useStableThread(): () => ThreadHandle {
  const aui = useAui();
  const auiRef = useRef(aui);
  useEffect(() => {
    auiRef.current = aui;
  });
  return useMemo(() => {
    let pinned: ThreadHandle | undefined;
    return () => {
      pinned ??= stableThreadItem(auiRef.current);
      return pinned;
    };
  }, []);
}

/**
 * The visitor's thread list, kept on the server through `/api/chats`. A thread gets its id here
 * and exists on the server once its first question is answered.
 */
export function createServerThreadListAdapter(): RemoteThreadListAdapter {
  return {
    // Called by the thread-list runtime once per mounted thread.
    unstable_useAdapters: function useServerThreadAdapters() {
      const getThread = useStableThread();
      return useMemo(() => ({ history: createServerThreadHistory(getThread) }), [getThread]);
    },

    list: async () => {
      const list = (await getJson("/api/chats", listSchema)) ?? { threads: [] };
      return {
        threads: list.threads.map((thread) => ({
          remoteId: thread.id,
          status: thread.status,
          title: thread.title,
          lastMessageAt: new Date(thread.lastMessageAt),
        })),
      };
    },

    initialize: () =>
      Promise.resolve({ remoteId: crypto.randomUUID(), externalId: undefined }),

    rename: (remoteId, title) => send(chatUrl(remoteId), "PATCH", { title }),
    archive: (remoteId) => send(chatUrl(remoteId), "PATCH", { status: "archived" }),
    unarchive: (remoteId) => send(chatUrl(remoteId), "PATCH", { status: "regular" }),
    delete: (remoteId) => send(chatUrl(remoteId), "DELETE"),

    // Called while the first answer streams, before the server has saved the conversation. The
    // server titles it from the same question when it saves it, so this only shows the title.
    generateTitle: async (_remoteId, messages) => {
      const title = titleFromMessages(messages);
      return createAssistantStream((controller) => {
        controller.appendText(title);
      });
    },

    fetch: async (threadId) => {
      const chat = await getJson(chatUrl(threadId), chatSchema);
      if (!chat) throw new Error("This conversation is not saved.");
      return {
        remoteId: chat.thread.id,
        status: chat.thread.status,
        title: chat.thread.title,
        lastMessageAt: new Date(chat.thread.lastMessageAt),
      };
    },
  };
}
