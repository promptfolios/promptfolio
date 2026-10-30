import { afterEach, describe, expect, it, vi } from "vitest";

// `server-only` throws outside a React Server Components build; tests run in plain Node.
vi.mock("server-only", () => ({}));

const {
  createRedisLimiter,
  createResendSender,
  createVisitorIdentifier,
  isContactEnabled,
  loadContactConfig,
  visitorNetwork,
} = await import("./contact");

const complete = {
  RESEND_API_KEY: "re_test_key",
  CONTACT_TO_EMAIL: "owner-private@example.test",
  CONTACT_FROM_EMAIL: "Portfolio <contact@example.test>",
  CONTACT_TOKEN_SECRET: "s".repeat(32),
  UPSTASH_REDIS_REST_URL: "https://store.example.test",
  UPSTASH_REDIS_REST_TOKEN: "redis_test_token",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadContactConfig", () => {
  it("accepts a complete configuration", () => {
    expect(loadContactConfig(complete)).toEqual({
      status: "ok",
      config: {
        apiKey: "re_test_key",
        recipientAddress: "owner-private@example.test",
        from: "Portfolio <contact@example.test>",
        tokenSecret: "s".repeat(32),
        redisUrl: "https://store.example.test",
        redisToken: "redis_test_token",
      },
    });
  });

  it.each(["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"] as const)(
    "keeps the form off without %s, so the daily limit cannot be missing",
    (name) => {
      const { [name]: _missing, ...partial } = complete;

      expect(loadContactConfig(partial)).toEqual({
        status: "invalid",
        problem: `not set: ${name}`,
      });
      expect(isContactEnabled({ ...partial })).toBe(false);
    },
  );

  it("accepts a local Redis address", () => {
    const result = loadContactConfig({
      ...complete,
      UPSTASH_REDIS_REST_URL: "http://localhost:8079",
    });
    expect(result.status).toBe("ok");
  });

  it("accepts a sender without a display name", () => {
    const result = loadContactConfig({ ...complete, CONTACT_FROM_EMAIL: "contact@example.test" });
    expect(result.status).toBe("ok");
  });

  it("is off when nothing is set, including blank values from the example file", () => {
    expect(loadContactConfig({})).toEqual({ status: "off" });
    expect(
      loadContactConfig({ RESEND_API_KEY: " ", CONTACT_TO_EMAIL: "", CONTACT_FROM_EMAIL: "" }),
    ).toEqual({ status: "off" });
  });

  it("names the missing variables and no values", () => {
    const { CONTACT_TO_EMAIL: _to, ...partial } = complete;
    const result = loadContactConfig(partial);

    expect(result).toEqual({ status: "invalid", problem: "not set: CONTACT_TO_EMAIL" });
    expect(JSON.stringify(result)).not.toContain("re_test_key");
  });

  it.each([
    ["CONTACT_TO_EMAIL", { CONTACT_TO_EMAIL: "not-an-address" }],
    ["CONTACT_FROM_EMAIL", { CONTACT_FROM_EMAIL: "Portfolio <not-an-address>" }],
    ["CONTACT_TOKEN_SECRET", { CONTACT_TOKEN_SECRET: "short" }],
    ["UPSTASH_REDIS_REST_URL", { UPSTASH_REDIS_REST_URL: "not-a-url" }],
    ["UPSTASH_REDIS_REST_URL", { UPSTASH_REDIS_REST_URL: "ftp://store.example.test" }],
  ])("rejects an invalid %s without repeating its value", (name, override) => {
    const result = loadContactConfig({ ...complete, ...override });

    expect(result.status).toBe("invalid");
    expect(result.status === "invalid" && result.problem).toContain(name);
    expect(JSON.stringify(result)).not.toContain(Object.values(override)[0]);
  });
});

describe("isContactEnabled", () => {
  it("is true only for a complete configuration, and logs only a real problem", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(isContactEnabled(complete)).toBe(true);
    expect(isContactEnabled({})).toBe(false);
    expect(error).not.toHaveBeenCalled();

    expect(isContactEnabled({ RESEND_API_KEY: "re_test_key" })).toBe(false);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]?.[0]).not.toContain("re_test_key");
  });
});

