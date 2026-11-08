import type { UIMessage } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeRedis, fakeRedis } from "@/test/fake-redis";

vi.mock("server-only", () => ({}));

const {
  createRedisChatStore,
  loadChatHistoryConfig,
  MAX_CHATS,
  newOwnerId,
  ownerCookie,
  readOwner,
} = await import("./history");

const DAY = 24 * 60 * 60;

function question(id: string, text: string): UIMessage {
  return { id, role: "user", parts: [{ type: "text", text }] };
}

function storeAt(clock: { now: number }) {
  return createRedisChatStore(new FakeRedis() as never, 30 * DAY, () => clock.now);
}

beforeEach(() => fakeRedis.reset());

describe("the owner cookie", () => {
  it("reads only an id in the format it makes", () => {
    const owner = newOwnerId();
    const request = (cookie: string) => new Request("http://localhost", { headers: { cookie } });

    expect(readOwner(request(`theme=dark; promptfolio-owner=${owner}`))).toBe(owner);
    expect(readOwner(request("promptfolio-owner=short"))).toBeUndefined();
    expect(readOwner(request("promptfolio-owner=a:b/../c-AAAAAAAAAAAAAA"))).toBeUndefined();
    expect(readOwner(new Request("http://localhost"))).toBeUndefined();
  });

  it("is HttpOnly and SameSite=Lax, and Secure when asked", () => {
    expect(ownerCookie("id", 60, true)).toBe(
      "promptfolio-owner=id; Path=/; Max-Age=60; HttpOnly; SameSite=Lax; Secure",
    );
    expect(ownerCookie("id", 60, false)).not.toContain("Secure");
  });
});

describe("createRedisChatStore", () => {
  it("saves and loads a conversation, and lists it titled by its first question", async () => {
    const clock = { now: 1_000_000 };
    const store = storeAt(clock);
    await store.save("o1", "c1", [question("u1", "Hi")]);

    expect(await store.load("o1", "c1")).toEqual([question("u1", "Hi")]);
    expect(await store.list("o1")).toEqual([
      { id: "c1", title: "Hi", status: "regular", lastMessageAt: 1_000_000 },
    ]);
    expect(fakeRedis.expiries.get("chat:history:o1:c1")).toBe(30 * DAY);
    expect(fakeRedis.expiries.get("chat:list:o1")).toBe(30 * DAY);
  });

  it("keeps a renamed title and an archived status when the conversation is saved again", async () => {
    const clock = { now: 1_000_000 };
    const store = storeAt(clock);
    await store.save("o1", "c1", [question("u1", "Hi")]);
    await store.update("o1", "c1", { title: "Mine", status: "archived" });
    clock.now += 1_000;
    await store.save("o1", "c1", [question("u1", "Hi"), question("u2", "Again")]);

    expect(await store.summary("o1", "c1")).toEqual({
      id: "c1",
      title: "Mine",
      status: "archived",
      lastMessageAt: 1_001_000,
    });
  });

  it("keeps owners apart", async () => {
    const store = storeAt({ now: 1 });
    await store.save("o1", "c1", [question("u1", "Mine")]);

    expect(await store.load("o2", "c1")).toBeUndefined();
    expect(await store.list("o2")).toEqual([]);
    expect(await store.update("o2", "c1", { title: "Taken" })).toBe(false);
    await store.delete("o2", "c1");
    expect(await store.load("o1", "c1")).toEqual([question("u1", "Mine")]);
  });

  it("drops conversations past retention from the list, with their messages", async () => {
    const clock = { now: 0 };
    const store = storeAt(clock);
    await store.save("o1", "old", [question("u1", "Old")]);
    clock.now = 20 * DAY * 1000;
    await store.save("o1", "new", [question("u2", "New")]);
    clock.now = 31 * DAY * 1000;

    expect((await store.list("o1")).map((chat) => chat.id)).toEqual(["new"]);
    expect(fakeRedis.hashes.get("chat:list:o1")?.has("old")).toBe(false);
    expect(fakeRedis.strings.has("chat:history:o1:old")).toBe(false);
    expect(await store.summary("o1", "old")).toBeUndefined();
  });

  it(`keeps at most ${MAX_CHATS} conversations, removing the oldest`, async () => {
    const clock = { now: 1 };
    const store = storeAt(clock);
    for (let index = 0; index <= MAX_CHATS; index += 1) {
      clock.now += 1;
      await store.save("o1", `c${index}`, [question("u", "Hi")]);
    }

    const listed = await store.list("o1");
    expect(listed).toHaveLength(MAX_CHATS);
    expect(listed.some((chat) => chat.id === "c0")).toBe(false);
    expect(await store.load("o1", "c0")).toBeUndefined();
  });

  it("ignores a list entry or a conversation it cannot parse", async () => {
    const store = storeAt({ now: 1 });
    fakeRedis.hashes.set("chat:list:o1", new Map([["c1", "{not json"]]));
    fakeRedis.strings.set("chat:history:o1:c1", "{not json");

    expect(await store.list("o1")).toEqual([]);
    expect(await store.load("o1", "c1")).toBeUndefined();
  });
});

describe("loadChatHistoryConfig", () => {
  it("defaults to 30 days and accepts 1 to 365", () => {
    expect(loadChatHistoryConfig({})).toEqual({ status: "ok", retentionDays: 30 });
    expect(loadChatHistoryConfig({ CHAT_HISTORY_DAYS: "7" })).toEqual({
      status: "ok",
      retentionDays: 7,
    });
    for (const value of ["0", "366", "1.5", "a week"]) {
      expect(loadChatHistoryConfig({ CHAT_HISTORY_DAYS: value }).status).toBe("invalid");
    }
  });
});
