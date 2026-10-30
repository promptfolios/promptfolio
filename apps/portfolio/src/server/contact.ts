import "server-only";
import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import {
  CONTACT_LIMITS,
  type ContactOptions,
  type ContactSender,
  type ContactSendLimiter,
  type ContactSendOutcome,
} from "@promptfolio/contact";
import { Redis } from "@upstash/redis";
import { Resend } from "resend";
import { z } from "zod";
import { loadAppProfile } from "./profile";

/** Environment variables, as in `process.env`. */
export type ContactEnv = Readonly<Record<string, string | undefined>>;

export interface ContactConfig {
  apiKey: string;
  /** Private: read here and passed to the handlers, never sent to the browser. */
  recipientAddress: string;
  from: string;
  tokenSecret: string;
  redisUrl: string;
  redisToken: string;
}

export type ContactConfigResult =
  | { status: "ok"; config: ContactConfig }
  /** Nothing is configured: the portfolio simply has no contact form. */
  | { status: "off" }
  /** Partly or wrongly configured. `problem` names a variable, never its value. */
  | { status: "invalid"; problem: string };

const CONTACT_VARS = [
  "RESEND_API_KEY",
  "CONTACT_TO_EMAIL",
  "CONTACT_FROM_EMAIL",
  "CONTACT_TOKEN_SECRET",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
] as const;

const MIN_SECRET_CHARS = 32;

const addressSchema = z.email();
/** `Name <address>`, the form Resend documents for a sender with a display name. */
const NAMED_ADDRESS = /^[^<>]*<([^<>\s]+)>$/;

/**
 * Reads the contact configuration. Server-only: importing this module from client code fails
 * the build, so the address and the keys cannot reach the browser through it. Checked per request
 * rather than at startup, so the app builds and renders without it, as with the model keys.
 */
export function loadContactConfig(env: ContactEnv = process.env): ContactConfigResult {
  const [apiKey, recipientAddress, from, tokenSecret, redisUrl, redisToken] = CONTACT_VARS.map(
    (name) => env[name]?.trim(),
  );
  if (!apiKey && !recipientAddress && !from && !tokenSecret && !redisUrl && !redisToken) {
    return { status: "off" };
  }
  // The Redis settings are required: a missed variable must not quietly remove the daily limit.
  if (!apiKey || !recipientAddress || !from || !tokenSecret || !redisUrl || !redisToken) {
    const missing = CONTACT_VARS.filter((name) => !env[name]?.trim()).join(", ");
    return { status: "invalid", problem: `not set: ${missing}` };
  }
  if (!addressSchema.safeParse(recipientAddress).success) {
    return { status: "invalid", problem: "CONTACT_TO_EMAIL is not an email address" };
  }
  const fromAddress = NAMED_ADDRESS.exec(from)?.[1] ?? from;
  if (!addressSchema.safeParse(fromAddress).success) {
    return {
      status: "invalid",
      problem: 'CONTACT_FROM_EMAIL must be "address" or "Name <address>"',
    };
  }
  if (tokenSecret.length < MIN_SECRET_CHARS) {
    return {
      status: "invalid",
      problem: `CONTACT_TOKEN_SECRET must have at least ${MIN_SECRET_CHARS} characters`,
    };
  }
  // Any host: a local Redis proxy in development is on `localhost`, which `z.httpUrl` refuses.
  if (!z.url({ protocol: /^https?$/ }).safeParse(redisUrl).success) {
    return { status: "invalid", problem: "UPSTASH_REDIS_REST_URL is not a URL" };
  }
  return {
    status: "ok",
    config: { apiKey, recipientAddress, from, tokenSecret, redisUrl, redisToken },
  };
}

/** Whether to show the Contact button. The browser learns this and nothing else about the setup. */
export function isContactEnabled(env: ContactEnv = process.env): boolean {
  const result = loadContactConfig(env);
  if (result.status === "invalid") console.error(`[contact] not configured: ${result.problem}`);
  return result.status === "ok";
}

/** The part of the Resend client this adapter uses, so tests can pass a fake. */
export interface ResendEmails {
  emails: Pick<Resend["emails"], "send">;
}

/**
 * Sends through Resend and sorts its answers into the three outcomes. Only an id counts as sent.
 * The SDK reports network errors and aborts as an error with `statusCode: null` instead of
 * throwing. Provider messages are not passed on: only the error's name reaches the log.
 */
export function createResendSender(client: ResendEmails): ContactSender {
  return {
    async send(email, { idempotencyKey, signal }): Promise<ContactSendOutcome> {
      const { data, error } = await client.emails.send(
        {
          from: email.from,
          to: email.to,
          replyTo: email.replyTo,
          subject: email.subject,
          text: email.text,
        },
        { idempotencyKey, signal },
      );

      if (error) {
        const status = error.statusCode;
        // The first request with this key is still running, so the email may yet be sent.
        const stillRunning = (error.name as string) === "concurrent_idempotent_requests";
        const noClearAnswer = typeof status !== "number" || status >= 500 || stillRunning;
        return {
          status: noClearAnswer ? "unknown" : "failed",
          reason: `${error.name} (${status})`,
        };
      }
      if (data?.id) return { status: "sent", id: data.id };
      return { status: "unknown", reason: "no id in the response" };
    },
  };
}

