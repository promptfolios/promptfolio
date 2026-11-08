import { type LanguageModelMiddleware, wrapLanguageModel } from "ai";
import { type ChatLogger, modelErrorSummary } from "./chat-turn.ts";
import { CHAT_LIMITS } from "./limits.ts";

type WrapStream = NonNullable<LanguageModelMiddleware["wrapStream"]>;
type CallOptions = Parameters<WrapStream>[0]["params"];
type StreamResult = Awaited<ReturnType<WrapStream>>;
type StreamPart = StreamResult["stream"] extends ReadableStream<infer Part> ? Part : never;

/** The kind of model that can be wrapped. What the AI SDK's current providers return. */
type WrappableModel = ReturnType<typeof wrapLanguageModel>;

export interface FailoverEntry {
  /** Names the model in the log, such as `gateway:openai/gpt-4o-mini`. Never holds a key. */
  label: string;
  model: WrappableModel;
}

export interface FailoverModelOptions {
  /** In order of preference. */
  models: FailoverEntry[];
  /**
   * How long each model but the last may take to send its first content before the next one is
   * tried. Keep `limits.timeouts.firstChunkMs` above the sum of all attempts, because that limit
   * cancels the whole call.
   */
  attemptFirstChunkMs: number;
  /**
   * The same for the last model, which can take longer because nothing follows it. Defaults to
   * `CHAT_LIMITS.timeouts.firstChunkMs`. This is what ends a call to a model that never responds: the
   * AI SDK's own first-chunk limit did not fire in that case, which left only its limit on the whole reply.
   */
  lastAttemptFirstChunkMs?: number;
  /** Defaults to `console`. */
  logger?: ChatLogger;
}

/**
 * A model that moves to the next one when a model fails before its first content: an error, silence,
 * or a reply with nothing in it. Once content has reached the caller, a failure is reported as usual,
 * because a visitor who has read part of an answer cannot be given a different one.
 *
 * Create one per request. A turn makes several model calls, and once one has moved on, the later ones
 * stay on the model that worked, because a provider may refuse another provider's tool history. A
 * fallback receives the whole conversation, so list only providers whose terms you accept.
 *
 * @throws {TypeError} If there is no model, or a timeout is not a whole number of at least 1.
 */
export function createFailoverModel({
  models,
  attemptFirstChunkMs,
  lastAttemptFirstChunkMs = CHAT_LIMITS.timeouts.firstChunkMs,
  logger = console,
}: FailoverModelOptions): WrappableModel {
  const [first] = models;
  if (first === undefined) throw new TypeError("models must not be empty");
  for (const [name, value] of Object.entries({ attemptFirstChunkMs, lastAttemptFirstChunkMs })) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new TypeError(`${name} must be a whole number of at least 1`);
    }
  }

  const firstEntry: FailoverEntry = first;
  let current = 0;

  /** Runs one call on the current model, moving on until one succeeds or none is left. */
  async function withFailover<T>(
    params: CallOptions,
    call: (entry: FailoverEntry, isLast: boolean) => Promise<T>,
  ): Promise<T> {
    let movedOn = false;
    for (;;) {
      const entry = models[current] ?? firstEntry;
      const isLast = current >= models.length - 1;
      try {
        const result = await call(entry, isLast);
        // Names the model that answered, by its label, because the response may not.
        if (movedOn) logger.info(`[failover] continuing with ${entry.label}`);
        return result;
      } catch (error) {
        // A stop by the visitor, or a limit on the whole call, must end the call.
        if (isLast || params.abortSignal?.aborted) throw error;
        // Only a summary, because the error can repeat the visitor's conversation.
        logger.error(`[failover] ${entry.label} failed, moving on`, modelErrorSummary(error));
        current += 1;
        movedOn = true;
      }
    }
  }

  return wrapLanguageModel({
    model: first.model,
    modelId: models.map((entry) => entry.label).join(","),
    middleware: {
      wrapStream: ({ params }) =>
        withFailover(params, async ({ model, label }, isLast) => {
          const result = await startStream(
            model,
            current === 0 ? params : withoutReasoning(params),
            isLast ? lastAttemptFirstChunkMs : attemptFirstChunkMs,
          );
          return { ...result, stream: result.stream.pipeThrough(withModelId(label)) };
        }),
      wrapGenerate: ({ params }) =>
        withFailover(params, async ({ model, label }) => {
          const result = await model.doGenerate(params);
          return result.response?.modelId
            ? result
            : { ...result, response: { ...result.response, modelId: label } };
        }),
    },
  });
}

