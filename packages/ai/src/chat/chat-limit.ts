import { CHAT_LIMITS } from "./limits";

/** Whether a live answer may run, and if not, whose allowance is used up. */
export type ChatTurnDecision = "allowed" | "visitor-limit" | "site-limit";

/**
 * Bounds live answers, the only part of a chat request that costs money. The application
 * implements it, because it needs state shared between requests, so this package names no store.
 */
export interface ChatTurnLimiter {
  /**
   * Atomically counts one live answer for the visitor and the site, using the visitor's allowance
   * first, so a blocked visitor does not use up the site's. Rejects if the store cannot answer.
   */
  take(visitor: string): Promise<ChatTurnDecision>;
}

export interface ChatLimit {
  limiter: ChatTurnLimiter;
  /**
   * The key the limiter counts by, or `undefined` if the request does not show who sent it. What
   * identifies a visitor depends on the host, so the application decides. Return something that is
   * safe to store and never logged, such as a keyed hash of the IP address.
   */
  identifyVisitor: (request: Request) => Promise<string | undefined>;
}

/** The outcome of a check. A failed check is `unavailable`: the limit is never skipped. */
export type ChatLimitCheck = ChatTurnDecision | "unavailable";

/**
 * Asks the limiter whether a live answer may run. Fails closed: if the limiter errors or takes too
 * long, or the visitor cannot be identified, the answer is `unavailable`. The error itself is
 * dropped, because it could repeat a store credential.
 */
export async function checkChatLimit(limit: ChatLimit, request: Request): Promise<ChatLimitCheck> {
  try {
    const visitor = await withinLimiterTimeout(limit.identifyVisitor(request));
    if (visitor === undefined) return "unavailable";
    return await withinLimiterTimeout(limit.limiter.take(visitor));
  } catch {
    return "unavailable";
  }
}

/** Rejects if `work` takes too long. The work may still finish, which is why callers fail closed. */
async function withinLimiterTimeout<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("limiter timeout")), CHAT_LIMITS.limiterTimeoutMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
