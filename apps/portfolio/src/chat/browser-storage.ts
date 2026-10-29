import { STORAGE_PREFIX, type StorageLike } from "./thread-store";

/** A `StorageLike` that lives in memory: lost on reload, like the threads before M6. */
export function createMemoryStorage(): StorageLike {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    key: (index) => [...items.keys()][index] ?? null,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, String(value));
    },
    removeItem: (key) => {
      items.delete(key);
    },
  };
}

/**
 * The browser's `localStorage` if it can be written, otherwise memory storage. Storage is
 * missing during server rendering, and can be blocked or full in the browser; the chat
 * then works as before M6 and forgets threads on reload.
 */
export function openBrowserStorage(): StorageLike {
  if (typeof window === "undefined") return createMemoryStorage();
  try {
    const storage = window.localStorage;
    const probe = `${STORAGE_PREFIX}probe`;
    storage.setItem(probe, "1");
    storage.removeItem(probe);
    return storage;
  } catch {
    return createMemoryStorage();
  }
}
