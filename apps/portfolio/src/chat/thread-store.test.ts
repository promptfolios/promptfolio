import { describe, expect, it } from "vitest";
import { createMemoryStorage } from "./browser-storage";
import { STORAGE_LIMITS } from "./storage-limits";
import { type MessageInput, type StorageLike, ThreadStore } from "./thread-store";

const THREADS_KEY = "promptfolio:v1:threads";
const threadKey = (id: string) => `promptfolio:v1:thread:${id}`;
const DAY_MS = 24 * 60 * 60 * 1000;

/** A store over memory storage with a clock the test can move, and collected warnings. */
function setup(storage: StorageLike = createMemoryStorage()) {
  let time = new Date("2026-10-29T12:00:00.000Z").getTime();
  const warnings: string[] = [];
  const store = new ThreadStore({
    storage,
    now: () => new Date(time),
    warn: (message) => warnings.push(message),
  });
  const advance = (ms: number) => {
    time += ms;
  };
  return { store, storage, warnings, advance };
}

function text(
  id: string,
  parentId: string | null,
  role: "user" | "assistant",
  body: string,
): MessageInput {
  return { id, parentId, role, parts: [{ type: "text", text: body }] };
}

/** Writes a thread key directly, as a hand edit or an older version would. */
function writeRawMessages(storage: StorageLike, id: string, messages: unknown[]) {
  storage.setItem(threadKey(id), JSON.stringify({ messages }));
}

