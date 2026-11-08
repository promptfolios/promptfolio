import "server-only";
import { randomBytes } from "node:crypto";
import type { ChatStore } from "@promptfolio/ai";
import type { Redis } from "@upstash/redis";
import type { UIMessage } from "ai";
import { z } from "zod";
import { titleFromText } from "@/chat/threads/thread-title";
import type { AppEnv } from "../shared/env";
import { createRedisClient, loadRedisConfig } from "../shared/redis";

/** The cookie that names a visitor's conversations. */
export const OWNER_COOKIE = "promptfolio-owner";

/** What `newOwnerId` makes: 16 random bytes, base64url. Anything else in the cookie is ignored. */
const OWNER_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/** The most conversations kept per visitor; the oldest go first. */
export const MAX_CHATS = 50;

export const DEFAULT_RETENTION_DAYS = 30;
const MAX_RETENTION_DAYS = 365;

/** A conversation in the visitor's list. */
export interface ChatSummary {
  id: string;
  title: string;
  status: "regular" | "archived";
  /** Milliseconds since the epoch. */
  lastMessageAt: number;
}

export type ChatChanges = Partial<Pick<ChatSummary, "title" | "status">>;

/** The library's store, plus what the thread list needs. Every call takes the owner. */
export interface AppChatStore extends ChatStore {
  list(owner: string): Promise<ChatSummary[]>;
  summary(owner: string, chatId: string): Promise<ChatSummary | undefined>;
  /** `false` if the owner has no such conversation. */
  update(owner: string, chatId: string, changes: ChatChanges): Promise<boolean>;
  delete(owner: string, chatId: string): Promise<void>;
}

/** A new owner id: random and unguessable, because it is the only key to a visitor's chats. */
export function newOwnerId(): string {
  return randomBytes(16).toString("base64url");
}

/** The owner id in a request's cookie, or `undefined` if there is none or it is malformed. */
export function readOwner(request: Request): string | undefined {
  const header = request.headers.get("cookie") ?? "";
  for (const pair of header.split(";")) {
    const [name, ...value] = pair.trim().split("=");
    if (name === OWNER_COOKIE) {
      const owner = value.join("=");
      return OWNER_PATTERN.test(owner) ? owner : undefined;
    }
  }
  return undefined;
}

/**
 * The `Set-Cookie` value for an owner id. `HttpOnly`, so page scripts cannot read it, and
 * `SameSite=Lax`, so another site's requests do not carry it. `Secure` outside development,
 * where the page is served over plain HTTP.
 */
export function ownerCookie(owner: string, maxAgeSeconds: number, secure: boolean): string {
  return [
    `${OWNER_COOKIE}=${owner}`,
    "Path=/",
    `Max-Age=${maxAgeSeconds}`,
    "HttpOnly",
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

const summarySchema = z.object({
  title: z.string(),
  status: z.enum(["regular", "archived"]),
  lastMessageAt: z.number(),
});

function parseSummary(id: string, value: unknown): ChatSummary | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const parsed = summarySchema.safeParse(JSON.parse(value));
    return parsed.success ? { id, ...parsed.data } : undefined;
  } catch {
    return undefined;
  }
}

/** A new conversation's title, from its first question, as the browser shows it. */
function firstTitle(messages: UIMessage[]): string {
  const first = messages.find((message) => message.role === "user");
  return titleFromText(
    (first?.parts ?? []).map((part) => (part.type === "text" ? part.text : "")).join(" "),
  );
}

/**
 * A hash's fields as an object. With `automaticDeserialization: false`, Upstash returns `HGETALL`
 * as Redis does, a flat list of field and value; an object is accepted too.
 */
function hashFields(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) {
    const fields: Record<string, unknown> = {};
    for (let index = 0; index + 1 < value.length; index += 2) {
      fields[String(value[index])] = value[index + 1];
    }
    return fields;
  }
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

/** The part of the Redis client the store uses, so tests can pass a fake. */
export type ChatHistoryRedis = Pick<Redis, "get" | "hget" | "hgetall" | "hset" | "multi">;

