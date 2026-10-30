import { z } from "zod";
import { chatSourcesSchema, SOURCES_PART_TYPE } from "./sources";
import { STORAGE_LIMITS } from "./storage-limits";

/** The part of the Web Storage API the store uses; `window.localStorage` satisfies it. */
export interface StorageLike {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Versioned, so a later format can ignore or migrate data written by this one. */
export const STORAGE_PREFIX = "promptfolio:v1:";
const THREADS_KEY = `${STORAGE_PREFIX}threads`;
const THREAD_KEY_PREFIX = `${STORAGE_PREFIX}thread:`;
const TITLE_MAX = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Thread ids become part of a storage key, so only plain characters are allowed. */
const threadIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const messageIdSchema = z.string().min(1).max(200);

/**
 * The same part types the server accepts. `z.object` strips unknown keys, so extra
 * fields such as `providerMetadata` are never kept. Sources that fail their check are dropped,
 * and the answer's text is kept.
 */
const partSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("step-start") }),
  z.object({
    type: z.literal(SOURCES_PART_TYPE),
    id: z.string().max(100).optional(),
    data: chatSourcesSchema,
  }),
]);
type StoredPart = z.infer<typeof partSchema>;

const storedMessageSchema = z
  .object({
    id: messageIdSchema,
    parentId: messageIdSchema.nullable(),
    role: z.enum(["user", "assistant"]),
    parts: z.array(partSchema),
  })
  .refine((message) => textLength(message.parts) <= STORAGE_LIMITS.maxMessageChars);
export type StoredMessage = z.infer<typeof storedMessageSchema>;

const storedThreadSchema = z.object({
  id: threadIdSchema,
  title: z.string().max(TITLE_MAX).optional(),
  status: z.enum(["regular", "archived"]),
  createdAt: z.iso.datetime(),
  lastMessageAt: z.iso.datetime(),
});
export type StoredThread = z.infer<typeof storedThreadSchema>;

/** A message as the runtime hands it over: not yet checked or trimmed. */
export interface MessageInput {
  id: string;
  parentId: string | null;
  role: unknown;
  parts: unknown;
}

export type SaveResult =
  | { ok: true }
  | {
      ok: false;
      reason: "invalid" | "unknown-thread" | "missing-parent" | "limit" | "storage";
    };

export interface ThreadStoreOptions {
  storage: StorageLike;
  /** Injectable clock for retention tests. */
  now?: () => Date;
  /** Receives one line per skipped write or failed storage call; never message content. */
  warn?: (message: string) => void;
}

/**
 * Conversations saved in one browser storage: a thread index plus one key per thread.
 *
 * Everything read back is untrusted (it may be malformed, old, oversized, or edited by
 * hand) and is validated before use. Every method catches storage failures (quota,
 * blocked storage) and never throws, so the chat keeps working in memory without it.
 * There is no cache: each call reads the storage, so the store holds no state of its own.
 */
export class ThreadStore {
  private readonly storage: StorageLike;
  private readonly now: () => Date;
  private readonly warn: (message: string) => void;

  constructor(options: ThreadStoreOptions) {
    this.storage = options.storage;
    this.now = options.now ?? (() => new Date());
    this.warn = options.warn ?? ((message) => console.warn(message));
  }