/**
 * Names the answering entry by its label when its provider reports no model id. Otherwise the AI
 * SDK would report the failover model's own id, which lists every label.
 */
function withModelId(label: string): TransformStream<StreamPart, StreamPart> {
  let reported = false;
  return new TransformStream({
    transform(part, controller) {
      if (part.type === "response-metadata") {
        reported = true;
        controller.enqueue(part.modelId ? part : { ...part, modelId: label });
        return;
      }
      if (part.type === "finish" && !reported) {
        reported = true;
        controller.enqueue({ type: "response-metadata", modelId: label });
      }
      controller.enqueue(part);
    },
  });
}

/**
 * Earlier steps' thinking, removed for a model that took over. It is another model's and often
 * unusable, and the AI SDK prints what it cannot send in a warning, where it could repeat a visitor's
 * words in the log.
 */
function withoutReasoning(params: CallOptions): CallOptions {
  return {
    ...params,
    prompt: params.prompt.map((message) =>
      message.role === "assistant"
        ? { ...message, content: message.content.filter((part) => part.type !== "reasoning") }
        : message,
    ),
  };
}

class AttemptError extends Error {
  constructor(name: "AttemptTimedOut" | "AttemptWithoutContent") {
    super(name);
    this.name = name;
  }
}

/** Whether a part is something the caller acts on. Thinking is not: a model can think and then fail. */
function isContent(part: StreamPart): boolean {
  switch (part.type) {
    case "text-delta":
      return part.delta.trim() !== "";
    case "tool-input-start":
    case "tool-call":
      return true;
    default:
      return false;
  }
}

/**
 * Starts a stream and holds its parts back until the first content, so that a failure before then can
 * still move to another model. The attempt has its own signal, because the caller's would end the
 * whole call.
 */
async function startStream(
  model: WrappableModel,
  params: CallOptions,
  timeoutMs: number,
): Promise<StreamResult> {
  const attempt = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new AttemptError("AttemptTimedOut");
      attempt.abort(error);
      reject(error);
    }, timeoutMs);
  });
  // A model that ignores the signal must still lose the race. A late rejection has no one waiting.
  timedOut.catch(() => {});
  const within = <T>(work: PromiseLike<T>) => Promise.race([work, timedOut]);

  const signals = [attempt.signal, ...(params.abortSignal ? [params.abortSignal] : [])];
  let reader: ReadableStreamDefaultReader<StreamPart> | undefined;
  try {
    const result = await within(
      model.doStream({ ...params, abortSignal: AbortSignal.any(signals) }),
    );
    reader = result.stream.getReader();
    const held: StreamPart[] = [];
    for (;;) {
      const { done, value } = await within(reader.read());
      if (done || value.type === "finish") throw new AttemptError("AttemptWithoutContent");
      if (value.type === "error") throw value.error;
      held.push(value);
      if (isContent(value)) return { ...result, stream: replay(held, reader) };
    }
  } catch (error) {
    reader?.cancel(error).catch(() => {});
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** The parts already read, then the rest of the stream. */
function replay(
  held: StreamPart[],
  reader: ReadableStreamDefaultReader<StreamPart>,
): ReadableStream<StreamPart> {
  return new ReadableStream<StreamPart>({
    async pull(controller) {
      const part = held.shift();
      if (part !== undefined) {
        controller.enqueue(part);
        return;
      }
      const { done, value } = await reader.read();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    cancel: (reason) => reader.cancel(reason),
  });
}
