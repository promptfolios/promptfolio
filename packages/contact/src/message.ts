import type { ContactDraft } from "./request";

/** The email as a provider receives it. Plain text only: visitor text is never rendered as HTML. */
export interface ContactEmail {
  from: string;
  to: string;
  /** The visitor's address goes only here, so no message claims to come from them. */
  replyTo: string;
  subject: string;
  text: string;
}

/** Builds the subject and body, written for the owner. Pure, so the same draft gives the same email. */
export function buildContactContent(draft: ContactDraft): Pick<ContactEmail, "subject" | "text"> {
  return {
    subject: `Portfolio message from ${draft.name}`,
    text: [
      `${draft.name} wrote to you through the contact form on your portfolio.`,
      `Replies go to: ${draft.email}`,
      "The name and address were typed by the visitor and are not verified.",
      "",
      draft.message,
    ].join("\n"),
  };
}

/**
 * A key derived from the whole email. Sending the same email again gives the same key, so a
 * provider that supports idempotency keys delivers it once, however the repeat came about: a
 * double click, a replayed token, or the same text prepared again.
 */
export async function contactIdempotencyKey(email: ContactEmail): Promise<string> {
  const content = JSON.stringify([email.from, email.to, email.replyTo, email.subject, email.text]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"));
  return `promptfolio-contact-${hex.join("")}`;
}