describe("ThreadStore: loading and saving", () => {
  it("round-trips threads and messages in order, with titles, status, and branches", () => {
    const { store, advance } = setup();
    store.createThread("t1");
    store.updateThread("t1", { title: "What projects?" });
    expect(store.saveMessage("t1", text("u1", null, "user", "What projects?"))).toEqual({
      ok: true,
    });
    advance(1000);
    store.saveMessage("t1", {
      id: "a1",
      parentId: "u1",
      role: "assistant",
      parts: [{ type: "step-start" }, { type: "text", text: "Two projects." }],
    });
    // A regenerated answer: a second child of the same user message.
    store.saveMessage("t1", text("a2", "u1", "assistant", "Two projects, again."));

    expect(store.loadMessages("t1")).toEqual([
      { id: "u1", parentId: null, role: "user", parts: [{ type: "text", text: "What projects?" }] },
      {
        id: "a1",
        parentId: "u1",
        role: "assistant",
        parts: [{ type: "step-start" }, { type: "text", text: "Two projects." }],
      },
      {
        id: "a2",
        parentId: "u1",
        role: "assistant",
        parts: [{ type: "text", text: "Two projects, again." }],
      },
    ]);
    expect(store.listThreads()).toEqual([
      {
        id: "t1",
        title: "What projects?",
        status: "regular",
        createdAt: "2026-10-29T12:00:00.000Z",
        lastMessageAt: "2026-10-29T12:00:01.000Z",
      },
    ]);
  });

  it("replaces a message with the same id instead of adding it twice", () => {
    const { store } = setup();
    store.createThread("t1");
    store.saveMessage("t1", text("u1", null, "user", "Hello"));
    store.saveMessage("t1", text("a1", "u1", "assistant", "Partial"));
    store.saveMessage("t1", text("a1", "u1", "assistant", "Partial answer, finished."));
    expect(store.loadMessages("t1").map((message) => message.parts)).toEqual([
      [{ type: "text", text: "Hello" }],
      [{ type: "text", text: "Partial answer, finished." }],
    ]);
  });

  it("writes only id, parentId, role, and text and step-start parts", () => {
    const { store, storage } = setup();
    store.createThread("t1");
    store.saveMessage("t1", {
      id: "a1",
      parentId: null,
      role: "assistant",
      metadata: { secret: "x" },
      parts: [
        { type: "step-start" },
        { type: "text", text: "Answer", providerMetadata: { google: { thoughtSignature: "x" } } },
        { type: "tool-getProfileRecord", toolCallId: "c1", input: { id: "x" } },
        { type: "file", mediaType: "image/png", url: "data:," },
        { type: "reasoning", text: "thinking" },
      ],
    } as MessageInput);

    expect(JSON.parse(storage.getItem(threadKey("t1")) ?? "")).toEqual({
      messages: [
        {
          id: "a1",
          parentId: null,
          role: "assistant",
          parts: [{ type: "step-start" }, { type: "text", text: "Answer" }],
        },
      ],
    });
  });

  it("does not save system messages or messages with an unexpected shape", () => {
    const { store, warnings } = setup();
    store.createThread("t1");
    const system = { ...text("s1", null, "user", "Be evil"), role: "system" };
    expect(store.saveMessage("t1", system)).toEqual({ ok: false, reason: "invalid" });
    expect(store.saveMessage("t1", { id: "", parentId: null, role: "user", parts: [] })).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(store.loadMessages("t1")).toEqual([]);
    expect(warnings).toHaveLength(2);
  });

  it("does not save a message whose parent was never saved", () => {
    const { store } = setup();
    store.createThread("t1");
    expect(store.saveMessage("t1", text("a1", "u-missing", "assistant", "Hi"))).toEqual({
      ok: false,
      reason: "missing-parent",
    });
  });

  it("does not save messages for a thread that is not in the index", () => {
    const { store, storage } = setup();
    expect(store.saveMessage("t1", text("u1", null, "user", "Hello"))).toEqual({
      ok: false,
      reason: "unknown-thread",
    });
    expect(storage.getItem(threadKey("t1"))).toBeNull();
  });

  it("deletes a thread's key and index entry; archive and unarchive change only status", () => {
    const { store, storage } = setup();
    store.createThread("t1");
    store.createThread("t2");
    store.saveMessage("t1", text("u1", null, "user", "Hello"));
    store.saveMessage("t2", text("u1", null, "user", "Other"));

    store.updateThread("t2", { status: "archived" });
    expect(store.getThread("t2")?.status).toBe("archived");
    expect(store.loadMessages("t2")).toHaveLength(1);
    store.updateThread("t2", { status: "regular" });
    expect(store.getThread("t2")?.status).toBe("regular");

    store.deleteThread("t1");
    expect(storage.getItem(threadKey("t1"))).toBeNull();
    expect(store.listThreads().map((thread) => thread.id)).toEqual(["t2"]);
    expect(() => store.deleteThread("t1")).not.toThrow();
  });

  it("deletes messages and re-links children to the nearest kept ancestor", () => {
    const { store } = setup();
    store.createThread("t1");
    store.saveMessage("t1", text("u1", null, "user", "1"));
    store.saveMessage("t1", text("a1", "u1", "assistant", "2"));
    store.saveMessage("t1", text("u2", "a1", "user", "3"));
    store.saveMessage("t1", text("a2", "u2", "assistant", "4"));

    store.deleteMessages("t1", ["a1", "u2"]);
    expect(store.loadMessages("t1").map(({ id, parentId }) => ({ id, parentId }))).toEqual([
      { id: "u1", parentId: null },
      { id: "a2", parentId: "u1" },
    ]);
    expect(() => store.deleteMessages("t1", ["missing"])).not.toThrow();
  });
});

