import type { ChatModelAdapter, ThreadMessage } from "@assistant-ui/react";

/**
 * TEMPORARY SCAFFOLDING (M3): stands in for the model until M4 connects a real one.
 * Its replies are clearly labelled and never claim to be AI output.
 *
 * Sending exactly `/fail` simulates a transient failure: the first attempt for that
 * message fails and a retry succeeds, to exercise the error and retry states.
 */

export const FAIL_COMMAND = "/fail";
const ECHO_LIMIT = 200;

export interface UserMessageText {
  id: string;
  text: string;
}

/** Returns the id and trimmed text of the most recent user message, if any. */
export function lastUserMessage(messages: readonly ThreadMessage[]): UserMessageText | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message?.role === "user") {
      const text = message.content
        .map((part) => (part.type === "text" ? part.text : ""))
        .join("")
        .trim();
      return { id: message.id, text };
    }
  }
  return undefined;
}

/** Builds the labelled placeholder reply for a user message. */
export function placeholderReply(userText: string): string {
  const echo =
    userText.length > ECHO_LIMIT ? `${userText.slice(0, ECHO_LIMIT)}…` : userText || "(empty)";
  return [
    "**Placeholder response, not AI output.** The assistant is connected in a later milestone.",
    "",
    `You asked: "${echo}"`,
  ].join("\n");
}

function wait(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(resolve, delayMs);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

/** Creates the placeholder chat model. `delayMs` simulates response latency. */
export function createPlaceholderModel({ delayMs = 600 } = {}): ChatModelAdapter {
  // Ids of `/fail` messages that have already failed once, so a retry succeeds.
  const failedMessageIds = new Set<string>();

  return {
    async run({ messages, abortSignal }) {
      await wait(delayMs, abortSignal);

      const userMessage = lastUserMessage(messages);
      if (userMessage?.text === FAIL_COMMAND && !failedMessageIds.has(userMessage.id)) {
        failedMessageIds.add(userMessage.id);
        throw new Error("Simulated failure. Use the refresh button to retry.");
      }

      return { content: [{ type: "text", text: placeholderReply(userMessage?.text ?? "") }] };
    },
  };
}
