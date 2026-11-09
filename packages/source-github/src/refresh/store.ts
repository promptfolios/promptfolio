/** What the background refresh keeps in the store. */
export type SnapshotStoreKey = "snapshot" | "refresh-after";

/**
 * Where the background refresh keeps the snapshot, when the next refresh is due, and a lock. The
 * application implements it (for example with Redis), so this package names no store. Values must
 * survive a JSON round trip; the package validates everything it reads back.
 *
 * Every method may reject; the refresh treats that as a failure and tries again later.
 */
export interface GitHubSnapshotStore {
  /** The stored value, or `undefined` (or `null`) when nothing is stored under `key`. */
  get(key: SnapshotStoreKey): Promise<unknown>;
  /** Replaces the value stored under `key`, with no expiry. */
  set(key: SnapshotStoreKey, value: unknown): Promise<void>;
  /**
   * Takes the refresh lock if no one holds it, atomically, for at most `ttlSeconds`. Returns a
   * token that identifies this holder, or `undefined` if the lock is held. With Redis:
   * `SET <key> <random token> NX EX <ttlSeconds>`.
   */
  lock(ttlSeconds: number): Promise<string | undefined>;
  /**
   * Releases the lock only if `token` still holds it, so a run that outlived its lock never
   * releases a later run's lock. With Redis: compare and delete in one script.
   */
  unlock(token: string): Promise<void>;
}

/**
 * A store in this process's memory, for tests and local development. Each server instance has
 * its own and a restart loses it, so it is not for a deployed site.
 *
 * @param options.now Injected for tests; the clock the lock expiry uses.
 */
export function createMemorySnapshotStore(
  options: { now?: () => number } = {},
): GitHubSnapshotStore {
  const now = options.now ?? Date.now;
  const values = new Map<SnapshotStoreKey, unknown>();
  let held: { token: string; expiresAt: number } | undefined;
  return {
    get: async (key) => {
      const value = values.get(key);
      return value === undefined ? undefined : structuredClone(value);
    },
    set: async (key, value) => {
      values.set(key, structuredClone(value));
    },
    lock: async (ttlSeconds) => {
      if (held !== undefined && now() < held.expiresAt) return undefined;
      held = { token: crypto.randomUUID(), expiresAt: now() + ttlSeconds * 1000 };
      return held.token;
    },
    unlock: async (token) => {
      if (held?.token === token) held = undefined;
    },
  };
}
