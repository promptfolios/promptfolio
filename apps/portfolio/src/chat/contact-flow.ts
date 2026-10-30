import type { ContactDraft, ContactField, ContactFieldErrors } from "@promptfolio/contact";
import { z } from "zod";

/**
 * The contact dialog's states, as a pure reducer. Sending is reachable only from the review
 * step, the draft survives every failure, and only a server answer of `sent` reaches `sent`.
 */

/** What the server returned for review. */
export interface ContactPreview {
  recipientName: string;
  name: string;
  replyTo: string;
  message: string;
  token: string;
}

export interface ContactNotice {
  /**
   * `failed`: not sent. `unknown`: it may have been sent, and a retry is safe. `limited`: not sent,
   * and a retry cannot help until the visitor's day is over.
   */
  kind: "failed" | "unknown" | "limited";
  message: string;
}

export type ContactFlow =
  | {
      step: "compose";
      draft: ContactDraft;
      fields: ContactFieldErrors;
      message?: string;
      preparing: boolean;
    }
  | {
      step: "review";
      draft: ContactDraft;
      preview: ContactPreview;
      sending: boolean;
      notice?: ContactNotice;
    }
  | { step: "sent"; recipientName: string; replyTo: string };

export type PrepareResult =
  | { status: "prepared"; preview: ContactPreview }
  | { status: "rejected"; message: string; fields: ContactFieldErrors };

export type SendResult =
  | { status: "sent" }
  | { status: "expired"; message: string }
  | { status: "failed"; message: string }
  | { status: "unknown"; message: string }
  | { status: "limited"; message: string };

export type ContactEvent =
  | { type: "edit"; field: ContactField; value: string }
  | { type: "prepare-start" }
  | { type: "prepare-finished"; result: PrepareResult }
  | { type: "back" }
  | { type: "send-start" }
  | { type: "send-finished"; result: SendResult }
  | { type: "reset" };

export function initialContactFlow(): ContactFlow {
  return {
    step: "compose",
    draft: { name: "", email: "", message: "" },
    fields: {},
    preparing: false,
  };
}

export function contactFlowReducer(flow: ContactFlow, event: ContactEvent): ContactFlow {
  switch (event.type) {
    case "edit": {
      if (flow.step !== "compose") return flow;
      const { [event.field]: _cleared, ...fields } = flow.fields;
      return { ...flow, draft: { ...flow.draft, [event.field]: event.value }, fields };
    }
    case "prepare-start":
      if (flow.step !== "compose" || flow.preparing) return flow;
      return { ...flow, preparing: true, fields: {}, message: undefined };
    case "prepare-finished":
      if (flow.step !== "compose") return flow;
      if (event.result.status === "prepared") {
        return { step: "review", draft: flow.draft, preview: event.result.preview, sending: false };
      }
      return {
        ...flow,
        preparing: false,
        fields: event.result.fields,
        message: event.result.message,
      };
    case "back":
      if (flow.step !== "review" || flow.sending) return flow;
      return { step: "compose", draft: flow.draft, fields: {}, preparing: false };
    case "send-start":
      if (!canSend(flow)) return flow;
      return { ...flow, sending: true, notice: undefined };
    case "send-finished":
      if (flow.step !== "review") return flow;
      switch (event.result.status) {
        case "sent":
          return {
            step: "sent",
            recipientName: flow.preview.recipientName,
            replyTo: flow.preview.replyTo,
          };
        case "expired":
          // Prepared again, the same text gets the same key, so this is safe after `unknown` too.
          return {
            step: "compose",
            draft: flow.draft,
            fields: {},
            message: event.result.message,
            preparing: false,
          };
        default:
          return {
            ...flow,
            sending: false,
            notice: { kind: event.result.status, message: event.result.message },
          };
      }
    case "reset":
      return initialContactFlow();
  }
}

/**
 * The line under the review's title. "Nothing has been sent" holds only before the first attempt:
 * during a send, or after an `unknown` outcome, it could be untrue.
 */
