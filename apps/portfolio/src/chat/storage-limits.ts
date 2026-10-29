/**
 * Limits for conversations saved in the browser.
 *
 * Characters are counted as JavaScript string length (UTF-16 code units), which is also
 * what browsers count against the `localStorage` quota (usually about 5 million per origin).
 */
export const STORAGE_LIMITS = {
  /** Saved threads; creating one more removes the least recently used. */
  maxThreads: 20,
  /** Threads with no new message for this long are removed when the list loads. */
  retentionDays: 30,
  /** The server accepts 50 per request; a little headroom for edited or regenerated branches. */
  maxMessagesPerThread: 60,
  /**
   * Text characters in one message. Answers can be longer than the server's 4,000-character
   * input limit, because the model writes up to 1,000 tokens per step.
   */
  maxMessageChars: 16_000,
  /** Serialized length of one thread; 20 threads stay under the usual quota. */
  maxThreadChars: 200_000,
} as const;
