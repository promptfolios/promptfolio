import "server-only";
import {
  CONTACT_LIMITS,
  type ContactOptions,
  type ContactSender,
  type ContactSendLimiter,
  type ContactSendOutcome,
} from "@promptfolio/contact";
import type { Redis } from "@upstash/redis";
import { Resend } from "resend";
import { z } from "zod";
import { loadAppProfile } from "./profile";
import { type AppEnv, createRedisClient, loadRedisConfig, REDIS_VARS } from "./redis";
import { createVisitorIdentifier, MIN_SECRET_CHARS } from "./visitor";

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

/** The form's own settings. Setting any of them turns the form on, which then also needs Redis. */
const CONTACT_VARS = [
  "RESEND_API_KEY",
  "CONTACT_TO_EMAIL",
  "CONTACT_FROM_EMAIL",
  "CONTACT_TOKEN_SECRET",
] as const;

const addressSchema = z.email();
/** `Name <address>`, the form Resend documents for a sender with a display name. */
const NAMED_ADDRESS = /^[^<>]*<([^<>\s]+)>$/;

/**
 * Reads the contact configuration. Server-only: importing this module from client code fails
 * the build, so the address and the keys cannot reach the browser through it. Checked per request
 * rather than at startup, so the app builds and renders without it, as with the model keys.
 */
export function loadContactConfig(env: AppEnv = process.env): ContactConfigResult {
  const [apiKey, recipientAddress, from, tokenSecret] = CONTACT_VARS.map((name) =>
    env[name]?.trim(),
  );
  // Redis alone does not turn the form on: the chat limit uses the same database.
  if (!apiKey && !recipientAddress && !from && !tokenSecret) return { status: "off" };

  // The Redis settings are required: a missed variable must not quietly remove the daily limit.
  const missing = [...CONTACT_VARS, ...REDIS_VARS].filter((name) => !env[name]?.trim());
  if (!apiKey || !recipientAddress || !from || !tokenSecret || missing.length > 0) {
    return { status: "invalid", problem: `not set: ${missing.join(", ")}` };
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
  const redis = loadRedisConfig(env);
  if (redis.status === "invalid") return redis;
  if (redis.status !== "ok") return { status: "invalid", problem: "not set: Redis settings" };
  return {
    status: "ok",
    config: {
      apiKey,
      recipientAddress,
      from,
      tokenSecret,
      redisUrl: redis.config.url,
      redisToken: redis.config.token,
    },
  };
}

/** Whether to show the Contact button. The browser learns this and nothing else about the setup. */
export function isContactEnabled(env: AppEnv = process.env): boolean {
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
    limiter: createRedisLimiter(createRedisClient({ url: redisUrl, token: redisToken })),
    // The label keeps this hash apart from the token signatures made with the same secret.
    identifyVisitor: createVisitorIdentifier(tokenSecret, "contact-visitor"),
    tokenSecret,
  });
}

function unavailable(): Response {
  return Response.json(
    { status: "failed", message: "The contact form is not available right now. Nothing was sent." },
    { status: 503, headers: { "cache-control": "no-store" } },
  );
}
