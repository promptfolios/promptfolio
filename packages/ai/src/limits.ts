/**
 * Limits applied to every chat request before the model is called.
 *
 * Characters are counted as JavaScript string length (UTF-16 code units), a cheap and
 * predictable proxy for tokens. Tokens are what cost money; these limits bound them.
 */
export const CHAT_LIMITS = {
  /** Raw request body size, checked before JSON parsing. */
  maxBodyBytes: 100_000,
  maxMessages: 50,
  /**
   * Text characters in a single visitor message (all of its text parts together). Assistant
   * messages have no limit of their own, because a live answer can be longer than this and its
   * thread must still accept follow-ups. `maxTotalChars` bounds them.
   */
  maxMessageChars: 4_000,
  /** Text characters across the whole conversation. */
  maxTotalChars: 20_000,
  /**
   * Default cap on generated tokens per model call (step), including any thinking tokens
   * the model uses. A turn with lookups makes up to `maxSteps` calls. Raised from 1,000 in
   * M7.1: some free models reason past 1,000 tokens even at low effort, leaving no answer.
   */
  maxOutputTokens: 2_000,
  /**
   * Model calls in one turn: tool calls and their results take a step each, and the last
   * allowed step must answer in text.
   */
  maxSteps: 4,
  /** Tool calls in one turn, across all steps; later calls return `limit_reached`. */
  maxToolCalls: 8,
  /**
   * Provider timeouts, so an overloaded provider fails with a clear error instead of
   * leaving the visitor waiting. The total covers all steps and, with `limiterTimeoutMs`, stays
   * under the app route's 30-second `maxDuration`, so the error reaches the visitor before a
   * serverless host stops the function.
   */
  timeouts: {
    /** Until the first content arrives. */
    firstChunkMs: 15_000,
    /** Longest silence between content chunks. */
    chunkMs: 10_000,
    /** The whole reply, including retries. */
    totalMs: 25_000,
  },
  /** Retries after a failed provider call (for example HTTP 503); the AI SDK default is 2. */
  maxRetries: 1,
  /** Live answers one visitor can get per `liveTurnWindowMs`. Prepared answers do not count. */
  maxLiveTurnsPerVisitor: 30,
  /** Live answers the whole site can give per `liveTurnWindowMs`, whatever the visitor's address. */
  maxLiveTurnsForSite: 200,
  liveTurnWindowMs: 24 * 60 * 60_000,
  /** A limiter slower than this counts as unavailable, and the model is not called. */
  limiterTimeoutMs: 2_000,
} as const;
