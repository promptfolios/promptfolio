import type { MessageFormatAdapter, ThreadMessage } from "@assistant-ui/react";
import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import { createMemoryStorage } from "./browser-storage";
import {
  AI_SDK_FORMAT,
  createBrowserThreadListAdapter,
  createThreadHistory,
  type ThreadHandle,
} from "./browser-thread-list-adapter";
import { ThreadStore } from "./thread-store";

type Stored = Omit<UIMessage, "id">;

/**
 * Same behaviour as `aiSDKV6FormatAdapter` from assistant-ui (assistant-cloud/ai-sdk), which
 * `useAISDKRuntime` passes to `withFormat`: it stores a `UIMessage` without its id.
 */
const aiSdkFormat: MessageFormatAdapter<UIMessage, Stored> = {
  format: AI_SDK_FORMAT,
  encode: ({ message: { id: _id, ...message } }) => message,
  decode: (stored) => ({
    parentId: stored.parent_id,
    message: { id: stored.id, ...stored.content },
  }),
  getId: (message) => message.id,
};

/** A thread list item stand-in: no id until the first write initializes it. */
function fakeThread(id: string): ThreadHandle & { initialized: boolean } {
  const handle = {
    initialized: false,
    getState: () => ({ remoteId: handle.initialized ? id : undefined }),
    initialize: async () => {
      handle.initialized = true;
      return { remoteId: id };
    },
  };
  return handle;
}

function message(id: string, role: "user" | "assistant", text: string): UIMessage {
  return { id, role, parts: [{ type: "text", text }] };
}

function setup() {
  const store = new ThreadStore({ storage: createMemoryStorage(), warn: () => {} });
  const adapter = createBrowserThreadListAdapter(store);
  return { store, adapter };
}

