import { inspect } from "node:util";
import type { UIMessage } from "ai";
import { describe, expect, it, vi } from "vitest";
import {
  type ChatHistory,
  type ChatStore,
  continueConversation,
  createMemoryChatStore,
  loadVisitorChat,
  visitorMessages,
} from "./history.ts";

const ARGUMENT_MARKER = "ARGUMENT-MARKER-41";
const RESULT_MARKER = "RESULT-MARKER-83";

function text(id: string, role: "user" | "assistant", value: string): UIMessage {
  return { id, role, parts: [{ type: "text", text: value }] };
}

/** An answer as the server stores it: a lookup, its result, and the text that used it. */
const storedAnswer = {
  id: "a1",
  role: "assistant",
  parts: [
    { type: "step-start" },
    {
      type: "tool-getProfileRecord",
      toolCallId: "c1",
      state: "output-available",
      input: { id: "service-catalog", note: ARGUMENT_MARKER },
      output: { status: "found", record: { description: RESULT_MARKER } },
    },
    { type: "reasoning", text: "thinking" },
    {
      type: "text",
      text: "The Service Catalog.",
      providerMetadata: { google: { thoughtSignature: "sig" } },
    },
  ],
} as unknown as UIMessage;

describe("continueConversation", () => {
  const history = [text("u1", "user", "a"), text("a1", "assistant", "b"), text("u2", "user", "c")];

  it("adds a new question after the last message", () => {
    const next = continueConversation(history, "u2", text("u3", "user", "d"));
    expect(next?.map((message) => message.id)).toEqual(["u1", "a1", "u2", "u3"]);
  });

  it("drops what followed the parent, for an edit or a regenerated answer", () => {
    const next = continueConversation(history, "a1", text("u9", "user", "edited"));
    expect(next?.map((message) => message.id)).toEqual(["u1", "a1", "u9"]);
  });

  it("starts over for a null parent", () => {
    expect(continueConversation(history, null, text("u1", "user", "again"))).toEqual([
      text("u1", "user", "again"),
    ]);
  });

  it("refuses a parent it does not have, and an id already used before the parent", () => {
    expect(continueConversation(history, "missing", text("u3", "user", "d"))).toBeUndefined();
    expect(continueConversation(history, "u2", text("u1", "user", "d"))).toBeUndefined();
  });
});

describe("visitorMessages", () => {
  it("keeps text only: no tool input or output, reasoning, or provider metadata", () => {
    const shown = visitorMessages([text("u1", "user", "What did they build?"), storedAnswer]);

    expect(shown).toEqual([
      text("u1", "user", "What did they build?"),
      text("a1", "assistant", "The Service Catalog."),
    ]);
    const serialized = JSON.stringify(shown);
    expect(serialized).not.toContain(ARGUMENT_MARKER);
    expect(serialized).not.toContain(RESULT_MARKER);
    expect(serialized).not.toContain("thoughtSignature");
  });

  it("leaves out entries it does not understand, and system messages", () => {
    expect(
      visitorMessages([
        "not a message",
        { id: "s1", role: "system", parts: [{ type: "text", text: "rules" }] },
        { id: "a2", role: "assistant", parts: [{ type: "text", text: 42 }] },
        { id: "a3", role: "assistant", parts: [] },
      ]),
    ).toEqual([]);
    expect(visitorMessages(undefined)).toEqual([]);
  });
});

describe("createMemoryChatStore", () => {
  it("keeps each owner's conversations apart, and returns copies", async () => {
    const store = createMemoryChatStore();
    await store.save("owner-a", "chat-1", [text("u1", "user", "A")]);

    expect(await store.load("owner-b", "chat-1")).toBeUndefined();
    const loaded = await store.load("owner-a", "chat-1");
    loaded?.push(text("u2", "user", "changed"));
    expect(await store.load("owner-a", "chat-1")).toEqual([text("u1", "user", "A")]);
  });
});

describe("loadVisitorChat", () => {
  function request() {
    return new Request("http://localhost/api/chats/chat-1");
  }

  function historyWith(store: ChatStore, owner: string | undefined = "owner-a"): ChatHistory {
    return { store, identifyOwner: async () => owner };
  }

  function silentLogger() {
    return { info: vi.fn(), error: vi.fn() };
  }

  it("returns the owner's conversation as text only", async () => {
    const store = createMemoryChatStore();
    await store.save("owner-a", "chat-1", [text("u1", "user", "Q"), storedAnswer]);

    const shown = await loadVisitorChat(request(), "chat-1", { history: historyWith(store) });

    expect(shown?.map((message) => message.id)).toEqual(["u1", "a1"]);
    expect(JSON.stringify(shown)).not.toContain(RESULT_MARKER);
  });

  it("finds nothing for another owner, no owner, or an id that is not a chat id", async () => {
    const store = createMemoryChatStore();
    await store.save("owner-a", "chat-1", [text("u1", "user", "Q")]);
    const load = vi.spyOn(store, "load");

    expect(
      await loadVisitorChat(request(), "chat-1", { history: historyWith(store, "owner-b") }),
    ).toBeUndefined();
    expect(
      await loadVisitorChat(request(), "chat-1", {
        history: { store, identifyOwner: async () => undefined },
      }),
    ).toBeUndefined();
    expect(
      await loadVisitorChat(request(), "chat:1/x", { history: historyWith(store) }),
    ).toBeUndefined();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("throws when the store fails, and logs only the error's type", async () => {
    const store: ChatStore = {
      load: async () => {
        throw new Error("redis://user:SECRET-PASSWORD@host");
      },
      save: async () => {},
    };
    const logger = silentLogger();

    await expect(
      loadVisitorChat(request(), "chat-1", { history: historyWith(store), logger }),
    ).rejects.toThrow("history unavailable");
    expect(inspect(logger.error.mock.calls, { depth: null })).not.toContain("SECRET");
  });

  it("throws when the store does not answer in time", async () => {
    const store: ChatStore = { load: () => new Promise(() => {}), save: async () => {} };

    await expect(
      loadVisitorChat(request(), "chat-1", {
        history: historyWith(store),
        timeoutMs: 20,
        logger: silentLogger(),
      }),
    ).rejects.toThrow("history unavailable");
  });
});
