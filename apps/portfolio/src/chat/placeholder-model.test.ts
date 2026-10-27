import type { ChatModelAdapter, ChatModelRunOptions, ThreadMessage } from "@assistant-ui/react";
import { describe, expect, it } from "vitest";
import {
  createPlaceholderModel,
  FAIL_COMMAND,
  lastUserMessage,
  placeholderReply,
} from "./placeholder-model";

/**
 * Builds a minimal message. The cast is limited to test fixtures: the model only reads
 * `id`, `role`, and `content`, so the other ThreadMessage fields are omitted.
 */
function message(id: string, role: "user" | "assistant", text: string): ThreadMessage {
  return { id, role, content: [{ type: "text", text }] } as unknown as ThreadMessage;
}

/** Runs the model with only the options it uses. */
async function run(
  model: ChatModelAdapter,
  messages: ThreadMessage[],
  abortSignal = new AbortController().signal,
) {
  return model.run({ messages, abortSignal } as unknown as ChatModelRunOptions);
}

describe("lastUserMessage", () => {
  it("returns the id and trimmed text of the most recent user message", () => {
    const messages = [
      message("1", "user", "first"),
      message("2", "assistant", "reply"),
      message("3", "user", " second "),
    ];
    expect(lastUserMessage(messages)).toEqual({ id: "3", text: "second" });
  });

  it("returns undefined when there is no user message", () => {
    expect(lastUserMessage([message("1", "assistant", "hello")])).toBeUndefined();
  });
});

describe("placeholderReply", () => {
  it("is clearly labelled as not being AI output", () => {
    expect(placeholderReply("hi")).toContain("Placeholder response, not AI output.");
  });

  it("truncates long messages", () => {
    const reply = placeholderReply("x".repeat(500));
    expect(reply).toContain(`${"x".repeat(200)}…`);
    expect(reply).not.toContain("x".repeat(201));
  });
});

describe("createPlaceholderModel", () => {
  it("replies with a single labelled text part", async () => {
    const model = createPlaceholderModel({ delayMs: 0 });

    const result = await run(model, [message("1", "user", "What are the main skills?")]);

    expect(result).toEqual({
      content: [{ type: "text", text: placeholderReply("What are the main skills?") }],
    });
  });

  it("fails the first attempt for the fail command and succeeds on retry", async () => {
    const model = createPlaceholderModel({ delayMs: 0 });
    const messages = [message("1", "user", FAIL_COMMAND)];

    await expect(run(model, messages)).rejects.toThrow("Simulated failure");
    await expect(run(model, messages)).resolves.toEqual({
      content: [{ type: "text", text: placeholderReply(FAIL_COMMAND) }],
    });
  });

  it("fails again for a new fail message", async () => {
    const model = createPlaceholderModel({ delayMs: 0 });
    await expect(run(model, [message("1", "user", FAIL_COMMAND)])).rejects.toThrow();

    await expect(run(model, [message("2", "user", FAIL_COMMAND)])).rejects.toThrow();
  });

  it("stops when the request is cancelled", async () => {
    const model = createPlaceholderModel({ delayMs: 0 });
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));

    await expect(run(model, [message("1", "user", "hi")], controller.signal)).rejects.toThrow(
      "cancelled",
    );
  });
});