describe("createRedisLimiter", () => {
  function limiterWith(setResult: unknown, getResult: unknown = null) {
    const redis = {
      set: vi.fn(async () => setResult),
      get: vi.fn(async () => getResult),
      del: vi.fn(async () => 1),
    };
    return { redis, limiter: createRedisLimiter(redis as never) };
  }

  it("takes a free slot atomically, for 24 hours", async () => {
    const { redis, limiter } = limiterWith("OK");

    await expect(limiter.claim("visitor", "key-1")).resolves.toBe("claimed");
    expect(redis.set).toHaveBeenCalledWith("contact:send:visitor", "key-1", {
      nx: true,
      ex: 86_400,
    });
    expect(redis.get).not.toHaveBeenCalled();
  });

  it("allows the same email again when the slot is held", async () => {
    const { limiter } = limiterWith(null, "key-1");
    await expect(limiter.claim("visitor", "key-1")).resolves.toBe("claimed");
  });

  it("blocks a different email when the slot is held", async () => {
    const { limiter } = limiterWith(null, "key-2");
    await expect(limiter.claim("visitor", "key-1")).resolves.toBe("limited");
  });

  it.each(["signal is aborted", "", 1, undefined])(
    "rejects on the unexpected answer %j rather than treating it as claimed",
    async (answer) => {
      const { limiter } = limiterWith(answer);
      await expect(limiter.claim("visitor", "key-1")).rejects.toThrow();
    },
  );

  it("passes on a store error", async () => {
    const { redis, limiter } = limiterWith("OK");
    redis.set.mockRejectedValueOnce(new Error("store down"));

    await expect(limiter.claim("visitor", "key-1")).rejects.toThrow("store down");
  });

  it("releases the visitor's slot", async () => {
    const { redis, limiter } = limiterWith("OK");
    await limiter.release("visitor");

    expect(redis.del).toHaveBeenCalledWith("contact:send:visitor");
  });
});

describe("visitorNetwork", () => {
  it.each([
    ["an IPv4 address", "203.0.113.7", "203.0.113.7"],
    ["an IPv4 address in IPv6 form", "::ffff:203.0.113.7", "203.0.113.7"],
    ["surrounding spaces", " 203.0.113.7 ", "203.0.113.7"],
    ["a full IPv6 address", "2001:0db8:0001:0002:0003:0004:0005:0006", "2001:db8:1:2"],
    ["a shortened IPv6 address", "2001:db8::1", "2001:db8:0:0"],
    ["an IPv6 address shortened early", "::1", "0:0:0:0"],
    ["a dotted IPv6 tail", "2001:db8::203.0.113.7", "2001:db8:0:0"],
    ["upper case", "2001:DB8:A::1", "2001:db8:a:0"],
    ["a zone", "fe80::1%eth0", "fe80:0:0:0"],
  ])("handles %s", (_label, address, network) => {
    expect(visitorNetwork(address)).toBe(network);
  });

  it("gives every address in one IPv6 /64 the same network, and another /64 a different one", () => {
    const network = visitorNetwork("2001:db8:1:2::a");
    expect(visitorNetwork("2001:db8:1:2:ffff:ffff:ffff:ffff")).toBe(network);
    expect(visitorNetwork("2001:db8:1:3::a")).not.toBe(network);
  });

  it.each(["", "unknown", "not an address", "999.1.1.1", "203.0.113.7:443", "1:2:3"])(
    "refuses %j",
    (address) => {
      expect(visitorNetwork(address)).toBeUndefined();
    },
  );
});

