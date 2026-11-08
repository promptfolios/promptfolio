import type { ThreadMessage } from "@assistant-ui/react";

const TITLE_LIMIT = 40;
export const DEFAULT_TITLE = "New chat";

/**
 * A short thread title from the first question's text. The server titles a conversation when it
 * first saves it, and the browser shows the same title straight away, so both use this.
 */
export function titleFromText(text: string): string {
  const plain = text.replace(/\s+/g, " ").trim();
  if (plain === "") return DEFAULT_TITLE;
  return plain.length > TITLE_LIMIT ? `${plain.slice(0, TITLE_LIMIT).trimEnd()}…` : plain;
}

/** Derives a short thread title from the first user message. */
export function titleFromMessages(messages: readonly ThreadMessage[]): string {
  const firstUser = messages.find((message) => message.role === "user");
  return titleFromText(
    (firstUser?.content ?? []).map((part) => (part.type === "text" ? part.text : "")).join(" "),
  );
}
