import {
  type AssistantClient,
  type GenericThreadHistoryAdapter,
  type MessageFormatAdapter,
  type MessageFormatItem,
  type RemoteThreadListAdapter,
  type ThreadHistoryAdapter,
  useAui,
} from "@assistant-ui/react";
import { createAssistantStream } from "assistant-stream";
import { useEffect, useMemo, useRef } from "react";
import type { ThreadStore } from "./thread-store";
import { titleFromMessages } from "./thread-title";

/** The storage format `useAISDKRuntime` asks for: AI SDK `UIMessage`s without their id. */
export const AI_SDK_FORMAT = "ai-sdk/v6";

/** What a history needs from its thread: assistant-ui's thread list item satisfies it. */
export interface ThreadHandle {
  getState(): { remoteId: string | undefined };
  /** Creates the thread in the thread list on first use; resolves to its id. */
  initialize(): Promise<{ remoteId: string }>;
}

/**
 * Message history of one thread, backed by the store. Only the AI SDK format is supported,
 * which is the only one `useAISDKRuntime` uses; `withFormat` is required by that runtime.
 *
 * `getThread` is called lazily, because the thread may not exist yet when the history is
 * created. The thread is then pinned, so writes that finish after the visitor switched
 * threads still go to the thread they belong to.
 */
export function createThreadHistory(
  store: ThreadStore,
  getThread: () => ThreadHandle,
): ThreadHistoryAdapter {
  return {
    // The format-less path is used by assistant-ui's local runtime, not by `useAISDKRuntime`.
    load: () => Promise.resolve({ messages: [] }),
    append: () => Promise.resolve(),
    withFormat<TMessage, TStorageFormat extends Record<string, unknown>>(
      formatAdapter: MessageFormatAdapter<TMessage, TStorageFormat>,
    ): GenericThreadHistoryAdapter<TMessage> {
      if (formatAdapter.format !== AI_SDK_FORMAT) {
        console.warn(
          `Promptfolio: not saving messages in the unsupported format "${formatAdapter.format}".`,
        );
        return { load: () => Promise.resolve({ messages: [] }), append: () => Promise.resolve() };
      }
      let pinned: ThreadHandle | undefined;
      const thread = () => {
        pinned ??= getThread();
        return pinned;
      };

      const save = async (item: MessageFormatItem<TMessage>) => {
        const { remoteId } = await thread().initialize();
        const content = formatAdapter.encode(item);
        // Failures are reported by the store and not thrown: the runtime would only log them
        // and retry on every update, while the conversation continues in memory either way.
        store.saveMessage(remoteId, {
          id: formatAdapter.getId(item.message),
          parentId: item.parentId,
          role: content.role,
          parts: content.parts,
        });
      };

      return {
        pin() {
          pinned = getThread();
        },
        load: async () => {
          const remoteId = thread().getState().remoteId;
          if (remoteId === undefined) return { messages: [] };
          const messages = store.loadMessages(remoteId).map(({ id, parentId, role, parts }) =>
            formatAdapter.decode({
              id,
              parent_id: parentId,
              format: AI_SDK_FORMAT,
              // The AI SDK format stores a `UIMessage` without its id; the store has checked
              // that these are exactly the fields the format expects.
              content: { role, parts } as unknown as TStorageFormat,
            }),
          );
          return { messages };
        },
        append: save,
        update: save,
        delete: async (items) => {
          const remoteId = thread().getState().remoteId;
          if (remoteId === undefined) return;
          store.deleteMessages(
            remoteId,
            items.map((item) => formatAdapter.getId(item.message)),
          );
        },
      };
    },
  };
}

/**
 * The thread list item this history belongs to, looked up by id so it stays the same thread
 * after a switch (`aui.threadListItem` follows the main thread). Mirrors what assistant-ui's
 * own local-storage adapter does.
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
 * Thread list saved in the browser through `store`, with per-thread message history.
 * Replaces the in-memory adapter used before M6; titles still come from the first message.
 */
export function createBrowserThreadListAdapter(store: ThreadStore): RemoteThreadListAdapter {
  return {
    // Called by the thread-list runtime once per mounted thread.
    unstable_useAdapters: function useBrowserThreadAdapters() {
      const aui = useAui();
      const auiRef = useRef(aui);
      useEffect(() => {
        auiRef.current = aui;
      });
      return useMemo(
        () => ({ history: createThreadHistory(store, () => stableThreadItem(auiRef.current)) }),
        [],
      );
    },

    list: () =>
      Promise.resolve({
        threads: store.listThreads().map((thread) => ({
          remoteId: thread.id,
          status: thread.status,
          title: thread.title,
          lastMessageAt: new Date(thread.lastMessageAt),
        })),
      }),

    initialize: (threadId) => {
      // If the thread cannot be saved (unexpected id, storage full or blocked), it still
      // works for this visit; its messages are then not saved either.
      store.createThread(threadId);
      return Promise.resolve({ remoteId: threadId, externalId: undefined });
    },

    rename: (remoteId, newTitle) => {
      store.updateThread(remoteId, { title: newTitle });
      return Promise.resolve();
    },
    archive: (remoteId) => {
      store.updateThread(remoteId, { status: "archived" });
      return Promise.resolve();
    },
    unarchive: (remoteId) => {
      store.updateThread(remoteId, { status: "regular" });
      return Promise.resolve();
    },
    delete: (remoteId) => {
      store.deleteThread(remoteId);
      return Promise.resolve();
    },

    generateTitle: (remoteId, messages) => {
      const title = titleFromMessages(messages);
      // Written before the stream is returned, as the adapter contract requires.
      store.updateThread(remoteId, { title });
      return Promise.resolve(
        createAssistantStream((controller) => {
          controller.appendText(title);
        }),
      );
    },

    fetch: (threadId) => {
      const thread = store.getThread(threadId);
      if (!thread) return Promise.reject(new Error("This conversation is not saved here."));
      return Promise.resolve({
        remoteId: thread.id,
        status: thread.status,
        title: thread.title,
        lastMessageAt: new Date(thread.lastMessageAt),
      });
    },
  };
}
