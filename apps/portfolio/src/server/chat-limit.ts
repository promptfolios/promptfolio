import "server-only";
import { CHAT_LIMITS, type ChatLimit, type ChatTurnLimiter } from "@promptfolio/ai";
import type { Redis } from "@upstash/redis";
import { type AppEnv, createRedisClient, loadRedisConfig, type RedisConfig } from "./redis";
import { createVisitorIdentifier, MIN_SECRET_CHARS } from "./visitor";

const WINDOW_SECONDS = CHAT_LIMITS.liveTurnWindowMs / 1000;

export interface ChatTurnAllowance {
  perVisitor: number;
  forSite: number;
}

/** The part of the Redis client this adapter uses, so tests can pass a fake. */
export type ChatLimitRedis = Pick<Redis, "multi">;

/**
 * Counts live answers in Redis, in two counters that each expire 24 hours after their first count.
 * `INCR` and `EXPIRE ... NX` run in one transaction, so a crash between them cannot leave a counter
 * that never expires. Only a positive whole number counts as an answer from the store, so anything
 * else rejects and the model is not called.
 */
export function createRedisChatLimiter(
  redis: ChatLimitRedis,
  allowance: ChatTurnAllowance = {
    perVisitor: CHAT_LIMITS.maxLiveTurnsPerVisitor,
    forSite: CHAT_LIMITS.maxLiveTurnsForSite,
  },
): ChatTurnLimiter {
  const count = async (key: string): Promise<number> => {
    const results = await redis.multi().incr(key).expire(key, WINDOW_SECONDS, "NX").exec();
    const counted = results[0];
    if (!Number.isInteger(counted) || counted < 1) {
      throw new Error("unexpected answer from the store");
    }
    return counted;
  };
  return {
    async take(visitor) {
      if ((await count(`chat:turns:visitor:${visitor}`)) > allowance.perVisitor) {
        return "visitor-limit";
      }
      return (await count("chat:turns:site")) > allowance.forSite ? "site-limit" : "allowed";
    },
  };
}

export type ChatLimitConfigResult =
  | { status: "ok"; redis: RedisConfig; visitorSecret: string }
  /** Which variable is missing or wrong, never its value. */
  | { status: "missing"; problem: string };

/** Reads the chat limit's settings. Unlike the contact form's, they are never simply "off". */
export function loadChatLimitConfig(env: AppEnv = process.env): ChatLimitConfigResult {
  const redis = loadRedisConfig(env);
  if (redis.status === "off") {
    return {
      status: "missing",
      problem: "not set: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN",
    };
  }
  if (redis.status === "invalid") return { status: "missing", problem: redis.problem };

  const visitorSecret = env.VISITOR_HASH_SECRET?.trim();
  if (!visitorSecret) return { status: "missing", problem: "not set: VISITOR_HASH_SECRET" };
  if (visitorSecret.length < MIN_SECRET_CHARS) {
    return {
      status: "missing",
      problem: `VISITOR_HASH_SECRET must have at least ${MIN_SECRET_CHARS} characters`,
    };
  }
  return { status: "ok", redis: redis.config, visitorSecret };
}

/**
 * The limit for one chat request. Without its settings, live answers are refused, because a missed
 * variable must not remove the limit on a public site. The exception is `next dev`, which has no
 * public traffic and should work without a store: there it warns and runs unlimited. Problems are
 * logged for the owner; visitors only see that the assistant cannot answer.
 */
export function createChatLimit(env: AppEnv = process.env): ChatLimit | null {
  const config = loadChatLimitConfig(env);
  if (config.status === "ok") {
    return {
      limiter: createRedisChatLimiter(createRedisClient(config.redis)),
      identifyVisitor: createVisitorIdentifier(config.visitorSecret, "chat-visitor"),
    };
  }
  if (env.NODE_ENV === "development") {
    console.warn(`[chat] no rate limit in development: ${config.problem}`);
    return null;
  }
  console.error(`[chat] rate limit not configured: ${config.problem}`);
  return { limiter: REFUSING_LIMITER, identifyVisitor: async () => "unconfigured" };
}

const REFUSING_LIMITER: ChatTurnLimiter = {
  take: () => Promise.reject(new Error("the chat limit is not configured")),
};
