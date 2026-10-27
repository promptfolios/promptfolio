import { InMemoryThreadListAdapter, type ThreadMessage } from "@assistant-ui/react";
import { type AssistantStream, createAssistantStream } from "assistant-stream";

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

/**
 * In-memory thread list (threads reset on reload) that titles each thread from its
 * first user message, instead of the built-in adapter's empty title.
 *
 * Persistence across reloads is planned for M6.
 */
export class TitledInMemoryThreadListAdapter extends InMemoryThreadListAdapter {
  // Parameters are optional because the base class declares `generateTitle()` without
  // any; the runtime passes them as defined by `RemoteThreadListAdapter`.
  override generateTitle(
    _remoteId?: string,
    messages: readonly ThreadMessage[] = [],
  ): Promise<AssistantStream> {
    const title = titleFromMessages(messages);
    return Promise.resolve(
      createAssistantStream((controller) => {
        controller.appendText(title);
      }),
    );
  }
}