describe("thread history (withFormat)", () => {
  it("saves appended messages and loads them back as UI messages", async () => {
    const { store, adapter } = setup();
    await adapter.initialize("t1");
    const thread = fakeThread("t1");
    const history = createThreadHistory(store, () => thread).withFormat?.(aiSdkFormat);
    if (!history) throw new Error("withFormat is required by useAISDKRuntime");

    await history.append({ parentId: null, message: message("u1", "user", "What projects?") });
    await history.append({
      parentId: "u1",
      message: {
        id: "a1",
        role: "assistant",
        metadata: { usage: 1 },
        parts: [{ type: "step-start" }, { type: "text", text: "Partial" }],
      },
    });
    await history.update?.(
      { parentId: "u1", message: message("a1", "assistant", "Two projects.") },
      "a1",
    );

    expect(await history.load()).toEqual({
      messages: [
        { parentId: null, message: message("u1", "user", "What projects?") },
        { parentId: "u1", message: message("a1", "assistant", "Two projects.") },
      ],
    });
  });

  it("initializes the thread on the first write, and loads nothing before that", async () => {
    const { store, adapter } = setup();
    const thread = fakeThread("t1");
    const history = createThreadHistory(store, () => thread).withFormat?.(aiSdkFormat);
    expect(await history?.load()).toEqual({ messages: [] });

    await adapter.initialize("t1");
    await history?.append({ parentId: null, message: message("u1", "user", "Hello") });
    expect(thread.initialized).toBe(true);
    expect(store.loadMessages("t1")).toHaveLength(1);
  });

  it("deletes messages and re-links their children", async () => {
    const { store, adapter } = setup();
    await adapter.initialize("t1");
    const history = createThreadHistory(store, () => fakeThread("t1")).withFormat?.(aiSdkFormat);
    await history?.append({ parentId: null, message: message("u1", "user", "1") });
    await history?.append({ parentId: "u1", message: message("a1", "assistant", "2") });
    await history?.append({ parentId: "a1", message: message("u2", "user", "3") });

    await history?.delete?.([{ parentId: "u1", message: message("a1", "assistant", "2") }]);
    const loaded = await history?.load();
    expect(loaded?.messages.map((item) => [item.parentId, item.message.id])).toEqual([
      [null, "u1"],
      ["u1", "u2"],
    ]);
  });

  it("keeps writing to the pinned thread after the visitor switches threads", async () => {
    const { store, adapter } = setup();
    await adapter.initialize("t1");
    await adapter.initialize("t2");
    let current: ThreadHandle = fakeThread("t1");
    const history = createThreadHistory(store, () => current).withFormat?.(aiSdkFormat);
    history?.pin?.();

    current = fakeThread("t2");
    await history?.append({ parentId: null, message: message("u1", "user", "For t1") });
    expect(store.loadMessages("t1")).toHaveLength(1);
    expect(store.loadMessages("t2")).toHaveLength(0);
  });

  it("keeps two threads' histories apart", async () => {
    const { store, adapter } = setup();
    await adapter.initialize("t1");
    await adapter.initialize("t2");
    const first = createThreadHistory(store, () => fakeThread("t1")).withFormat?.(aiSdkFormat);
    const second = createThreadHistory(store, () => fakeThread("t2")).withFormat?.(aiSdkFormat);
    await first?.append({ parentId: null, message: message("u1", "user", "First") });
    await second?.append({ parentId: null, message: message("u1", "user", "Second") });

    // Switching back and forth: each load returns only its own thread's messages.
    for (let round = 0; round < 2; round++) {
      expect((await first?.load())?.messages.map((item) => item.message.parts)).toEqual([
        [{ type: "text", text: "First" }],
      ]);
      expect((await second?.load())?.messages.map((item) => item.message.parts)).toEqual([
        [{ type: "text", text: "Second" }],
      ]);
    }
  });

  it("does not throw when a write is refused, and saves nothing", async () => {
    const { store } = setup();
    // Never initialized in the store: the thread list could not save it.
    const history = createThreadHistory(store, () => fakeThread("t1")).withFormat?.(aiSdkFormat);
    await expect(
      history?.append({ parentId: null, message: message("u1", "user", "Hello") }),
    ).resolves.toBeUndefined();
    expect(store.loadMessages("t1")).toEqual([]);
  });

  it("saves and loads nothing for an unsupported format", async () => {
    const { store, adapter } = setup();
    await adapter.initialize("t1");
    const other = { ...aiSdkFormat, format: "other/v1" };
    const history = createThreadHistory(store, () => fakeThread("t1")).withFormat?.(other);
    await history?.append({ parentId: null, message: message("u1", "user", "Hello") });
    expect(store.loadMessages("t1")).toEqual([]);
    expect(await history?.load()).toEqual({ messages: [] });
  });
});

describe("browser thread list adapter", () => {
  it("lists, renames, archives, unarchives, and deletes saved threads", async () => {
    const { adapter } = setup();
    await adapter.initialize("t1");
    await adapter.rename("t1", "Projects");
    expect((await adapter.list()).threads).toEqual([
      expect.objectContaining({ remoteId: "t1", title: "Projects", status: "regular" }),
    ]);

    await adapter.archive("t1");
    expect((await adapter.fetch("t1")).status).toBe("archived");
    await adapter.unarchive?.("t1");
    expect((await adapter.fetch("t1")).status).toBe("regular");

    await adapter.delete("t1");
    expect((await adapter.list()).threads).toEqual([]);
    await expect(adapter.fetch("t1")).rejects.toThrow();
  });

  it("titles a thread from its first user message and saves the title", async () => {
    const { store, adapter } = setup();
    await adapter.initialize("t1");
    const messages = [
      { role: "user", content: [{ type: "text", text: "What   projects have they built?" }] },
    ] as unknown as ThreadMessage[];
    await adapter.generateTitle("t1", messages);
    expect(store.getThread("t1")?.title).toBe("What projects have they built?");
  });

  it("still initializes a thread it cannot save", async () => {
    const { adapter } = setup();
    await expect(adapter.initialize("not a valid id")).resolves.toEqual({
      remoteId: "not a valid id",
      externalId: undefined,
    });
    expect((await adapter.list()).threads).toEqual([]);
  });

  it("provides a history adapter per thread through unstable_useAdapters", () => {
    const { adapter } = setup();
    expect(typeof adapter.unstable_useAdapters).toBe("function");
  });
});