describe("ThreadStore: malformed and oversized data", () => {
  it.each([
    ["not JSON", "{not json"],
    ["an object", '{"threads":[]}'],
    ["null", "null"],
    ["an empty string", ""],
  ])("loads an index that is %s as an empty list", (_label, raw) => {
    const { store, storage } = setup();
    storage.setItem(THREADS_KEY, raw);
    expect(store.listThreads()).toEqual([]);
  });

  it("drops invalid and duplicate index entries and keeps valid ones", () => {
    const { store, storage } = setup();
    const valid = {
      id: "t1",
      status: "regular",
      createdAt: "2026-10-29T10:00:00.000Z",
      lastMessageAt: "2026-10-29T10:00:00.000Z",
    };
    storage.setItem(
      THREADS_KEY,
      JSON.stringify([
        valid,
        { ...valid },
        { ...valid, id: "../escape" },
        { ...valid, id: "t3", status: "deleted" },
        { ...valid, id: "t4", lastMessageAt: "yesterday" },
        "t5",
      ]),
    );
    expect(store.listThreads().map((thread) => thread.id)).toEqual(["t1"]);
    // The cleaned index is written back.
    expect(JSON.parse(storage.getItem(THREADS_KEY) ?? "")).toEqual([valid]);
  });

  it("drops invalid message entries and keeps their valid neighbours", () => {
    const { store, storage } = setup();
    store.createThread("t1");
    const ok = { id: "u1", parentId: null, role: "user", parts: [{ type: "text", text: "Hi" }] };
    writeRawMessages(storage, "t1", [
      ok,
      { ...ok, id: "x1", role: "system" },
      { ...ok, id: "x2", parts: [{ type: "tool-getProfileRecord", toolCallId: "c1" }] },
      { ...ok, id: "x3", parts: [{ type: "text", text: 42 }] },
      { ...ok, id: "x4", parts: [{ type: "text", text: "a".repeat(16_001) }] },
      { ...ok, id: "" },
      { ...ok, parts: [{ type: "text", text: "duplicate id" }] },
      "not a message",
      { id: "a1", parentId: "u1", role: "assistant", parts: [{ type: "text", text: "Hello" }] },
    ]);
    expect(store.loadMessages("t1").map((message) => message.id)).toEqual(["u1", "a1"]);
  });

  it("drops an entry with a missing parent together with its descendants, and cycles", () => {
    const { store, storage } = setup();
    store.createThread("t1");
    const message = (id: string, parentId: string | null) => ({
      id,
      parentId,
      role: "user",
      parts: [{ type: "text", text: id }],
    });
    writeRawMessages(storage, "t1", [
      message("u1", null),
      message("orphan", "missing"),
      message("orphan-child", "orphan"),
      message("cycle-a", "cycle-b"),
      message("cycle-b", "cycle-a"),
      message("u2", "u1"),
    ]);
    expect(store.loadMessages("t1").map((item) => item.id)).toEqual(["u1", "u2"]);
  });

  it("loads a thread key that is not JSON or has the wrong shape as empty", () => {
    const { store, storage } = setup();
    store.createThread("t1");
    store.createThread("t2");
    storage.setItem(threadKey("t1"), "{oops");
    storage.setItem(threadKey("t2"), JSON.stringify([{ id: "u1" }]));
    expect(store.loadMessages("t1")).toEqual([]);
    expect(store.loadMessages("t2")).toEqual([]);
  });

  it("ignores a thread key larger than maxThreadChars", () => {
    const { store, storage, warnings } = setup();
    store.createThread("t1");
    storage.setItem(threadKey("t1"), " ".repeat(STORAGE_LIMITS.maxThreadChars + 1));
    expect(store.loadMessages("t1")).toEqual([]);
    expect(warnings).toEqual(["Promptfolio: ignoring a saved thread that exceeds maxThreadChars."]);
  });

  it("skips a message over maxMessageChars and leaves the saved thread unchanged", () => {
    const { store, storage, warnings } = setup();
    store.createThread("t1");
    store.saveMessage("t1", text("u1", null, "user", "Hello"));
    const before = storage.getItem(threadKey("t1"));
    const long = "a".repeat(STORAGE_LIMITS.maxMessageChars + 1);
    expect(store.saveMessage("t1", text("a1", "u1", "assistant", long))).toEqual({
      ok: false,
      reason: "limit",
    });
    expect(storage.getItem(threadKey("t1"))).toBe(before);
    expect(warnings).toEqual(["Promptfolio: not saving a message that exceeds maxMessageChars."]);
    expect(warnings.join()).not.toContain(long.slice(0, 20));
  });

  it("skips a message beyond maxMessagesPerThread", () => {
    const { store } = setup();
    store.createThread("t1");
    let parentId: string | null = null;
    for (let index = 0; index < STORAGE_LIMITS.maxMessagesPerThread; index++) {
      expect(store.saveMessage("t1", text(`m${index}`, parentId, "user", "x")).ok).toBe(true);
      parentId = `m${index}`;
    }
    expect(store.saveMessage("t1", text("one-more", parentId, "user", "x"))).toEqual({
      ok: false,
      reason: "limit",
    });
    expect(store.loadMessages("t1")).toHaveLength(STORAGE_LIMITS.maxMessagesPerThread);
  });

  it("skips a message that would make the thread exceed maxThreadChars", () => {
    const { store } = setup();
    store.createThread("t1");
    const chunk = "a".repeat(STORAGE_LIMITS.maxMessageChars);
    let parentId: string | null = null;
    let saved = 0;
    for (let index = 0; index < 20; index++) {
      const result = store.saveMessage("t1", text(`m${index}`, parentId, "user", chunk));
      if (!result.ok) {
        expect(result.reason).toBe("limit");
        break;
      }
      saved++;
      parentId = `m${index}`;
    }
    expect(saved).toBe(Math.floor(STORAGE_LIMITS.maxThreadChars / STORAGE_LIMITS.maxMessageChars));
    expect(store.loadMessages("t1")).toHaveLength(saved);
  });

  it("never uses an unexpected thread id in a storage key", () => {
    const { store, storage } = setup();
    for (const id of ["../threads", "a:b", "", "x".repeat(65), "promptfolio:v1:threads"]) {
      expect(store.createThread(id)).toBeUndefined();
      expect(store.loadMessages(id)).toEqual([]);
      store.deleteThread(id);
    }
    expect(storage.length).toBe(0);
  });

  it("never reads or removes other versions' or other apps' keys, and removes orphans", () => {
    const { store, storage } = setup();
    storage.setItem("promptfolio:v0:threads", "old");
    storage.setItem("promptfolio:v0:thread:t1", "old");
    storage.setItem("other-app:state", "keep");
    storage.setItem(threadKey("orphan"), JSON.stringify({ messages: [] }));
    store.createThread("t1");
    store.saveMessage("t1", text("u1", null, "user", "Hello"));

    expect(store.listThreads().map((thread) => thread.id)).toEqual(["t1"]);
    expect(storage.getItem("promptfolio:v0:threads")).toBe("old");
    expect(storage.getItem("promptfolio:v0:thread:t1")).toBe("old");
    expect(storage.getItem("other-app:state")).toBe("keep");
    expect(storage.getItem(threadKey("orphan"))).toBeNull();
    expect(storage.getItem(threadKey("t1"))).not.toBeNull();
  });
});

