import { describe, expect, it, vi } from "vitest";
import {
  type ContactOptions,
  type ContactPrepared,
  type ContactSender,
  type ContactSendLimiter,
  handleContactPrepare,
  handleContactSend,
} from "./handlers";
import { CONTACT_LIMITS } from "./limits";
import type { ContactEmail } from "./message";

const NOW = Date.UTC(2026, 9, 30, 12);
const OWNER_ADDRESS = "owner-private@example.test";
const SECRET = "test-secret-that-is-long-enough-to-sign-with";

const draft = {
  name: "Sam Visitor",
  email: "sam@example.test",
  message: "Hello, I would like to talk about a role.",
};

const VISITOR = "hashed-visitor";

/** An in-memory limiter with the behaviour the interface promises. The fixed clock drives expiry. */
function fakeLimiter(nowFn: () => number) {
  const slots = new Map<string, { emailKey: string; expires: number }>();
  const limiter: ContactSendLimiter = {
    claim: vi.fn(async (visitor, emailKey) => {
      const slot = slots.get(visitor);
      if (slot && slot.expires > nowFn()) return slot.emailKey === emailKey ? "claimed" : "limited";
      slots.set(visitor, { emailKey, expires: nowFn() + CONTACT_LIMITS.sendLimitWindowMs });
      return "claimed";
    }),
    release: vi.fn(async (visitor) => {
      slots.delete(visitor);
    }),
  };
  return limiter;
}