/**
 * Conversations in Redis. Each visitor has one key per conversation, `chat:history:{owner}:{id}`,
 * holding its messages as JSON, and one hash, `chat:list:{owner}`, holding each conversation's
 * title, status, and last message time. Both expire `retentionSeconds` after the last save, and the
 * list drops entries older than that, so nothing outlives the retention period.
 */
export function createRedisChatStore(
  redis: ChatHistoryRedis,
  retentionSeconds: number,
  now: () => number = Date.now,
): AppChatStore {
  const chatKey = (owner: string, id: string) => `chat:history:${owner}:${id}`;
  const listKey = (owner: string) => `chat:list:${owner}`;

  const allSummaries = async (owner: string) => {
    const fields = hashFields(await redis.hgetall(listKey(owner)));
    return Object.entries(fields).map(([id, value]) => ({ id, summary: parseSummary(id, value) }));
  };

  /** Removes conversations past retention or beyond `MAX_CHATS`, and entries that do not parse. */
  const prune = async (owner: string): Promise<ChatSummary[]> => {
    const cutoff = now() - retentionSeconds * 1000;
    const entries = await allSummaries(owner);
    const kept = entries
      .flatMap(({ summary }) => (summary && summary.lastMessageAt > cutoff ? [summary] : []))
      .sort((a, b) => b.lastMessageAt - a.lastMessageAt)
      .slice(0, MAX_CHATS);
    const keptIds = new Set(kept.map((summary) => summary.id));
    const dropped = entries.map(({ id }) => id).filter((id) => !keptIds.has(id));
    if (dropped.length > 0) {
      const transaction = redis.multi().hdel(listKey(owner), ...dropped);
      for (const id of dropped) transaction.del(chatKey(owner, id));
      await transaction.exec();
    }
    return kept;
  };

  return {
    async load(owner, chatId) {
      const value = await redis.get<string>(chatKey(owner, chatId));
      if (value === null) return undefined;
      try {
        // Checked by the library before use.
        return JSON.parse(value) as UIMessage[];
      } catch {
        return undefined;
      }
    },

    async save(owner, chatId, messages) {
      const earlier = parseSummary(chatId, await redis.hget(listKey(owner), chatId));
      const summary = {
        title: earlier?.title ?? firstTitle(messages),
        status: earlier?.status ?? "regular",
        lastMessageAt: now(),
      };
      const results = await redis
        .multi()
        .set(chatKey(owner, chatId), JSON.stringify(messages), { ex: retentionSeconds })
        .hset(listKey(owner), { [chatId]: JSON.stringify(summary) })
        .expire(listKey(owner), retentionSeconds)
        .hlen(listKey(owner))
        .exec();
      const count = results[3];
      if (typeof count === "number" && count > MAX_CHATS) await prune(owner);
    },

    list: prune,

    async summary(owner, chatId) {
      const summary = parseSummary(chatId, await redis.hget(listKey(owner), chatId));
      const cutoff = now() - retentionSeconds * 1000;
      return summary && summary.lastMessageAt > cutoff ? summary : undefined;
    },

    async update(owner, chatId, changes) {
      const summary = parseSummary(chatId, await redis.hget(listKey(owner), chatId));
      if (!summary) return false;
      const { id: _id, ...rest } = { ...summary, ...changes };
      await redis.hset(listKey(owner), { [chatId]: JSON.stringify(rest) });
      return true;
    },

    async delete(owner, chatId) {
      await redis.multi().hdel(listKey(owner), chatId).del(chatKey(owner, chatId)).exec();
    },
  };
}

