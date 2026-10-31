import "server-only";
import { Redis } from "@upstash/redis";
import { z } from "zod";
import type { AppEnv } from "./env";

export const REDIS_VARS = ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"] as const;

export interface RedisConfig {
  url: string;
  token: string;
}

export type RedisConfigResult =
  | { status: "ok"; config: RedisConfig }
  | { status: "off" }
  /** `problem` names a variable, never its value. */
  | { status: "invalid"; problem: string };

/** Reads the store's settings. The contact form and the chat limit share one database. */
export function loadRedisConfig(env: AppEnv = process.env): RedisConfigResult {
  const [url, token] = REDIS_VARS.map((name) => env[name]?.trim());
  if (!url && !token) return { status: "off" };
  if (!url || !token) {
    const missing = REDIS_VARS.filter((name) => !env[name]?.trim()).join(", ");
    return { status: "invalid", problem: `not set: ${missing}` };
  }
  // Any host: a local Redis proxy in development is on `localhost`, which `z.httpUrl` refuses.
  if (!z.url({ protocol: /^https?$/ }).safeParse(url).success) {
    return { status: "invalid", problem: "UPSTASH_REDIS_REST_URL is not a URL" };
  }
  return { status: "ok", config: { url, token } };
}

/**
 * Values are compared as stored. No retries: one landing after the timeout could block a visitor
 * who was told nothing was sent, or count an answer twice.
 */
export function createRedisClient({ url, token }: RedisConfig): Redis {
  return new Redis({
    url,
    token,
    automaticDeserialization: false,
    retry: { retries: 0 },
  });
}