function setup(sender: ContactSender["send"] = async () => ({ status: "sent", id: "email-1" })) {
  const send = vi.fn(sender);
  const logs: unknown[][] = [];
  const log = (...args: unknown[]) => {
    logs.push(args);
  };
  let now = NOW;
  const options: ContactOptions = {
    recipient: { name: "Jordan Example", address: OWNER_ADDRESS },
    from: "Portfolio <contact@example.test>",
    sender: { send },
    limiter: fakeLimiter(() => now),
    identifyVisitor: async () => VISITOR,
    tokenSecret: SECRET,
    now: () => now,
    logger: { info: log, error: log },
  };
  return {
    send,
    logs,
    options,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

function jsonRequest(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost/api/contact/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function prepare(options: ContactOptions, body: unknown = draft): Promise<ContactPrepared> {
  const response = await handleContactPrepare(jsonRequest("prepare", body), options);
  expect(response.status).toBe(200);
  return (await response.json()) as ContactPrepared;
}

function firstEmail(send: ReturnType<typeof setup>["send"]): ContactEmail {
  const email = send.mock.calls[0]?.[0];
  if (!email) throw new Error("the sender was not called");
  return email;
}

describe("handleContactPrepare", () => {
  it("returns what the visitor entered, without the owner's notes, and sends nothing", async () => {
    const { options, send } = setup();
    const { token, ...prepared } = await prepare(options);

    expect(prepared).toEqual({
      status: "prepared",
      recipientName: "Jordan Example",
      name: "Sam Visitor",
      replyTo: "sam@example.test",
      message: draft.message,
    });
    expect(token).toBeTruthy();
    expect(send).not.toHaveBeenCalled();
  });

  it("normalizes the text, so the review shows what will be sent", async () => {
    const { options, send } = setup();
    const prepared = await prepare(options, {
      name: "  Sam Visitor ",
      email: " sam@example.test ",
      message: "  First line\r\nSecond\u0007 line  ",
    });

    expect(prepared.name).toBe("Sam Visitor");
    expect(prepared.replyTo).toBe("sam@example.test");
    expect(prepared.message).toBe("First line\nSecond line");

    await handleContactSend(jsonRequest("send", { token: prepared.token }), options);
    expect(firstEmail(send).text).toContain(prepared.message);
  });

  it.each([
    ["an empty name", { ...draft, name: "  " }, "name"],
    ["a long name", { ...draft, name: "n".repeat(CONTACT_LIMITS.maxNameChars + 1) }, "name"],
    ["a line break in the name", { ...draft, name: "Sam\r\nBcc: x@example.test" }, "name"],
    ["an invalid email", { ...draft, email: "not-an-address" }, "email"],
    ["a line break in the email", { ...draft, email: "a@example.test\nBcc: x@e.test" }, "email"],
    ["a long email", { ...draft, email: `${"a".repeat(250)}@example.test` }, "email"],
    ["a short message", { ...draft, message: "Hi there" }, "message"],
    ["a long message", { ...draft, message: "m".repeat(2_001) }, "message"],
    ["a missing message", { name: draft.name, email: draft.email }, "message"],
  ])("rejects %s and names the field", async (_label, body, field) => {
    const { options, send } = setup();
    const response = await handleContactPrepare(jsonRequest("prepare", body), options);
    const result = (await response.json()) as { status: string; fields: Record<string, string> };

    expect(response.status).toBe(400);
    expect(result.status).toBe("invalid");
    expect(result.fields[field]).toBeTruthy();
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    ["a recipient", { ...draft, to: "someone@example.test" }],
    ["a sender", { ...draft, from: "someone@example.test" }],
    ["a subject", { ...draft, subject: "Buy now" }],
  ])("rejects a request that sets %s", async (_label, body) => {
    const { options } = setup();
    const response = await handleContactPrepare(jsonRequest("prepare", body), options);
    expect(response.status).toBe(400);
  });

  it("rejects a filled honeypot without pretending to succeed", async () => {
    const { options } = setup();
    const response = await handleContactPrepare(
      jsonRequest("prepare", { ...draft, website: "https://spam.example" }),
      options,
    );
    const result = (await response.json()) as { status: string; fields?: unknown };

    expect(response.status).toBe(400);
    expect(result.status).toBe("invalid");
    expect(result.fields).toBeUndefined();
  });

  it("accepts an empty honeypot", async () => {
    const { options } = setup();
    await prepare(options, { ...draft, website: "" });
  });

  it("rejects a cross-site browser request, a wrong content type, bad JSON, and a large body", async () => {
    const { options } = setup();
    const crossSite = jsonRequest("prepare", draft, { "sec-fetch-site": "cross-site" });
    const wrongType = jsonRequest("prepare", draft, { "content-type": "text/plain" });
    const large = jsonRequest("prepare", {
      ...draft,
      message: "m".repeat(CONTACT_LIMITS.maxBodyBytes),
    });

    expect((await handleContactPrepare(crossSite, options)).status).toBe(403);
    expect((await handleContactPrepare(wrongType, options)).status).toBe(415);
    expect((await handleContactPrepare(jsonRequest("prepare", "{nope"), options)).status).toBe(400);
    expect((await handleContactPrepare(large, options)).status).toBe(413);
  });

  it("issues a token for the longest message that fits the body limit of send", async () => {
    const { options } = setup();
    // Three bytes per character in UTF-8, and quotes and line feeds double in JSON.
    const message = "語".repeat(CONTACT_LIMITS.maxMessageChars);
    const prepared = await prepare(options, { ...draft, name: "語".repeat(100), message });

    const response = await handleContactSend(
      jsonRequest("send", { token: prepared.token }),
      options,
    );
    expect(response.status).toBe(200);
  });
});

describe("handleContactSend", () => {
  it("sends what was prepared, with the owner's notes, to the configured recipient", async () => {
    const { options, send } = setup();
    const prepared = await prepare(options);

    const response = await handleContactSend(
      jsonRequest("send", { token: prepared.token }),
      options,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "sent" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(firstEmail(send)).toEqual({
      from: "Portfolio <contact@example.test>",
      to: OWNER_ADDRESS,
      replyTo: "sam@example.test",
      subject: "Portfolio message from Sam Visitor",
      text: expect.stringContaining(prepared.message),
    });
    expect(firstEmail(send).text).toContain(`${prepared.name} wrote to you`);
    expect(firstEmail(send).text).toContain(`Replies go to: ${prepared.replyTo}`);
    expect(firstEmail(send).text).toContain("not verified");
  });

  it("passes a timeout signal to the sender", async () => {
    const { options, send } = setup();
    const { token } = await prepare(options);
    await handleContactSend(jsonRequest("send", { token }), options);

    const sendOptions = send.mock.calls[0]?.[1];
    expect(sendOptions?.signal).toBeInstanceOf(AbortSignal);
    expect(sendOptions?.signal.aborted).toBe(false);
  });

  it.each([
    ["a recipient", { to: "someone@example.test" }],
    ["changed text", { text: "Something else" }],
  ])("rejects a request that adds %s to the token", async (_label, extra) => {
    const { options, send } = setup();
    const { token } = await prepare(options);
    const response = await handleContactSend(jsonRequest("send", { token, ...extra }), options);

    expect(response.status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects a send that did not go through prepare", async () => {
    const { options, send } = setup();
    const missing = await handleContactSend(jsonRequest("send", draft), options);
    const confirmed = await handleContactSend(
      jsonRequest("send", { ...draft, confirmed: true }),
      options,
    );

    expect(missing.status).toBe(400);
    expect(confirmed.status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects a token with altered content or signature", async () => {
    const { options, send } = setup();
    const { token } = await prepare(options);
    const [payload = "", signature = ""] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({
        v: 1,
        exp: NOW + 1_000,
        draft: { ...draft, message: "A different message entirely." },
      }),
    ).toString("base64url");

    for (const altered of [
      `${forged}.${signature}`,
      `${payload}.${Buffer.from("wrong").toString("base64url")}`,
      `${payload}.`,
      payload,
      `${token}.extra`,
      "!!!.!!!",
    ]) {
      const response = await handleContactSend(jsonRequest("send", { token: altered }), options);
      expect(response.status).toBe(400);
    }
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects a token signed with another secret", async () => {
    const { options, send } = setup();
    const { token } = await prepare({ ...options, tokenSecret: `${SECRET}-other` });
    const response = await handleContactSend(jsonRequest("send", { token }), options);

    expect(response.status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects an expired token and accepts one just before expiry", async () => {
    const { options, send, advance } = setup();
    const { token } = await prepare(options);

    advance(CONTACT_LIMITS.tokenLifetimeMs - 1);
    const inTime = await handleContactSend(jsonRequest("send", { token }), options);
    expect(inTime.status).toBe(200);

    advance(1);
    const late = await handleContactSend(jsonRequest("send", { token }), options);
    expect(late.status).toBe(410);
    expect(await late.json()).toMatchObject({ status: "expired" });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("gives a replay and the same text prepared again the same idempotency key", async () => {
    const { options, send, advance } = setup();
    const first = await prepare(options);
    await handleContactSend(jsonRequest("send", { token: first.token }), options);
    await handleContactSend(jsonRequest("send", { token: first.token }), options);
    advance(60_000);
    const again = await prepare(options);
    expect(again.token).not.toBe(first.token);
    await handleContactSend(jsonRequest("send", { token: again.token }), options);

    const keys = send.mock.calls.map((call) => call[1].idempotencyKey);
    expect(keys).toHaveLength(3);
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]?.length).toBeLessThanOrEqual(256);
  });

  it("gives different content or a different recipient a different idempotency key", async () => {
    const { options: limited, send } = setup();
    const options: ContactOptions = {
      ...limited,
      limiter: { claim: async () => "claimed", release: async () => {} },
    };
    const first = await prepare(options);
    const other = await prepare(options, { ...draft, message: "A different message entirely." });
    await handleContactSend(jsonRequest("send", { token: first.token }), options);
    await handleContactSend(jsonRequest("send", { token: other.token }), options);
    await handleContactSend(jsonRequest("send", { token: first.token }), {
      ...options,
      recipient: { name: "Jordan Example", address: "new-address@example.test" },
    });

    const keys = send.mock.calls.map((call) => call[1].idempotencyKey);
    expect(new Set(keys).size).toBe(3);
  });

  it.each([
    ["a refusal", 502, "failed", async () => ({ status: "failed", reason: "quota" }) as const],
    ["no clear answer", 504, "unknown", async () => ({ status: "unknown", reason: "x" }) as const],
    [
      "a sender that throws",
      504,
      "unknown",
      async () => {
        throw new Error(`could not reach ${OWNER_ADDRESS}`);
      },
    ],
  ] satisfies [string, number, string, ContactSender["send"]][])(
    "does not report success after %s",
    async (_label, httpStatus, status, sender) => {
      const { options } = setup(sender);
      const { token } = await prepare(options);
      const response = await handleContactSend(jsonRequest("send", { token }), options);
      const body = (await response.json()) as { status: string; message: string };

      expect(response.status).toBe(httpStatus);
      expect(body.status).toBe(status);
      expect(body.message).toMatch(/not sent|could not confirm/);
    },
  );
});

describe("the daily limit", () => {
  const other = { ...draft, message: "A different message entirely." };

  async function sendDraft(options: ContactOptions, body: unknown = draft): Promise<Response> {
    const { token } = await prepare(options, body);
    return handleContactSend(jsonRequest("send", { token }), options);
  }

  it("blocks a second, different email from one visitor without calling the sender", async () => {
    const { options, send } = setup();
    expect((await sendDraft(options)).status).toBe(200);

    const blocked = await sendDraft(options, other);

    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toMatchObject({
      status: "limited",
      message: expect.stringContaining("not sent"),
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("allows the visitor again after the window", async () => {
    const { options, send, advance } = setup();
    await sendDraft(options);

    advance(CONTACT_LIMITS.sendLimitWindowMs - 1);
    expect((await sendDraft(options, other)).status).toBe(429);
    advance(1);
    expect((await sendDraft(options, other)).status).toBe(200);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("does not affect a different visitor", async () => {
    const { options, send } = setup();
    await sendDraft(options);

    const response = await sendDraft(
      { ...options, identifyVisitor: async () => "another-visitor" },
      other,
    );

    expect(response.status).toBe(200);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("sends only one of two different emails sent at the same time", async () => {
    const { options, send } = setup();
    const [first, second] = await Promise.all([prepare(options), prepare(options, other)]);

    const responses = await Promise.all(
      [first, second].map(({ token }) =>
        handleContactSend(jsonRequest("send", { token }), options),
      ),
    );

    expect(responses.map(({ status }) => status).sort()).toEqual([200, 429]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("gives the slot back after a refusal, so another email can be sent", async () => {
    let refuse = true;
    const { options, send } = setup(async () =>
      refuse ? { status: "failed", reason: "refused" } : { status: "sent", id: "email-1" },
    );
    expect((await sendDraft(options)).status).toBe(502);
    expect(options.limiter.release).toHaveBeenCalledWith(VISITOR);

    refuse = false;
    expect((await sendDraft(options, other)).status).toBe(200);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["a sent email", 200, async () => ({ status: "sent", id: "email-1" }) as const],
    ["an unknown outcome", 504, async () => ({ status: "unknown", reason: "x" }) as const],
    [
      "a sender that throws",
      504,
      async () => {
        throw new Error("no answer");
      },
    ],
  ] satisfies [string, number, ContactSender["send"]][])(
    "keeps the slot after %s, because an email may have gone out",
    async (_label, httpStatus, sender) => {
      const { options } = setup(sender);
      expect((await sendDraft(options)).status).toBe(httpStatus);

      expect(options.limiter.release).not.toHaveBeenCalled();
      expect((await sendDraft(options, other)).status).toBe(429);
    },
  );

  it("lets a retry of the same email through, with the same key", async () => {
    const { options, send } = setup(async () => ({ status: "unknown", reason: "x" }));
    await sendDraft(options);
    await sendDraft(options);

    const keys = send.mock.calls.map((call) => call[1].idempotencyKey);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it("still reports not sent when giving the slot back fails", async () => {
    const { options, logs } = setup(async () => ({ status: "failed", reason: "refused" }));
    const response = await sendDraft({
      ...options,
      limiter: {
        claim: options.limiter.claim,
        release: async () => {
          throw new Error("store down");
        },
      },
    });

    expect(response.status).toBe(502);
    expect(JSON.stringify(logs)).toContain("limit not released");
    expect(JSON.stringify(logs)).not.toContain("store down");
  });

  it.each<[string, Partial<ContactOptions>]>([
    [
      "the limiter fails",
      {
        limiter: {
          claim: async () => {
            throw new Error("store down");
          },
          release: async () => {},
        },
      },
    ],
    ["the visitor cannot be identified", { identifyVisitor: async () => undefined }],
    [
      "identifying the visitor fails",
      {
        identifyVisitor: async () => {
          throw new Error("bad header");
        },
      },
    ],
  ])("sends nothing when %s", async (_label, override) => {
    const { options, send, logs } = setup();
    const response = await sendDraft({ ...options, ...override });

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      status: "failed",
      message: expect.stringContaining("not sent"),
    });
    expect(send).not.toHaveBeenCalled();
    expect(JSON.stringify(logs)).not.toMatch(/store down|bad header/);
  });

  it("sends nothing when the limiter takes too long", async () => {
    const { options, send } = setup();
    const { token } = await prepare(options);
    // Only the timers: the handler's crypto needs real time to finish before the limiter is reached.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      let startClaim = () => {};
      const claimStarted = new Promise<void>((resolve) => {
        startClaim = resolve;
      });
      const pending = handleContactSend(jsonRequest("send", { token }), {
        ...options,
        limiter: {
          claim: () => {
            startClaim();
            return new Promise(() => {});
          },
          release: async () => {},
        },
      });
      await claimStarted;
      await vi.advanceTimersByTimeAsync(CONTACT_LIMITS.limiterTimeoutMs);

      expect((await pending).status).toBe(503);
      expect(send).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("never reaches the limiter with an invalid or expired token", async () => {
    const { options, advance } = setup();
    const { token } = await prepare(options);

    await handleContactSend(jsonRequest("send", { token: `${token}x` }), options);
    advance(CONTACT_LIMITS.tokenLifetimeMs);
    await handleContactSend(jsonRequest("send", { token }), options);

    expect(options.limiter.claim).not.toHaveBeenCalled();
  });

  it("does not put the visitor key in a response or a log", async () => {
    const { options, logs } = setup();
    const sent = await sendDraft(options);
    const blocked = await sendDraft(options, other);

    for (const text of [await sent.text(), await blocked.text(), JSON.stringify(logs)]) {
      expect(text).not.toContain(VISITOR);
    }
  });
});

describe("what leaves the server", () => {
  it("never puts the address, the secret, or visitor text where it should not be", async () => {
    const { options, logs } = setup(async () => {
      throw new Error(`failed for ${OWNER_ADDRESS}`);
    });

    const prepared = await handleContactPrepare(jsonRequest("prepare", draft), options);
    const preparedText = await prepared.text();
    const { token } = JSON.parse(preparedText) as ContactPrepared;
    const decodedToken = Buffer.from(token.split(".")[0] ?? "", "base64url").toString();
    const sent = await handleContactSend(jsonRequest("send", { token }), options);
    const sentText = await sent.text();
    const logged = JSON.stringify(logs);

    for (const text of [preparedText, decodedToken, sentText, logged]) {
      expect(text).not.toContain(OWNER_ADDRESS);
      expect(text).not.toContain(SECRET);
    }
    expect(logged).not.toContain(draft.email);
    expect(logged).not.toContain(draft.message);
    expect(logged).not.toContain(draft.name);
  });
});