/** The same store in this process's memory, for `next dev` without Redis. */
export function createMemoryAppChatStore(now: () => number = Date.now): AppChatStore {
  const chats = new Map<string, { summary: ChatSummary; messages: UIMessage[] }>();
  const key = (owner: string, id: string) => `${owner}\u0000${id}`;
  const ownedBy = (owner: string) =>
    [...chats.entries()].filter(([entry]) => entry.startsWith(`${owner}\u0000`));
  return {
    load: async (owner, id) => structuredClone(chats.get(key(owner, id))?.messages),
    save: async (owner, id, messages) => {
      const earlier = chats.get(key(owner, id))?.summary;
      chats.set(key(owner, id), {
        summary: {
          id,
          title: earlier?.title ?? firstTitle(messages),
          status: earlier?.status ?? "regular",
          lastMessageAt: now(),
        },
        messages: structuredClone(messages),
      });
    },
    list: async (owner) =>
      ownedBy(owner)
        .map(([, chat]) => chat.summary)
        .sort((a, b) => b.lastMessageAt - a.lastMessageAt)
        .slice(0, MAX_CHATS),
    summary: async (owner, id) => chats.get(key(owner, id))?.summary,
    update: async (owner, id, changes) => {
      const chat = chats.get(key(owner, id));
      if (!chat) return false;
      chat.summary = { ...chat.summary, ...changes };
      return true;
    },
    delete: async (owner, id) => {
      chats.delete(key(owner, id));
    },
  };
}

export type ChatHistoryConfigResult =
  | { status: "ok"; retentionDays: number }
  /** Names the variable, never its value. */
  | { status: "invalid"; problem: string };

/** How long conversations are kept: `CHAT_HISTORY_DAYS`, 30 by default. */
export function loadChatHistoryConfig(env: AppEnv = process.env): ChatHistoryConfigResult {
  const value = env.CHAT_HISTORY_DAYS?.trim();
  if (!value) return { status: "ok", retentionDays: DEFAULT_RETENTION_DAYS };
  const days = Number(value);
  if (!Number.isSafeInteger(days) || days < 1 || days > MAX_RETENTION_DAYS) {
    return {
      status: "invalid",
      problem: `CHAT_HISTORY_DAYS must be a whole number from 1 to ${MAX_RETENTION_DAYS}`,
    };
  }
  return { status: "ok", retentionDays: days };
}

/** How many days conversations are kept, for the notice on the page. */
export function chatRetentionDays(env: AppEnv = process.env): number {
  const config = loadChatHistoryConfig(env);
  return config.status === "ok" ? config.retentionDays : DEFAULT_RETENTION_DAYS;
}

export interface AppChatHistory {
  store: AppChatStore;
  retentionSeconds: number;
  /** Whether the owner cookie needs `Secure`. */
  secureCookie: boolean;
}

let developmentStore: AppChatStore | undefined;

const REFUSING_STORE: AppChatStore = {
  load: () => Promise.reject(new Error("chat history is not configured")),
  save: () => Promise.reject(new Error("chat history is not configured")),
  list: () => Promise.reject(new Error("chat history is not configured")),
  summary: () => Promise.reject(new Error("chat history is not configured")),
  update: () => Promise.reject(new Error("chat history is not configured")),
  delete: () => Promise.reject(new Error("chat history is not configured")),
};

/**
 * The store for this request. It shares the Redis database with the limits. Without Redis, `next dev`
 * keeps conversations in memory and warns; anywhere else every call fails, so chat answers 503
 * rather than keeping visitors' conversations somewhere they would be lost.
 */
export function createAppChatHistory(env: AppEnv = process.env): AppChatHistory {
  const development = env.NODE_ENV === "development";
  const config = loadChatHistoryConfig(env);
  const retentionDays = config.status === "ok" ? config.retentionDays : DEFAULT_RETENTION_DAYS;
  if (config.status === "invalid") console.error(`[chat] ${config.problem}`);
  const retentionSeconds = retentionDays * 24 * 60 * 60;
  const secureCookie = !development;

  const redis = loadRedisConfig(env);
  if (redis.status === "ok" && config.status === "ok") {
    return {
      store: createRedisChatStore(createRedisClient(redis.config), retentionSeconds),
      retentionSeconds,
      secureCookie,
    };
  }
  if (development) {
    console.warn("[chat] conversations kept in memory in development: Redis is not configured");
    developmentStore ??= createMemoryAppChatStore();
    return { store: developmentStore, retentionSeconds, secureCookie };
  }
  if (redis.status !== "ok") {
    console.error(
      `[chat] history not configured: ${redis.status === "off" ? "Redis is not set" : redis.problem}`,
    );
  }
  return { store: REFUSING_STORE, retentionSeconds, secureCookie };
}
