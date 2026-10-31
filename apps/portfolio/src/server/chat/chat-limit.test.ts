import { afterEach, describe, expect, it, vi } from "vitest";

// `server-only` throws outside a React Server Components build; tests run in plain Node.
vi.mock("server-only", () => ({}));

const { createChatLimit, createRedisChatLimiter, loadChatLimitConfig } = await import(
  "./chat-limit"
);

const SECRET = "s".repeat(32);
const complete = {
  UPSTASH_REDIS_REST_URL: "https://store.example.test",
  UPSTASH_REDIS_REST_TOKEN: "redis_test_token",
  VISITOR_HASH_SECRET: SECRET,
};

/** A store with real counters, which records every call. */
function fakeRedis() {
  const counters = new Map<string, number>();
  const expiries: Array<[string, number, string]> = [];
  const redis = {
    multi: () => {
      let key = "";
      const transaction = {
        incr: (name: string) => {
          key = name;
          return transaction;
        },
        expire: (name: string, seconds: number, option: string) => {
          expiries.push([name, seconds, option]);
          return transaction;
        },
        exec: async () => {
          const count = (counters.get(key) ?? 0) + 1;
          counters.set(key, count);
          return [count, 1];
        },
      };
      return transaction;
    },
  };
  return { redis: redis as never, counters, expiries };
}

function redisAnswering(answer: unknown) {
  const transaction = {
    incr: () => transaction,
    expire: () => transaction,
    exec: async () => answer,
  };
  return { multi: () => transaction } as never;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createRedisChatLimiter", () => {
  it("allows up to the visitor's allowance, then refuses that visitor only", async () => {
    const { redis } = fakeRedis();
    const limiter = createRedisChatLimiter(redis, { perVisitor: 2, forSite: 100 });

    await expect(limiter.take("a")).resolves.toBe("allowed");
    await expect(limiter.take("a")).resolves.toBe("allowed");
    await expect(limiter.take("a")).resolves.toBe("visitor-limit");
    await expect(limiter.take("b")).resolves.toBe("allowed");
  });

  it("refuses everyone once the site's allowance is used up", async () => {
    const { redis } = fakeRedis();
    const limiter = createRedisChatLimiter(redis, { perVisitor: 100, forSite: 2 });

    await limiter.take("a");
    await limiter.take("b");

    await expect(limiter.take("c")).resolves.toBe("site-limit");
  });

  it("does not use the site's allowance for a blocked visitor", async () => {
    const { redis, counters } = fakeRedis();
    const limiter = createRedisChatLimiter(redis, { perVisitor: 1, forSite: 100 });

    await limiter.take("a");
    await limiter.take("a");
    await limiter.take("a");

    expect(counters.get("chat:turns:site")).toBe(1);
  });

  it("uses the shipped allowances by default: the 31st and the 201st are refused", async () => {
    const { redis } = fakeRedis();
    const limiter = createRedisChatLimiter(redis);

    for (let turn = 0; turn < 30; turn += 1) {
      await expect(limiter.take("a")).resolves.toBe("allowed");
    }
    await expect(limiter.take("a")).resolves.toBe("visitor-limit");

    for (let visitor = 0; visitor < 170; visitor += 1) {
      await expect(limiter.take(`visitor-${visitor}`)).resolves.toBe("allowed");
    }
    await expect(limiter.take("last")).resolves.toBe("site-limit");
  });

  it("sets each counter to expire 24 hours after its first count, only if it has no expiry", async () => {
    const { redis, expiries } = fakeRedis();
    await createRedisChatLimiter(redis).take("a");

    expect(expiries).toEqual([
      ["chat:turns:visitor:a", 86_400, "NX"],
      ["chat:turns:site", 86_400, "NX"],
    ]);
  });

  it.each([[[0, 1]], [["1", 1]], [[null, null]], [[1.5, 1]], [[]], ["OK"]])(
    "rejects on the unexpected answer %j rather than allowing the answer",
    async (answer) => {
      const limiter = createRedisChatLimiter(redisAnswering(answer));
      await expect(limiter.take("a")).rejects.toThrow();
    },
  );

  it("passes on a store error", async () => {
    const transaction = {
      incr: () => transaction,
      expire: () => transaction,
      exec: async () => {
        throw new Error("store down");
      },
    };
    const limiter = createRedisChatLimiter({ multi: () => transaction } as never);

    await expect(limiter.take("a")).rejects.toThrow("store down");
  });
});

describe("loadChatLimitConfig", () => {
  it("accepts complete settings", () => {
    expect(loadChatLimitConfig(complete)).toEqual({
      status: "ok",
      redis: { url: "https://store.example.test", token: "redis_test_token" },
      visitorSecret: SECRET,
    });
  });

  it.each([
    ["no settings", {}, "UPSTASH_REDIS_REST_URL"],
    ["no token", { ...complete, UPSTASH_REDIS_REST_TOKEN: "" }, "UPSTASH_REDIS_REST_TOKEN"],
    ["a bad URL", { ...complete, UPSTASH_REDIS_REST_URL: "nope" }, "UPSTASH_REDIS_REST_URL"],
    ["no secret", { ...complete, VISITOR_HASH_SECRET: " " }, "VISITOR_HASH_SECRET"],
    ["a short secret", { ...complete, VISITOR_HASH_SECRET: "short" }, "VISITOR_HASH_SECRET"],
  ])("reports %s by variable name, without values", (_label, env, name) => {
    const result = loadChatLimitConfig(env);

    expect(result.status).toBe("missing");
    expect(result.status === "missing" && result.problem).toContain(name);
    expect(JSON.stringify(result)).not.toContain("redis_test_token");
    expect(JSON.stringify(result)).not.toContain("short");
  });
});

describe("createChatLimit", () => {
  function request() {
    return new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "x-forwarded-for": "203.0.113.7" },
    });
  }

  it("refuses live answers outside development when settings are missing", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const limit = createChatLimit({ NODE_ENV: "production" });

    expect(limit).not.toBeNull();
    await expect(limit?.limiter.take("a")).rejects.toThrow();
    expect(error.mock.calls[0]?.[0]).toContain("UPSTASH_REDIS_REST_URL");
  });

  it("refuses when NODE_ENV is not set at all", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(createChatLimit({})).not.toBeNull();
  });

  it("runs without a limit in development, with a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(createChatLimit({ NODE_ENV: "development" })).toBeNull();
    expect(warn.mock.calls[0]?.[0]).toContain("no rate limit");
  });

  it("uses the limit in development too, when it is configured", async () => {
    const limit = createChatLimit({ ...complete, NODE_ENV: "development" });

    expect(limit).not.toBeNull();
    expect(await limit?.identifyVisitor(request())).toBeTruthy();
  });

  it("hashes the visitor, and differently from the contact form's label", async () => {
    const visitor = await createChatLimit(complete)?.identifyVisitor(request());

    expect(visitor).toBeTruthy();
    expect(visitor).not.toContain("203.0.113.7");
    const { createVisitorIdentifier } = await import("../shared/visitor");
    expect(await createVisitorIdentifier(SECRET, "contact-visitor")(request())).not.toBe(visitor);
  });
});
