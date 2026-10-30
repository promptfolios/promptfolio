import { CONTACT_LIMITS } from "./limits";
import { buildContactContent, type ContactEmail, contactIdempotencyKey } from "./message";
import { type ContactFieldErrors, parseDraftRequest, parseSendRequest } from "./request";
import { signContactToken, verifyContactToken } from "./token";

/**
 * What came back from the email provider:
 *
 * - `sent`: the provider confirmed it accepted the email. This is the only success.
 * - `failed`: the provider refused it, so it was not sent.
 * - `unknown`: no clear answer (timeout, network error, server error). It may have been sent.
 *
 * `reason` is for the server log and is never shown to visitors.
 */
export type ContactSendOutcome =
  | { status: "sent"; id: string }
  | { status: "failed"; reason: string }
  | { status: "unknown"; reason: string };

export interface ContactSendOptions {
  /** Identical for identical emails; the sender passes it to the provider if it can. */
  idempotencyKey: string;
  /** Fires after `CONTACT_LIMITS.sendTimeoutMs`. */
  signal: AbortSignal;
}

/** The email provider. The application implements it, so this package names no provider. */
export interface ContactSender {
  send(email: ContactEmail, options: ContactSendOptions): Promise<ContactSendOutcome>;
}

/**
 * Keeps a visitor to one email per `CONTACT_LIMITS.sendLimitWindowMs`. The application implements
 * it, because it needs state shared between requests, so this package names no store.
 */
export interface ContactSendLimiter {
  /**
   * Atomically takes the visitor's slot for this email, so two requests at once cannot both take
   * it. Also `claimed` when the slot already holds the same `emailKey`, because a retry cannot
   * send a second email. Rejects if the store cannot answer.
   */
  claim(visitor: string, emailKey: string): Promise<"claimed" | "limited">;
  /** Gives the slot back after a refusal, when nothing was sent. */
  release(visitor: string): Promise<void>;
}

/** Where the handlers report outcomes. Defaults to `console`. */
export type ContactLogger = Pick<Console, "info" | "error">;

/** Everything comes from the application; nothing in a request can change these. */
export interface ContactOptions {
  /** `address` is private: it goes to the sender only, never into a response or a token. */
  recipient: { name: string; address: string };
  from: string;
  sender: ContactSender;
  limiter: ContactSendLimiter;
  /**
   * The key the limiter counts by, or `undefined` if the request does not show who sent it. What
   * identifies a visitor depends on the host, so the application decides. Return something that is
   * safe to store and never logged, such as a keyed hash of the IP address.
   */
  identifyVisitor: (request: Request) => Promise<string | undefined>;
  /** Signs confirmation tokens. */
  tokenSecret: string;
  /** Current time in milliseconds. Defaults to `Date.now`. */
  now?: () => number;
  logger?: ContactLogger;
}

/**
 * The answer to a valid `prepare`: what the visitor entered, as `send` would use it, for them to
 * review. The subject and the notes around the message are written for the owner, so they stay on
 * the server.
 */
export interface ContactPrepared {
  status: "prepared";
  recipientName: string;
  name: string;
  replyTo: string;
  message: string;
  token: string;
}

export type ContactErrorStatus = "invalid" | "expired" | "failed" | "unknown" | "limited";

export interface ContactErrorResponse {
  status: ContactErrorStatus;
  message: string;
  fields?: ContactFieldErrors;
}

/** The answer to `send` when the provider confirmed the email. */
export interface ContactSent {
  status: "sent";
}

/**
 * Validates a draft and returns it, normalized, with a signed token. Sends nothing, stores nothing,
 * and calls no model. Framework-agnostic: takes a web `Request`, returns a `Response`.
 */
export async function handleContactPrepare(
  request: Request,
  options: ContactOptions,
): Promise<Response> {
  const { recipient, tokenSecret, now = Date.now, logger = console } = options;
  const requestId = crypto.randomUUID().slice(0, 8);

  const parsed = await parseDraftRequest(request);
  if (!parsed.ok) {
    logger.info(`[contact ${requestId}] prepare rejected`, { status: parsed.status });
    return errorResponse(parsed.status, {
      status: "invalid",
      message: parsed.message,
      ...(parsed.fields ? { fields: parsed.fields } : {}),
    });
  }

  const draft = parsed.value;
  const body: ContactPrepared = {
    status: "prepared",
    recipientName: recipient.name,
    name: draft.name,
    replyTo: draft.email,
    message: draft.message,
    token: await signContactToken(draft, now() + CONTACT_LIMITS.tokenLifetimeMs, tokenSecret),
  };
  logger.info(`[contact ${requestId}] prepared`);
  return jsonResponse(200, body);
}

