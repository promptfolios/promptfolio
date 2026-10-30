/**
 * Limits applied to contact requests. Characters are counted as JavaScript string length
 * (UTF-16 code units), after the input has been normalized.
 */
export const CONTACT_LIMITS = {
  /** Raw request body size, checked before JSON parsing. A token for the longest message fits. */
  maxBodyBytes: 16_000,
  maxNameChars: 100,
  /** The longest address the email standards allow. */
  maxEmailChars: 254,
  minMessageChars: 10,
  maxMessageChars: 2_000,
  /** How long a visitor can take to confirm a prepared message. */
  tokenLifetimeMs: 15 * 60_000,
  /**
   * With two limiter calls at `limiterTimeoutMs`, stays under the app routes' `maxDuration`, so the
   * visitor gets an answer before a host stops the function.
   */
  sendTimeoutMs: 8_000,
  /** How long one email from a visitor blocks the next. */
  sendLimitWindowMs: 24 * 60 * 60_000,
  /** A limiter slower than this counts as unavailable, and nothing is sent. */
  limiterTimeoutMs: 2_000,
} as const;
