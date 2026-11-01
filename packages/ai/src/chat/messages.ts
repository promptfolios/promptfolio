/** The text a visitor can see when a request is refused or fails. */
export interface ChatMessages {
  crossSite: string;
  notJson: string;
  tooLarge: string;
  unreadable: string;
  invalidJson: string;
  invalidConversation: string;
  /** `{maxChars}` becomes the limit. */
  messageTooLong: string;
  conversationTooLong: string;
  noQuestion: string;
  visitorLimit: string;
  siteLimit: string;
  /** Any failure that is not the visitor's fault. `{ref}` becomes an id that is also in the log. */
  unavailable: string;
}

/**
 * The default text. Plain strings with placeholders rather than functions, so no consumer code runs
 * while an error is being reported.
 */
export const CHAT_MESSAGES = {
  crossSite: "This request is not allowed.",
  notJson: "The request must be JSON.",
  tooLarge: "The request is too large.",
  unreadable: "The request could not be read.",
  invalidJson: "The request body is not valid JSON.",
  invalidConversation: "The request does not contain a valid conversation.",
  messageTooLong: "A message is longer than {maxChars} characters.",
  conversationTooLong: "The conversation is too long. Please start a new chat.",
  noQuestion: "The conversation must end with a question.",
  visitorLimit: "You've reached the daily limit of live answers. Please try again tomorrow.",
  siteLimit:
    "The assistant has reached its daily limit of live answers. Please try again tomorrow.",
  unavailable: "The assistant could not answer right now. Please try again later. (ref {ref})",
} as const satisfies ChatMessages;

/**
 * The defaults with a consumer's changes applied. Anything left out, or `undefined`, keeps its default.
 *
 * @throws {TypeError} If a message is not text. An empty reply would leave a visitor with nothing.
 */
export function resolveChatMessages(overrides: Partial<ChatMessages> = {}): ChatMessages {
  const resolved: ChatMessages = { ...CHAT_MESSAGES };
  for (const key of Object.keys(CHAT_MESSAGES) as Array<keyof ChatMessages>) {
    const value: unknown = overrides[key];
    if (value === undefined) continue;
    if (typeof value !== "string" || value.trim() === "") {
      throw new TypeError(`visitorMessages.${key} must be text`);
    }
    resolved[key] = value;
  }
  return resolved;
}

/** The `unavailable` text for one request. */
export function unavailableMessage(text: Pick<ChatMessages, "unavailable">, ref: string): string {
  return text.unavailable.replaceAll("{ref}", ref);
}
