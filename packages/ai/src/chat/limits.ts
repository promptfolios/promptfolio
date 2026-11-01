/** Provider timeouts in milliseconds. */
export interface ChatTimeouts {
  /** Until the first content arrives. */
  firstChunkMs: number;
  /** Longest silence between content chunks. */
  chunkMs: number;
  /** The whole reply, including retries. */
  totalMs: number;
}

/** Limits applied to every chat request. See `CHAT_LIMITS` for what each one bounds. */
export interface ChatLimits {
  maxBodyBytes: number;
  maxMessages: number;
  maxMessageChars: number;
  maxTotalChars: number;
  maxOutputTokens: number;
  maxSteps: number;
  maxToolCalls: number;
  timeouts: ChatTimeouts;
  maxRetries: number;
  limiterTimeoutMs: number;
}

/** What a consumer may change. Anything left out, or `undefined`, keeps its default. */
export type ChatLimitOverrides = Partial<Omit<ChatLimits, "timeouts">> & {
  timeouts?: Partial<ChatTimeouts> | undefined;
};

/**
 * The default limits for a chat request. Daily allowances are not here: the application's limiter
 * applies them (see `ChatTurnLimiter`).
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
   * Cap on generated tokens per model call (step), including any thinking tokens the model uses.
   * A turn with lookups makes up to `maxSteps` calls. Some free models reason past 1,000 tokens
   * even at low effort, leaving no answer, so this is 2,000.
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
   * Provider timeouts, so an overloaded provider fails with a clear error instead of leaving the
   * visitor waiting. On a serverless host, keep `totalMs` plus `limiterTimeoutMs` under the function's
   * time limit, so the error reaches the visitor before the host stops the function. Text streams as
   * it arrives, so a long total does not mean a silent wait: the other two limits catch a model that
   * has stopped.
   */
  timeouts: {
    firstChunkMs: 15_000,
    chunkMs: 10_000,
    totalMs: 55_000,
  },
  /** Retries after a failed provider call (for example HTTP 503); the AI SDK default is 2. */
  maxRetries: 1,
  /** A limiter slower than this counts as unavailable, and the model is not called. */
  limiterTimeoutMs: 2_000,
} as const satisfies ChatLimits;

/**
 * The defaults with a consumer's changes applied. Bad values are a programming error, not a visitor's
 * fault, and a limit that silently did nothing could cost money, so they throw.
 *
 * @throws {TypeError} If a limit is not a whole number in range. Names the limit, not its value.
 */
export function resolveChatLimits(overrides: ChatLimitOverrides = {}): ChatLimits {
  const { timeouts, ...limits } = overrides;
  const resolved: ChatLimits = {
    ...CHAT_LIMITS,
    ...withoutUndefined(limits),
    timeouts: { ...CHAT_LIMITS.timeouts, ...withoutUndefined(timeouts ?? {}) },
  };

  const { timeouts: resolvedTimeouts, maxRetries, ...positive } = resolved;
  for (const [name, value] of Object.entries(positive)) assertWhole(`limits.${name}`, value, 1);
  for (const [name, value] of Object.entries(resolvedTimeouts)) {
    assertWhole(`limits.timeouts.${name}`, value, 1);
  }
  assertWhole("limits.maxRetries", maxRetries, 0);
  return resolved;
}

function assertWhole(name: string, value: unknown, min: number): void {
  if (!Number.isSafeInteger(value) || (value as number) < min) {
    throw new TypeError(`${name} must be a whole number of at least ${min}`);
  }
}

function withoutUndefined<T extends object>(values: T): T {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)) as T;
}
