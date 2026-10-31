import { describe, expect, it, vi } from "vitest";
import {
  type ContactFetch,
  type ContactFlow,
  type ContactPreview,
  canSend,
  confirmContact,
  contactFlowReducer,
  initialContactFlow,
  prepareContact,
  reviewStatus,
} from "./contact-flow";

const draft = { name: "Sam", email: "sam@example.test", message: "Hello there, Jordan." };
const preview: ContactPreview = {
  recipientName: "Jordan Example",
  name: "Sam",
  replyTo: "sam@example.test",
  message: "Hello there, Jordan.",
  token: "payload.signature",
};

function composing(): ContactFlow {
  return { step: "compose", draft, fields: {}, preparing: false };
}

function reviewing(): ContactFlow {
  return { step: "review", draft, preview, sending: false };
}

function respondingWith(status: number, body: unknown): ContactFetch {
  return vi.fn(async () => Response.json(body, { status }));
}

describe("contactFlowReducer", () => {
  it("moves from compose through review to sent", () => {
    let flow = initialContactFlow();
    flow = contactFlowReducer(flow, { type: "edit", field: "name", value: "Sam" });
    flow = contactFlowReducer(flow, { type: "prepare-start" });
    expect(flow).toMatchObject({ step: "compose", preparing: true });

    flow = contactFlowReducer(flow, {
      type: "prepare-finished",
      result: { status: "prepared", preview },
    });
    expect(flow).toMatchObject({ step: "review", sending: false });

    flow = contactFlowReducer(flow, { type: "send-start" });
    flow = contactFlowReducer(flow, { type: "send-finished", result: { status: "sent" } });
    expect(flow).toEqual({
      step: "sent",
      recipientName: "Jordan Example",
      replyTo: "sam@example.test",
    });
  });

  it("cannot send from the compose step", () => {
    const flow = composing();
    expect(canSend(flow)).toBe(false);
    expect(contactFlowReducer(flow, { type: "send-start" })).toBe(flow);
  });

  it("blocks a second send and going back while one is running", () => {
    const sending = contactFlowReducer(reviewing(), { type: "send-start" });

    expect(canSend(sending)).toBe(false);
    expect(contactFlowReducer(sending, { type: "send-start" })).toBe(sending);
    expect(contactFlowReducer(sending, { type: "back" })).toBe(sending);
  });

  it("does not start a second prepare while one is running", () => {
    const preparing = contactFlowReducer(composing(), { type: "prepare-start" });
    expect(contactFlowReducer(preparing, { type: "prepare-start" })).toBe(preparing);
  });

  it("shows field errors and clears one when that field is edited", () => {
    let flow = contactFlowReducer(composing(), { type: "prepare-start" });
    flow = contactFlowReducer(flow, {
      type: "prepare-finished",
      result: {
        status: "rejected",
        message: "Please check the highlighted fields.",
        fields: { email: "Enter a valid email address.", name: "Enter your name." },
      },
    });
    expect(flow).toMatchObject({ step: "compose", preparing: false, draft });

    flow = contactFlowReducer(flow, { type: "edit", field: "email", value: "a@example.test" });
    expect(flow).toMatchObject({ fields: { name: "Enter your name." } });
    expect(flow.step === "compose" && flow.fields.email).toBeUndefined();
  });

  it.each(["failed", "unknown"] as const)(
    "stays on the review with the draft after %s, and allows a retry",
    (status) => {
      const flow = contactFlowReducer(contactFlowReducer(reviewing(), { type: "send-start" }), {
        type: "send-finished",
        result: { status, message: "Message" },
      });

      expect(flow).toEqual({
        step: "review",
        draft,
        preview,
        sending: false,
        notice: { kind: status, message: "Message" },
      });
      expect(canSend(flow)).toBe(true);
    },
  );

  it("keeps the draft after the daily limit, allows editing, and does not offer a retry", () => {
    const flow = contactFlowReducer(contactFlowReducer(reviewing(), { type: "send-start" }), {
      type: "send-finished",
      result: { status: "limited", message: "Message" },
    });

    expect(flow).toMatchObject({ step: "review", draft, notice: { kind: "limited" } });
    expect(canSend(flow)).toBe(false);
    expect(contactFlowReducer(flow, { type: "send-start" })).toBe(flow);
    expect(contactFlowReducer(flow, { type: "back" })).toMatchObject({ step: "compose", draft });
  });

  it("clears the previous notice when a retry starts", () => {
    const failed = contactFlowReducer(contactFlowReducer(reviewing(), { type: "send-start" }), {
      type: "send-finished",
      result: { status: "failed", message: "Message" },
    });
    const retrying = contactFlowReducer(failed, { type: "send-start" });

    expect(retrying.step === "review" && retrying.notice).toBeUndefined();
  });

  it("returns to compose with the draft when the review expired", () => {
    const flow = contactFlowReducer(contactFlowReducer(reviewing(), { type: "send-start" }), {
      type: "send-finished",
      result: { status: "expired", message: "Expired" },
    });

    expect(flow).toEqual({
      step: "compose",
      draft,
      fields: {},
      message: "Expired",
      preparing: false,
    });
  });

  it("keeps the draft when going back, and clears it only on reset", () => {
    const back = contactFlowReducer(reviewing(), { type: "back" });
    expect(back).toMatchObject({ step: "compose", draft });
    expect(contactFlowReducer(back, { type: "reset" })).toEqual(initialContactFlow());
  });
});

