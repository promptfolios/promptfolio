import type { ThreadMessage } from "@assistant-ui/react";

const TITLE_LIMIT = 40;
export const DEFAULT_TITLE = "New chat";

/** Derives a short thread title from the first user message. */
export function titleFromMessages(messages: readonly ThreadMessage[]): string {
  const firstUser = messages.find((message) => message.role === "user");
  const text = (firstUser?.content ?? [])
    .map((part) => (part.type === "text" ? part.text : ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (text === "") return DEFAULT_TITLE;
  return text.length > TITLE_LIMIT ? `${text.slice(0, TITLE_LIMIT).trimEnd()}…` : text;
}