/** The part of the Redis client this adapter uses, so tests can pass a fake. */
export type LimiterRedis = Pick<Redis, "set" | "get" | "del">;

/**
 * Holds each visitor's slot in Redis, as a key that expires by itself. `SET ... NX` is atomic, so
 * two requests at once cannot both take a slot. Only "OK" counts as taken and only `null` as
 * already held, so an unexpected answer rejects and nothing is sent.
 */
export function createRedisLimiter(redis: LimiterRedis): ContactSendLimiter {
  const slot = (visitor: string) => `contact:send:${visitor}`;
  return {
    async claim(visitor, emailKey) {
      const result = await redis.set(slot(visitor), emailKey, {
        nx: true,
        ex: CONTACT_LIMITS.sendLimitWindowMs / 1000,
      });
      if (result === "OK") return "claimed";
      if (result !== null) throw new Error("unexpected answer from the store");
      return (await redis.get(slot(visitor))) === emailKey ? "claimed" : "limited";
    },
    async release(visitor) {
      await redis.del(slot(visitor));
    },
  };
}

const MAPPED_IPV4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i;

/**
 * The part of an address that identifies one connection, or `undefined` if it is not an address.
 * One IPv6 connection often controls a whole /64 block, so only those first 64 bits count.
 */
export function visitorNetwork(address: string): string | undefined {
  const plain = address.trim().split("%")[0] ?? "";
  const mapped = MAPPED_IPV4.exec(plain)?.[1];
  if (mapped) return mapped;

  const version = isIP(plain);
  if (version === 4) return plain;
  if (version !== 6) return undefined;

  const groupsOf = (part: string | undefined) => (part ? part.split(":") : []);
  const [start, end] = plain.split("::");
  const head = groupsOf(start);
  // A dotted tail stands for two groups; only the count matters, as it is past the first 64 bits.
  const tail = groupsOf(end).flatMap((group) => (group.includes(".") ? ["0", "0"] : [group]));
  const zeros = Array<string>(8 - head.length - tail.length).fill("0");
  return [...head, ...zeros, ...tail]
    .slice(0, 4)
    .map((group) => Number.parseInt(group, 16).toString(16))
    .join(":");
}

/**
 * Identifies a visitor by a keyed hash of their IP address, so the store never holds the address.
 * Vercel overwrites these headers, so a client cannot choose them. Another host must do the same.
 * `x-forwarded-for` is the fallback for `next dev` and `next start`. The label keeps this hash
 * apart from the token signatures made with the same secret.
 */
export function createVisitorIdentifier(secret: string) {
  return async (request: Request): Promise<string | undefined> => {
    const header =
      request.headers.get("x-vercel-forwarded-for") ?? request.headers.get("x-forwarded-for");
    const network = header ? visitorNetwork(header.split(",")[0] ?? "") : undefined;
    if (!network) return undefined;
    return createHmac("sha256", secret).update(`contact-visitor:${network}`).digest("base64url");
  };
}

/**
 * The shared part of both routes: configuration, the owner's name for the review screen, the
 * sender, and the daily limit. Problems are logged for the owner; visitors only see that nothing
 * was sent.
 */
export async function withContactOptions(
  handle: (options: ContactOptions) => Promise<Response>,
): Promise<Response> {
  const result = loadContactConfig();
  if (result.status !== "ok") {
    console.error(`[contact] not configured: ${result.status === "off" ? "off" : result.problem}`);
    return unavailable();
  }

  const { fileName, result: profile } = await loadAppProfile();
  if (!profile.ok) {
    console.error(`[contact] profile ${fileName} could not be loaded`);
    return unavailable();
  }

  const { apiKey, recipientAddress, from, tokenSecret, redisUrl, redisToken } = result.config;
  return handle({
    recipient: { name: profile.profile.identity.name, address: recipientAddress },
    from,
    sender: createResendSender(new Resend(apiKey)),
    limiter: createRedisLimiter(
      new Redis({
        url: redisUrl,
        token: redisToken,
        // Values are compared as stored. No retries: one landing after the timeout could block a
        // visitor who was told nothing was sent.
        automaticDeserialization: false,
        retry: { retries: 0 },
      }),
    ),
    identifyVisitor: createVisitorIdentifier(tokenSecret),
    tokenSecret,
  });
}

function unavailable(): Response {
  return Response.json(
    { status: "failed", message: "The contact form is not available right now. Nothing was sent." },
    { status: 503, headers: { "cache-control": "no-store" } },
  );
}
