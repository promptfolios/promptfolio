import { z } from "zod";
import { CONTACT_LIMITS } from "./limits";

/** What a visitor writes. Every field is untrusted until `parseDraftRequest` accepts it. */
export interface ContactDraft {
  name: string;
  email: string;
  message: string;
}

/** The draft fields a rejected request can point at. */
export type ContactField = keyof ContactDraft;

export type ContactFieldErrors = Partial<Record<ContactField, string>>;

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; message: string; fields?: ContactFieldErrors };

const CONTROL_CHARACTER = /\p{Cc}/u;
/** Control characters a message may not keep. Line feeds and tabs are ordinary text. */
const MESSAGE_CONTROL_CHARACTERS = /[^\P{Cc}\n\t]/gu;

const FIELD_MESSAGES: Record<ContactField, string> = {
  name: `Enter your name, up to ${CONTACT_LIMITS.maxNameChars} characters.`,
  email: "Enter a valid email address.",
  message: `Enter a message of ${CONTACT_LIMITS.minMessageChars} to ${CONTACT_LIMITS.maxMessageChars} characters.`,
};

/** Line endings become line feeds and other control characters go, so the review shows the real text. */
function normalizeMessage(message: string): string {
  return message.replaceAll(/\r\n?/g, "\n").replaceAll(MESSAGE_CONTROL_CHARACTERS, "").trim();
}

export const draftContentSchema = z.strictObject({
  name: z
    .string()
    .trim()
    .min(1)
    .max(CONTACT_LIMITS.maxNameChars)
    // The name goes into the subject line, where a line break could forge a header.
    .refine((name) => !CONTROL_CHARACTER.test(name)),
  email: z.string().trim().max(CONTACT_LIMITS.maxEmailChars).pipe(z.email()),
  message: z
    .string()
    .transform(normalizeMessage)
    .pipe(z.string().min(CONTACT_LIMITS.minMessageChars).max(CONTACT_LIMITS.maxMessageChars)),
});

/**
 * The accepted body of `prepare`. It is strict, so a request cannot name a recipient, sender,
 * or subject. `website` is a honeypot: the form hides it from people, and simple bots fill it.
 */
const draftRequestSchema = draftContentSchema.extend({
  website: z.string().max(0).optional(),
});

const sendRequestSchema = z.strictObject({ token: z.string().min(1) });

/** Reads and validates the body of `prepare`. Never throws for bad input. */
export async function parseDraftRequest(request: Request): Promise<ParseResult<ContactDraft>> {
  const body = await readJsonBody(request);
  if (!body.ok) return body;

  const parsed = draftRequestSchema.safeParse(body.value);
  if (parsed.success) {
    const { name, email, message } = parsed.data;
    return { ok: true, value: { name, email, message } };
  }

  const fields: ContactFieldErrors = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0];
    if (field === "name" || field === "email" || field === "message") {
      fields[field] = FIELD_MESSAGES[field];
    } else {
      // An unknown key or a filled honeypot: no person using the form can cause this.
      return reject(400, "The message could not be accepted.");
    }
  }
  return { ok: false, status: 400, message: "Please check the highlighted fields.", fields };
}

/** Reads and validates the body of `send`: the confirmation token and nothing else. */
export async function parseSendRequest(request: Request): Promise<ParseResult<string>> {
  const body = await readJsonBody(request);
  if (!body.ok) return body;

  const parsed = sendRequestSchema.safeParse(body.value);
  if (!parsed.success) return reject(400, "This confirmation is not valid.");
  return { ok: true, value: parsed.data.token };
}

/**
 * The checks both routes share. `Sec-Fetch-Site` is set by browsers and scripts in a page cannot
 * change it, so another site cannot use a visitor's browser to post here. A script outside a
 * browser can omit it, so this protects visitors and does not stop scripts.
 */
async function readJsonBody(request: Request): Promise<ParseResult<unknown>> {
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return reject(403, "This request is not allowed.");
  }
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return reject(415, "The request must be JSON.");
  }

  const text = await readBodyWithLimit(request, CONTACT_LIMITS.maxBodyBytes);
  if (text === undefined) return reject(413, "The request is too large.");

  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return reject(400, "The request body is not valid JSON.");
  }
}

function reject(status: number, message: string): { ok: false; status: number; message: string } {
  return { ok: false, status, message };
}

/**
 * Reads the body as UTF-8 text, stopping as soon as it exceeds `maxBytes`, so an oversized
 * body is never fully buffered or parsed. Returns `undefined` when too large.
 */
async function readBodyWithLimit(request: Request, maxBytes: number): Promise<string | undefined> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return undefined;
  if (request.body === null) return "";

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      return undefined;
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}