describe("createVisitorIdentifier", () => {
  const SECRET = "s".repeat(32);
  const identify = createVisitorIdentifier(SECRET);

  function requestFrom(headers: Record<string, string>) {
    return new Request("http://localhost/api/contact/send", { method: "POST", headers });
  }

  it("never returns the address, and is stable for one address", async () => {
    const first = await identify(requestFrom({ "x-vercel-forwarded-for": "203.0.113.7" }));

    expect(first).toBeTruthy();
    expect(first).not.toContain("203.0.113.7");
    expect(await identify(requestFrom({ "x-vercel-forwarded-for": "203.0.113.7" }))).toBe(first);
  });

  it("gives different addresses and different secrets different results", async () => {
    const request = () => requestFrom({ "x-vercel-forwarded-for": "203.0.113.7" });
    const first = await identify(request());

    expect(await identify(requestFrom({ "x-vercel-forwarded-for": "203.0.113.8" }))).not.toBe(
      first,
    );
    expect(await createVisitorIdentifier("t".repeat(32))(request())).not.toBe(first);
  });

  it("prefers Vercel's header, and uses the first address in a list", async () => {
    const expected = await identify(requestFrom({ "x-vercel-forwarded-for": "203.0.113.7" }));

    expect(
      await identify(
        requestFrom({ "x-vercel-forwarded-for": "203.0.113.7", "x-forwarded-for": "198.51.100.1" }),
      ),
    ).toBe(expected);
    expect(await identify(requestFrom({ "x-forwarded-for": "203.0.113.7, 198.51.100.1" }))).toBe(
      expected,
    );
  });

  it("returns nothing when no usable address is shown", async () => {
    expect(await identify(requestFrom({}))).toBeUndefined();
    expect(await identify(requestFrom({ "x-forwarded-for": "unknown" }))).toBeUndefined();
  });
});

describe("createResendSender", () => {
  const email = {
    from: "Portfolio <contact@example.test>",
    to: "owner-private@example.test",
    replyTo: "sam@example.test",
    subject: "Portfolio message from Sam",
    text: "Hello there, Jordan.",
  };
  const options = { idempotencyKey: "key-1", signal: new AbortController().signal };

  function senderReturning(result: unknown) {
    const send = vi.fn(async () => result);
    return { send, sender: createResendSender({ emails: { send } as never }) };
  }

  function errorResult(name: string, statusCode: number | null) {
    return { data: null, error: { name, statusCode, message: `secret detail for ${email.to}` } };
  }

  it("passes the email, the idempotency key, and the signal to the SDK", async () => {
    const { send, sender } = senderReturning({ data: { id: "email-1" }, error: null });

    await expect(sender.send(email, options)).resolves.toEqual({ status: "sent", id: "email-1" });
    expect(send).toHaveBeenCalledWith(email, options);
  });

  it.each([
    ["invalid sender domain", "validation_error", 403],
    ["daily quota", "daily_quota_exceeded", 429],
    ["monthly quota", "monthly_quota_exceeded", 429],
    ["provider rate limit", "rate_limit_exceeded", 429],
    ["key reused with another payload", "invalid_idempotent_request", 409],
  ])("reports %s as failed", async (_label, name, statusCode) => {
    const { sender } = senderReturning(errorResult(name, statusCode));
    const outcome = await sender.send(email, options);

    expect(outcome).toEqual({ status: "failed", reason: `${name} (${statusCode})` });
  });

  it.each([
    ["a server error", "application_error", 500],
    ["an unavailable service", "service_unavailable", 503],
    ["a network error or timeout", "application_error", null],
    ["a request still running", "concurrent_idempotent_requests", 409],
  ])("reports %s as unknown, not as failed", async (_label, name, statusCode) => {
    const { sender } = senderReturning(errorResult(name, statusCode));
    const outcome = await sender.send(email, options);

    expect(outcome).toEqual({ status: "unknown", reason: `${name} (${statusCode})` });
  });

  it("does not report success without an id", async () => {
    const { sender } = senderReturning({ data: {}, error: null });
    const outcome = await sender.send(email, options);

    expect(outcome.status).toBe("unknown");
  });

  it("does not pass the provider's message to the reason", async () => {
    const { sender } = senderReturning(errorResult("validation_error", 403));
    const outcome = await sender.send(email, options);

    expect(JSON.stringify(outcome)).not.toContain(email.to);
  });
});