  /**
   * Saved threads, most recently used first. Also applies retention: removes expired
   * threads, invalid index entries, and thread keys that no index entry references.
   */
  listThreads(): StoredThread[] {
    const { threads, dirty } = this.readIndex();
    const cutoff = this.now().getTime() - STORAGE_LIMITS.retentionDays * DAY_MS;
    const kept = threads.filter((thread) => Date.parse(thread.lastMessageAt) >= cutoff);
    if (dirty || kept.length !== threads.length) this.writeIndex(kept);
    this.removeOrphans(new Set(kept.map((thread) => thread.id)));
    return kept.sort((a, b) => Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt));
  }

  getThread(id: string): StoredThread | undefined {
    return this.readIndex().threads.find((thread) => thread.id === id);
  }

  /**
   * Adds a thread (or returns the existing one). When this exceeds `maxThreads`, the least
   * recently used threads are removed. Returns `undefined` for an id that cannot be used as
   * a key, or when the storage refuses the write.
   */
  createThread(id: string): StoredThread | undefined {
    if (!threadIdSchema.safeParse(id).success) {
      this.warn("Promptfolio: not saving a thread with an unexpected id.");
      return undefined;
    }
    const threads = this.readIndex().threads;
    const existing = threads.find((thread) => thread.id === id);
    if (existing) return existing;

    const timestamp = this.now().toISOString();
    const thread: StoredThread = {
      id,
      status: "regular",
      createdAt: timestamp,
      lastMessageAt: timestamp,
    };
    const byAge = [...threads].sort(
      (a, b) => Date.parse(a.lastMessageAt) - Date.parse(b.lastMessageAt),
    );
    const evicted = byAge.slice(0, Math.max(0, threads.length + 1 - STORAGE_LIMITS.maxThreads));
    const evictedIds = new Set(evicted.map((item) => item.id));
    const next = [thread, ...threads.filter((item) => !evictedIds.has(item.id))];
    if (!this.writeIndex(next)) return undefined;
    for (const item of evicted) this.remove(threadKey(item.id));
    return thread;
  }

  /** Changes a thread's title or status. Returns false when the thread is not saved. */
  updateThread(id: string, patch: { title?: string; status?: StoredThread["status"] }): boolean {
    const threads = this.readIndex().threads;
    const thread = threads.find((item) => item.id === id);
    if (!thread) return false;
    if (patch.title !== undefined) thread.title = patch.title.slice(0, TITLE_MAX);
    if (patch.status !== undefined) thread.status = patch.status;
    return this.writeIndex(threads);
  }

  /** Removes the thread's messages and its index entry. Deleting a missing thread succeeds. */
  deleteThread(id: string): void {
    const threads = this.readIndex().threads;
    const next = threads.filter((thread) => thread.id !== id);
    if (next.length !== threads.length) this.writeIndex(next);
    if (threadIdSchema.safeParse(id).success) this.remove(threadKey(id));
  }

  /**
   * The thread's messages in stored order. Invalid entries are dropped, as is every entry
   * whose parent was not accepted before it (a missing parent, its descendants, or a cycle).
   */
  loadMessages(threadId: string): StoredMessage[] {
    if (!threadIdSchema.safeParse(threadId).success) return [];
    const raw = this.get(threadKey(threadId));
    if (raw === null) return [];
    if (raw.length > STORAGE_LIMITS.maxThreadChars) {
      this.warn("Promptfolio: ignoring a saved thread that exceeds maxThreadChars.");
      return [];
    }
    const data = parseJson(raw);
    if (!isRecord(data) || !Array.isArray(data.messages)) return [];

    const accepted = new Set<string>();
    const messages: StoredMessage[] = [];
    for (const entry of data.messages) {
      if (messages.length >= STORAGE_LIMITS.maxMessagesPerThread) break;
      const parsed = storedMessageSchema.safeParse(entry);
      if (!parsed.success) continue;
      const message = parsed.data;
      if (accepted.has(message.id)) continue;
      if (message.parentId !== null && !accepted.has(message.parentId)) continue;
      accepted.add(message.id);
      messages.push(message);
    }
    return messages;
  }

  /**
   * Adds or replaces (by id) one message. Keeps only `id`, `parentId`, `role`, and text,
   * `step-start`, and sources parts. A write that would exceed a limit is skipped and reported, leaving
   * the saved thread unchanged.
   */
  saveMessage(threadId: string, input: MessageInput): SaveResult {
    const thread = this.getThread(threadId);
    if (!thread) return { ok: false, reason: "unknown-thread" };

    const parts = Array.isArray(input.parts) ? input.parts.flatMap(allowedPart) : [];
    const parsed = storedMessageSchema.safeParse({
      id: input.id,
      parentId: input.parentId,
      role: input.role,
      parts,
    });
    if (!parsed.success) {
      const reason = textLength(parts) > STORAGE_LIMITS.maxMessageChars ? "limit" : "invalid";
      this.warn(
        reason === "limit"
          ? "Promptfolio: not saving a message that exceeds maxMessageChars."
          : "Promptfolio: not saving a message with an unexpected shape.",
      );
      return { ok: false, reason };
    }
    const message = parsed.data;

    const messages = this.loadMessages(threadId);
    if (message.parentId !== null && !messages.some((item) => item.id === message.parentId)) {
      // Its parent was never saved (for example, it hit a limit), so it could not be loaded.
      return { ok: false, reason: "missing-parent" };
    }
    const index = messages.findIndex((item) => item.id === message.id);
    if (index >= 0) messages[index] = message;
    else messages.push(message);
    if (messages.length > STORAGE_LIMITS.maxMessagesPerThread) {
      this.warn("Promptfolio: not saving a message beyond maxMessagesPerThread.");
      return { ok: false, reason: "limit" };
    }
    const serialized = JSON.stringify({ messages });
    if (serialized.length > STORAGE_LIMITS.maxThreadChars) {
      this.warn("Promptfolio: not saving a message beyond maxThreadChars.");
      return { ok: false, reason: "limit" };
    }
    if (!this.set(threadKey(threadId), serialized)) return { ok: false, reason: "storage" };
    this.touch(threadId);
    return { ok: true };
  }

  /**
   * Removes messages by id. Children of a removed message are re-linked to its nearest kept
   * ancestor, so they still load. Removing a missing message succeeds.
   */
  deleteMessages(threadId: string, messageIds: readonly string[]): void {
    const ids = new Set(messageIds);
    const messages = this.loadMessages(threadId);
    if (!messages.some((message) => ids.has(message.id))) return;
    const parents = new Map(messages.map((message) => [message.id, message.parentId]));
    const kept = messages.flatMap((message) => {
      if (ids.has(message.id)) return [];
      let parentId = message.parentId;
      // `loadMessages` only returns parents that come first, so this walk cannot loop.
      while (parentId !== null && ids.has(parentId)) parentId = parents.get(parentId) ?? null;
      return [{ ...message, parentId }];
    });
    this.set(threadKey(threadId), JSON.stringify({ messages: kept }));
  }

  private touch(threadId: string): void {
    const threads = this.readIndex().threads;
    const thread = threads.find((item) => item.id === threadId);
    if (!thread) return;
    thread.lastMessageAt = this.now().toISOString();
    this.writeIndex(threads);
  }

  /** Valid index entries; `dirty` when anything invalid or duplicated was dropped. */
  private readIndex(): { threads: StoredThread[]; dirty: boolean } {
    const raw = this.get(THREADS_KEY);
    if (raw === null) return { threads: [], dirty: false };
    const data = parseJson(raw);
    if (!Array.isArray(data)) return { threads: [], dirty: true };
    const seen = new Set<string>();
    const threads: StoredThread[] = [];
    for (const entry of data) {
      const parsed = storedThreadSchema.safeParse(entry);
      if (!parsed.success || seen.has(parsed.data.id)) continue;
      seen.add(parsed.data.id);
      threads.push(parsed.data);
    }
    return { threads, dirty: threads.length !== data.length };
  }

  private writeIndex(threads: StoredThread[]): boolean {
    return this.set(THREADS_KEY, JSON.stringify(threads));
  }

  /** Removes `thread:` keys under this version's prefix that the index does not list. */
  private removeOrphans(listed: Set<string>): void {
    const orphans: string[] = [];
    try {
      for (let index = 0; index < this.storage.length; index++) {
        const key = this.storage.key(index);
        if (
          key?.startsWith(THREAD_KEY_PREFIX) &&
          !listed.has(key.slice(THREAD_KEY_PREFIX.length))
        ) {
          orphans.push(key);
        }
      }
    } catch {
      this.warn("Promptfolio: could not read the browser storage.");
      return;
    }
    for (const key of orphans) this.remove(key);
  }

  private get(key: string): string | null {
    try {
      return this.storage.getItem(key);
    } catch {
      this.warn("Promptfolio: could not read the browser storage.");
      return null;
    }
  }

  private set(key: string, value: string): boolean {
    try {
      this.storage.setItem(key, value);
      return true;
    } catch {
      // Usually `QuotaExceededError`, or storage blocked by the browser.
      this.warn("Promptfolio: could not write to the browser storage.");
      return false;
    }
  }

  private remove(key: string): void {
    try {
      this.storage.removeItem(key);
    } catch {
      this.warn("Promptfolio: could not write to the browser storage.");
    }
  }
}

function threadKey(id: string): string {
  return `${THREAD_KEY_PREFIX}${id}`;
}

/** Keeps a part only if it is one of the allowed types, without its extra fields. */
function allowedPart(part: unknown): StoredPart[] {
  const parsed = partSchema.safeParse(part);
  return parsed.success ? [parsed.data] : [];
}

function textLength(parts: readonly StoredPart[]): number {
  return parts.reduce((sum, part) => sum + (part.type === "text" ? part.text.length : 0), 0);
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