describe("ThreadStore: limits and retention", () => {
  it("removes threads untouched for more than retentionDays, with their keys", () => {
    const { store, storage, advance } = setup();
    store.createThread("old");
    store.saveMessage("old", text("u1", null, "user", "Hello"));
    advance(2 * DAY_MS);
    store.createThread("recent");

    // "old" is now retentionDays - 1 days old.
    advance((STORAGE_LIMITS.retentionDays - 3) * DAY_MS);
    expect(store.listThreads().map((thread) => thread.id)).toEqual(["recent", "old"]);

    advance(1 * DAY_MS + 1);
    expect(store.listThreads().map((thread) => thread.id)).toEqual(["recent"]);
    expect(storage.getItem(threadKey("old"))).toBeNull();
  });

  it("lists the most recently used thread first", () => {
    const { store, advance } = setup();
    store.createThread("t1");
    advance(1000);
    store.createThread("t2");
    advance(1000);
    store.saveMessage("t1", text("u1", null, "user", "Back to the first"));
    expect(store.listThreads().map((thread) => thread.id)).toEqual(["t1", "t2"]);
  });

  it("removes the least recently used thread when one more than maxThreads is created", () => {
    const { store, storage, advance } = setup();
    for (let index = 0; index < STORAGE_LIMITS.maxThreads; index++) {
      store.createThread(`t${index}`);
      store.saveMessage(`t${index}`, text("u1", null, "user", "x"));
      advance(1000);
    }
    // Using t0 again makes t1 the least recently used.
    store.saveMessage("t0", text("a1", "u1", "assistant", "y"));
    advance(1000);

    store.createThread("new");
    const ids = store.listThreads().map((thread) => thread.id);
    expect(ids).toHaveLength(STORAGE_LIMITS.maxThreads);
    expect(ids).toContain("new");
    expect(ids).toContain("t0");
    expect(ids).not.toContain("t1");
    expect(storage.getItem(threadKey("t1"))).toBeNull();
  });
});

