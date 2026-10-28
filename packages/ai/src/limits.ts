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
  /** Text characters in a single message (all of its text parts together). */
  maxMessageChars: 4_000,
  /** Text characters across the whole conversation. */
  maxTotalChars: 20_000,
  /** Default cap on generated tokens, including any thinking tokens the model uses. */
  maxOutputTokens: 1_000,
  /**
   * Provider timeouts, so an overloaded provider fails with a clear error instead of
   * leaving the visitor waiting. The total stays under the app route's 30-second
   * `maxDuration`, so the error reaches the visitor before a serverless host stops the
   * function.
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
} as const;
