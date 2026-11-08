import type { MessageFormatAdapter } from "@assistant-ui/react";
import type { UIMessage } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AI_SDK_FORMAT,
  createChatTransport,
  createServerThreadHistory,
  createServerThreadListAdapter,
  type ThreadHandle,
} from "./server-thread-list-adapter";

type Stored = Omit<UIMessage, "id">;

/** Same behaviour as assistant-ui's `aiSDKV6FormatAdapter`: a `UIMessage` without its id. */
const aiSdkFormat: MessageFormatAdapter<UIMessage, Stored> = {
  format: AI_SDK_FORMAT,
  encode: ({ message: { id: _id, ...message } }) => message,
  decode: (stored) => ({ parentId: stored.parent_id, message: { id: stored.id, ...stored.content } }),
  getId: (message) => message.id,
};

function thread(remoteId: string | undefined): ThreadHandle {
  return {
    getState: () => ({ remoteId }),
    initialize: async () => ({ remoteId: remoteId ?? "new-id" }),
  };
}

function text(id: string, role: "user" | "assistant", value: string): UIMessage {
  return { id, role, parts: [{ type: "text", text: value }] };
}

function respond(status: number, body?: unknown) {
  return new Response(body === undefined ? null : JSON.stringify(body), { status });
}

afterEach(() => vi.unstubAllGlobals());

describe("createChatTransport", () => {
  it("sends the thread's id, the new message, and the one it follows", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => respond(500));
    vi.stubGlobal("fetch", fetchMock);
    const transport = createChatTransport(() => thread("thread-1"));

    await transport
      .sendMessages({
        chatId: "ignored",
        trigger: "submit-message",
        messageId: undefined,
        abortSignal: undefined,
        messages: [text("u1", "user", "Hi"), text("a1", "assistant", "Hello"), text("u2", "user", "More?")],
      })
      .catch(() => {});

    const init = fetchMock.mock.calls[0]?.[1];
    expect(JSON.parse(String(init?.body))).toEqual({
      id: "thread-1",
      message: text("u2", "user", "More?"),
      parentId: "a1",
    });
  });
});

describe("createServerThreadHistory", () => {
  it("loads the server's messages, each after the one before it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        respond(200, {
          thread: { id: "t1", title: "Hi", status: "regular", lastMessageAt: 1 },
          messages: [text("u1", "user", "Hi"), text("a1", "assistant", "Hello")],
        }),
      ),
    );
    const history = createServerThreadHistory(() => thread("t1")).withFormat?.(aiSdkFormat);

    expect(await history?.load()).toEqual({
      messages: [
        { parentId: null, message: text("u1", "user", "Hi") },
        { parentId: "u1", message: text("a1", "assistant", "Hello") },
      ],
    });
  });

  it("loads nothing for a thread the server does not have yet", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const history = createServerThreadHistory(() => thread(undefined)).withFormat?.(aiSdkFormat);

    expect(await history?.load()).toEqual({ messages: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a load whose messages are not text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        respond(200, {
          thread: { id: "t1", title: "Hi", status: "regular", lastMessageAt: 1 },
          messages: [{ id: "a1", role: "assistant", parts: [{ type: "tool-x", input: {} }] }],
        }),
      ),
    );
    const history = createServerThreadHistory(() => thread("t1")).withFormat?.(aiSdkFormat);

    await expect(history?.load()).rejects.toThrow();
  });
});

describe("createServerThreadListAdapter", () => {
  it("lists the server's threads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        respond(200, { threads: [{ id: "t1", title: "Hi", status: "archived", lastMessageAt: 5 }] }),
      ),
    );

    expect(await createServerThreadListAdapter().list()).toEqual({
      threads: [{ remoteId: "t1", title: "Hi", status: "archived", lastMessageAt: new Date(5) }],
    });
  });

  it("renames, archives, and deletes through the chat's URL", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => respond(204));
    vi.stubGlobal("fetch", fetchMock);
    const adapter = createServerThreadListAdapter();

    await adapter.rename("t1", "New name");
    await adapter.archive("t1");
    await adapter.delete("t1");

    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      ["/api/chats/t1", "PATCH"],
      ["/api/chats/t1", "PATCH"],
      ["/api/chats/t1", "DELETE"],
    ]);
  });

  it("makes a new thread id that the server accepts as a chat id", async () => {
    const { remoteId } = await createServerThreadListAdapter().initialize("__LOCALID_abc");
    expect(remoteId).toMatch(/^[A-Za-z0-9_-]{1,100}$/);
  });
});