/**
 * Sends the email inside a confirmation token. The request carries nothing else, so what is
 * sent is what was reviewed, and only to the configured recipient. A visitor gets one email per
 * window: if the limiter cannot say the slot is theirs, nothing is sent. Responds with success
 * only when the provider confirmed. The send is awaited, because a serverless host may pause work
 * that is still running after the response.
 */
export async function handleContactSend(
  request: Request,
  options: ContactOptions,
): Promise<Response> {
  const {
    recipient,
    from,
    sender,
    limiter,
    identifyVisitor,
    tokenSecret,
    now = Date.now,
    logger = console,
  } = options;
  const requestId = crypto.randomUUID().slice(0, 8);

  const parsed = await parseSendRequest(request);
  if (!parsed.ok) {
    logger.info(`[contact ${requestId}] send rejected`, { status: parsed.status });
    return errorResponse(parsed.status, { status: "invalid", message: parsed.message });
  }

  const verified = await verifyContactToken(parsed.value, now(), tokenSecret);
  if (!verified.ok) {
    logger.info(`[contact ${requestId}] send rejected`, { reason: verified.reason });
    return verified.reason === "expired"
      ? errorResponse(410, {
          status: "expired",
          message: "This review has expired. Please review your message again.",
        })
      : errorResponse(400, { status: "invalid", message: "This confirmation is not valid." });
  }

  const { draft } = verified;
  const email: ContactEmail = {
    from,
    to: recipient.address,
    replyTo: draft.email,
    ...buildContactContent(draft),
  };
  const idempotencyKey = await contactIdempotencyKey(email);

  let visitor: string | undefined;
  let claim: "claimed" | "limited";
  try {
    visitor = await withinLimiterTimeout(identifyVisitor(request));
    if (visitor === undefined) throw new Error("no visitor");
    claim = await withinLimiterTimeout(limiter.claim(visitor, idempotencyKey));
  } catch {
    // The error itself is not logged: it could repeat the visitor's address or a store credential.
    logger.error(`[contact ${requestId}] limit unavailable`);
    return errorResponse(503, {
      status: "failed",
      message: `Your message was not sent. Please try again later. (ref ${requestId})`,
    });
  }
  if (claim === "limited") {
    logger.info(`[contact ${requestId}] limited`);
    return errorResponse(429, {
      status: "limited",
      message:
        "You've reached the limit of one message every 24 hours, so this message was not sent. Please try again tomorrow.",
    });
  }

  const outcome = await deliver(sender, email, idempotencyKey, requestId, logger);

  switch (outcome.status) {
    case "sent":
      logger.info(`[contact ${requestId}] sent`, { id: outcome.id });
      return jsonResponse(200, { status: "sent" } satisfies ContactSent);
    case "failed":
      logger.error(`[contact ${requestId}] not sent`, { reason: outcome.reason });
      // Nothing went out, so this attempt does not use up the visitor's day.
      try {
        await withinLimiterTimeout(limiter.release(visitor));
      } catch {
        logger.error(`[contact ${requestId}] limit not released`);
      }
      return errorResponse(502, {
        status: "failed",
        message: `Your message was not sent. Please try again later. (ref ${requestId})`,
      });
    case "unknown":
      logger.error(`[contact ${requestId}] outcome unknown`, { reason: outcome.reason });
      return errorResponse(504, {
        status: "unknown",
        message: `We could not confirm whether your message was sent. Trying again is safe: the same message is not sent twice. (ref ${requestId})`,
      });
  }
}

/** A sender that throws gives no answer about the email, so its outcome is unknown. */
async function deliver(
  sender: ContactSender,
  email: ContactEmail,
  idempotencyKey: string,
  requestId: string,
  logger: ContactLogger,
): Promise<ContactSendOutcome> {
  try {
    return await sender.send(email, {
      idempotencyKey,
      signal: AbortSignal.timeout(CONTACT_LIMITS.sendTimeoutMs),
    });
  } catch {
    // The error itself is not logged: it could repeat the email's address or text.
    logger.error(`[contact ${requestId}] sender threw`);
    return { status: "unknown", reason: "sender threw" };
  }
}

/** Rejects if `work` takes too long. The work may still finish, which is why callers fail closed. */
async function withinLimiterTimeout<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("limiter timeout")), CONTACT_LIMITS.limiterTimeoutMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function errorResponse(status: number, body: ContactErrorResponse): Response {
  return jsonResponse(status, body);
}

function jsonResponse(status: number, body: ContactPrepared | ContactSent | ContactErrorResponse) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