export function reviewStatus(flow: Extract<ContactFlow, { step: "review" }>): string {
  if (flow.sending) return "Sending your message…";
  if (flow.notice) return "Your message is shown below.";
  return "Nothing has been sent yet.";
}

/** A second send cannot start while one is running, or after the daily limit has answered. */
export function canSend(flow: ContactFlow): flow is Extract<ContactFlow, { step: "review" }> {
  return flow.step === "review" && !flow.sending && flow.notice?.kind !== "limited";
}

const NOT_REACHED = "The message could not be checked. Nothing was sent. Please try again.";
const REQUEST_LIMIT_PREPARE =
  "You've reached the request limit for this form. Please wait a few minutes and try again. Your message is still here.";
const REQUEST_LIMIT_SEND =
  "You've reached the request limit for this form, so this attempt didn't go through. Please wait a few minutes and try again.";
const NOT_CONFIRMED =
  "We could not confirm whether your message was sent. Trying again is safe: the same message is not sent twice.";

const preparedSchema = z.object({
  status: z.literal("prepared"),
  recipientName: z.string(),
  name: z.string(),
  replyTo: z.string(),
  message: z.string(),
  token: z.string(),
});

const rejectedSchema = z.object({
  status: z.string(),
  message: z.string(),
  fields: z
    .object({
      name: z.string().optional(),
      email: z.string().optional(),
      message: z.string().optional(),
    })
    .optional(),
});

const sentSchema = z.object({ status: z.literal("sent") });
const sendErrorSchema = z.object({
  status: z.enum(["expired", "failed", "invalid", "unknown", "limited"]),
  message: z.string(),
});

/** The `fetch` to use, so tests can pass a fake. */
export type ContactFetch = (url: string, init: RequestInit) => Promise<Response>;

async function postJson(fetchFn: ContactFetch, url: string, body: unknown) {
  const response = await fetchFn(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  // A host's rate limit answers without reaching the app, and not always with JSON.
  const parsed: unknown = await response.json().catch(() => undefined);
  return { ok: response.ok, status: response.status, body: parsed };
}

/** Asks the server to validate a draft. `website` is the form's hidden honeypot field. */
export async function prepareContact(
  draft: ContactDraft,
  website: string,
  fetchFn: ContactFetch = fetch,
): Promise<PrepareResult> {
  try {
    const { ok, status, body } = await postJson(fetchFn, "/api/contact/prepare", {
      ...draft,
      website,
    });
    const prepared = preparedSchema.safeParse(body);
    if (ok && prepared.success) {
      const { status: _status, ...preview } = prepared.data;
      return { status: "prepared", preview };
    }
    const rejected = rejectedSchema.safeParse(body);
    if (rejected.success) {
      return {
        status: "rejected",
        message: rejected.data.message,
        fields: rejected.data.fields ?? {},
      };
    }
    if (status === 429) return { status: "rejected", message: REQUEST_LIMIT_PREPARE, fields: {} };
  } catch {
    // A network failure or a body that is not JSON: reported below.
  }
  return { status: "rejected", message: NOT_REACHED, fields: {} };
}

/**
 * Sends a confirmed message. Reports `sent` only for a successful answer that says so. No answer,
 * or one this code cannot read, says nothing about the email, so it is `unknown`, never a failure
 * or a success. The exception is an unreadable 429: that is a host's rate limit, which stopped this
 * request before it reached the app.
 */
export async function confirmContact(
  token: string,
  fetchFn: ContactFetch = fetch,
): Promise<SendResult> {
  try {
    const {
      ok,
      status: httpStatus,
      body,
    } = await postJson(fetchFn, "/api/contact/send", { token });
    if (ok && sentSchema.safeParse(body).success) return { status: "sent" };

    const error = sendErrorSchema.safeParse(body);
    if (!ok && error.success) {
      const { status, message } = error.data;
      // A rejected token never reached the provider, so nothing was sent.
      return { status: status === "invalid" ? "failed" : status, message };
    }
    if (httpStatus === 429) return { status: "failed", message: REQUEST_LIMIT_SEND };
  } catch {
    // A network failure or a body that is not JSON: reported below.
  }
  return { status: "unknown", message: NOT_CONFIRMED };
}