describe("reviewStatus", () => {
  const review = { step: "review", draft, preview, sending: false } as const;

  it("says nothing has been sent only before the first attempt", () => {
    expect(reviewStatus(review)).toBe("Nothing has been sent yet.");
  });

  it.each([
    ["during a send", { ...review, sending: true }],
    ["after a refusal", { ...review, notice: { kind: "failed", message: "M" } }],
    ["after an unknown outcome", { ...review, notice: { kind: "unknown", message: "M" } }],
  ] as const)("does not say so %s", (_label, flow) => {
    expect(reviewStatus(flow)).not.toContain("Nothing has been sent");
  });
});

describe("prepareContact", () => {
  it("posts the draft and the honeypot, and returns the server's preview", async () => {
    const fetchFn = respondingWith(200, { status: "prepared", ...preview });
    const result = await prepareContact(draft, "", fetchFn);

    expect(result).toEqual({ status: "prepared", preview });
    expect(fetchFn).toHaveBeenCalledWith(
      "/api/contact/prepare",
      expect.objectContaining({ body: JSON.stringify({ ...draft, website: "" }) }),
    );
  });

  it("returns the server's field errors", async () => {
    const fields = { email: "Enter a valid email address." };
    const fetchFn = respondingWith(400, { status: "invalid", message: "Check it.", fields });

    await expect(prepareContact(draft, "", fetchFn)).resolves.toEqual({
      status: "rejected",
      message: "Check it.",
      fields,
    });
  });

  it("says the request limit was reached after a host's 429, with or without JSON", async () => {
    const html: ContactFetch = async () => new Response("<html>", { status: 429 });

    for (const fetchFn of [html, respondingWith(429, { error: "rate_limited" })]) {
      const result = await prepareContact(draft, "", fetchFn);
      expect(result).toMatchObject({ status: "rejected", fields: {} });
      expect(result.status === "rejected" && result.message).toContain("request limit");
    }
  });

  it("says nothing was sent when the server cannot be reached or answers nonsense", async () => {
    const offline: ContactFetch = async () => {
      throw new TypeError("network");
    };
    const notJson: ContactFetch = async () => new Response("<html>", { status: 500 });

    for (const fetchFn of [offline, notJson, respondingWith(500, { nope: true })]) {
      const result = await prepareContact(draft, "", fetchFn);
      expect(result.status).toBe("rejected");
      expect(result.status === "rejected" && result.message).toContain("Nothing was sent");
    }
  });
});

describe("confirmContact", () => {
  it("posts only the token", async () => {
    const fetchFn = respondingWith(200, { status: "sent" });

    await expect(confirmContact("the-token", fetchFn)).resolves.toEqual({ status: "sent" });
    expect(fetchFn).toHaveBeenCalledWith(
      "/api/contact/send",
      expect.objectContaining({ body: JSON.stringify({ token: "the-token" }) }),
    );
  });

  it.each([
    ["failed", 502],
    ["unknown", 504],
    ["expired", 410],
    ["limited", 429],
  ] as const)("passes on a %s answer", async (status, httpStatus) => {
    const result = await confirmContact("t", respondingWith(httpStatus, { status, message: "M" }));
    expect(result).toEqual({ status, message: "M" });
  });

  it("treats a rejected token as not sent", async () => {
    const result = await confirmContact(
      "t",
      respondingWith(400, { status: "invalid", message: "M" }),
    );
    expect(result).toEqual({ status: "failed", message: "M" });
  });

  it("reports a host's 429 as the request limit, not an unknown outcome", async () => {
    const html: ContactFetch = async () => new Response("<html>", { status: 429 });

    for (const fetchFn of [html, respondingWith(429, { error: "rate_limited" })]) {
      const result = await confirmContact("t", fetchFn);
      expect(result).toMatchObject({ status: "failed" });
      expect(result.status === "failed" && result.message).toContain("request limit");
    }
  });

  it.each<[string, ContactFetch]>([
    [
      "a network failure",
      async () => {
        throw new TypeError("network");
      },
    ],
    ["a body that is not JSON", async () => new Response("<html>", { status: 200 })],
    ["an unreadable error", async () => new Response("<html>", { status: 500 })],
    ["success with another status", respondingWith(200, { status: "queued" })],
    ["'sent' on an error status", respondingWith(500, { status: "sent" })],
    ["an error shape on a success status", respondingWith(200, { status: "failed", message: "M" })],
  ])("never reports sent or failed after %s", async (_label, fetchFn) => {
    const result = await confirmContact("t", fetchFn);
    expect(result.status).toBe("unknown");
  });
});