describe("ThreadStore: storage failures", () => {
  /** Memory storage whose writes, or reads too, throw like a full or blocked localStorage. */
  function failingStorage(mode: "quota" | "blocked"): StorageLike {
    const inner = createMemoryStorage();
    const fail = () => {
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    };
    return {
      get length() {
        if (mode === "blocked") throw new DOMException("Blocked", "SecurityError");
        return inner.length;
      },
      key: (index) => inner.key(index),
      getItem: (key) => {
        if (mode === "blocked") throw new DOMException("Blocked", "SecurityError");
        return inner.getItem(key);
      },
      setItem: fail,
      removeItem: (key) => inner.removeItem(key),
    };
  }

  it.each(["quota", "blocked"] as const)("never throws when storage is %s", (mode) => {
    const { store, warnings } = setup(failingStorage(mode));
    expect(store.createThread("t1")).toBeUndefined();
    expect(store.saveMessage("t1", text("u1", null, "user", "Hello")).ok).toBe(false);
    expect(store.listThreads()).toEqual([]);
    expect(store.loadMessages("t1")).toEqual([]);
    expect(store.updateThread("t1", { title: "x" })).toBe(false);
    expect(() => store.deleteThread("t1")).not.toThrow();
    expect(() => store.deleteMessages("t1", ["u1"])).not.toThrow();
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("reports a failed message write and keeps the earlier saved state", () => {
    const inner = createMemoryStorage();
    let full = false;
    const storage: StorageLike = {
      get length() {
        return inner.length;
      },
      key: (index) => inner.key(index),
      getItem: (key) => inner.getItem(key),
      setItem: (key, value) => {
        if (full) throw new DOMException("Full", "QuotaExceededError");
        inner.setItem(key, value);
      },
      removeItem: (key) => inner.removeItem(key),
    };
    const { store } = setup(storage);
    store.createThread("t1");
    store.saveMessage("t1", text("u1", null, "user", "Hello"));
    full = true;
    expect(store.saveMessage("t1", text("a1", "u1", "assistant", "Hi"))).toEqual({
      ok: false,
      reason: "storage",
    });
    expect(store.loadMessages("t1").map((message) => message.id)).toEqual(["u1"]);
  });
});

describe("ThreadStore: separation between threads and visitors", () => {
  it("keeps the messages of two threads in one storage apart", () => {
    const { store } = setup();
    store.createThread("t1");
    store.createThread("t2");
    store.saveMessage("t1", text("u1", null, "user", "First thread"));
    store.saveMessage("t2", text("u1", null, "user", "Second thread"));
    store.saveMessage("t1", text("a1", "u1", "assistant", "Answer one"));

    expect(store.loadMessages("t1").map((message) => message.parts[0])).toEqual([
      { type: "text", text: "First thread" },
      { type: "text", text: "Answer one" },
    ]);
    expect(store.loadMessages("t2").map((message) => message.parts[0])).toEqual([
      { type: "text", text: "Second thread" },
    ]);
  });

  it("shares nothing between two stores on separate storages (two browsers)", () => {
    const visitorA = setup();
    const visitorB = setup();
    visitorA.store.createThread("t1");
    visitorA.store.saveMessage("t1", text("u1", null, "user", "Private question"));

    expect(visitorB.store.listThreads()).toEqual([]);
    expect(visitorB.store.loadMessages("t1")).toEqual([]);
    expect(visitorB.storage.length).toBe(0);
  });

  it("reads through to storage on every call, so two stores on one storage agree", () => {
    const storage = createMemoryStorage();
    const first = setup(storage);
    const second = setup(storage);
    first.store.createThread("t1");
    first.store.saveMessage("t1", text("u1", null, "user", "Hello"));
    expect(second.store.loadMessages("t1")).toHaveLength(1);
  });
});
