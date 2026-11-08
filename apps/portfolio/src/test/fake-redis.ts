/**
 * An in-memory stand-in for the parts of `@upstash/redis` the app uses, for tests only. Values are
 * strings, as with `automaticDeserialization: false`. Expiry is recorded, not applied.
 */
export const fakeRedis = {
  strings: new Map<string, string>(),
  hashes: new Map<string, Map<string, string>>(),
  counts: new Map<string, number>(),
  expiries: new Map<string, number>(),
  /** When true, every command rejects with an error that names the token. */
  fails: false,
  reset() {
    this.strings.clear();
    this.hashes.clear();
    this.counts.clear();
    this.expiries.clear();
    this.fails = false;
  },
};

function check() {
  if (fakeRedis.fails) throw new Error("store down with redis_test_token");
}

function hash(key: string): Map<string, string> {
  let fields = fakeRedis.hashes.get(key);
  if (!fields) {
    fields = new Map();
    fakeRedis.hashes.set(key, fields);
  }
  return fields;
}

const commands = {
  get: (key: string) => fakeRedis.strings.get(key) ?? null,
  set: (key: string, value: string, opts?: { ex?: number }) => {
    fakeRedis.strings.set(key, value);
    if (opts?.ex !== undefined) fakeRedis.expiries.set(key, opts.ex);
    return "OK";
  },
  del: (...keys: string[]) => keys.filter((key) => fakeRedis.strings.delete(key)).length,
  incr: (key: string) => {
    const count = (fakeRedis.counts.get(key) ?? 0) + 1;
    fakeRedis.counts.set(key, count);
    return count;
  },
  expire: (key: string, seconds: number) => {
    fakeRedis.expiries.set(key, seconds);
    return 1;
  },
  hget: (key: string, field: string) => fakeRedis.hashes.get(key)?.get(field) ?? null,
  hgetall: (key: string) => {
    const fields = fakeRedis.hashes.get(key);
    // As Upstash returns it with `automaticDeserialization: false`: field, value, field, value.
    return [...(fields ?? new Map()).entries()].flat();
  },
  hset: (key: string, values: Record<string, string>) => {
    const fields = hash(key);
    for (const [field, value] of Object.entries(values)) fields.set(field, value);
    return Object.keys(values).length;
  },
  hdel: (key: string, ...fields: string[]) =>
    fields.filter((field) => fakeRedis.hashes.get(key)?.delete(field)).length,
  hlen: (key: string) => fakeRedis.hashes.get(key)?.size ?? 0,
};

type Commands = typeof commands;

/** Use as the `Redis` class: `vi.mock("@upstash/redis", () => ({ Redis: FakeRedis }))`. */
export class FakeRedis {
  async get(key: string) {
    check();
    return commands.get(key);
  }
  async hget(key: string, field: string) {
    check();
    return commands.hget(key, field);
  }
  async hgetall(key: string) {
    check();
    return commands.hgetall(key);
  }
  async hset(key: string, values: Record<string, string>) {
    check();
    return commands.hset(key, values);
  }
  multi() {
    const queued: Array<() => unknown> = [];
    const transaction = new Proxy({} as Record<string, unknown>, {
      get(_target, name: string) {
        if (name === "exec") {
          return async () => {
            check();
            return queued.map((run) => run());
          };
        }
        const command = commands[name as keyof Commands] as (...args: unknown[]) => unknown;
        if (!command) throw new Error(`fake Redis has no ${name}`);
        return (...args: unknown[]) => {
          queued.push(() => command(...args));
          return transaction;
        };
      },
    });
    return transaction;
  }
}
