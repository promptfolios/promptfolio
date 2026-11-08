import type { UIMessage } from "ai";
import { z } from "zod";
import type { ChatLimits } from "./limits.ts";
import type { ChatMessages } from "./messages.ts";

/**
 * What a chat id or a message id may look like: short, and safe in a storage key. The AI SDK's own
 * ids (from `useChat` and `createIdGenerator`) match.
 */
const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);

/**
 * The only message the browser sends: the visitor's new question, as text. Earlier messages come
 * from the server's store, so the browser cannot send answers, tool results, or instructions.
 * Every other role and part type (files, tools, reasoning, data) is rejected.
 */
const messageSchema = z.object({
  id: idSchema,
  role: z.literal("user"),
  parts: z.array(z.object({ type: z.literal("text"), text: z.string() })).min(1),
});

/**
 * The accepted request body. Every other field the client sends (such as `system`, `tools`,
 * `messages`, or `trigger`) is stripped by zod.
 *
 * - `id`: the conversation.
 * - `message`: the new question.
 * - `parentId`: the message it follows, or `null` for the first one. An edited question or a
 *   regenerated answer names an earlier message, and what came after it is replaced.
 */
const bodySchema = z.object({
  id: idSchema,
  message: messageSchema,
  parentId: idSchema.nullable(),
});

/** A validated request: which conversation, and the question that follows `parentId`. */
export interface ChatRequest {
  chatId: string;
  message: UIMessage;
  parentId: string | null;
}

export type ParseChatRequestResult =
  | ({ ok: true } & ChatRequest)
  | { ok: false; status: number; message: string };

/** Whether a string can be a chat id. For routes that take one from a URL. */
export function isChatId(value: string): boolean {
  return idSchema.safeParse(value).success;
}

/**
 * Reads and validates an incoming chat request. Never throws for bad input: failures
 * come back as a status code and a message that is safe to show to the visitor.
 *
 * `Sec-Fetch-Site` is set by browsers and scripts in a page cannot change it, and a page on
 * another site can only post JSON after a CORS check this server never allows. So another site
 * cannot use a visitor's browser to spend the visitor's or the site's live answers. A script
 * outside a browser can omit the header, so this protects visitors and does not stop scripts.
 */
export async function parseChatRequest(
  request: Request,
  limits: ChatLimits,
  text: ChatMessages,
): Promise<ParseChatRequestResult> {
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return reject(403, text.crossSite);
  }
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return reject(415, text.notJson);
  }

  let body: string | undefined;
  try {
    body = await readBodyWithLimit(request, limits.maxBodyBytes);
  } catch {
    // Usually a visitor who went away mid-request, so not a server error.
    return reject(400, text.unreadable);
  }
  if (body === undefined) return reject(413, text.tooLarge);

  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return reject(400, text.invalidJson);
  }

  const parsed = bodySchema.safeParse(data);
  if (!parsed.success) return reject(400, text.invalidConversation);

  const { id, message, parentId } = parsed.data;
  // Rebuilt from the validated fields only, so nothing else the client sent is kept.
  const parts = message.parts.map((part) => ({ type: "text" as const, text: part.text }));
  const messageText = textOf(parts);
  if (messageText.length > limits.maxMessageChars) {
    const maxChars = String(limits.maxMessageChars);
    return reject(413, text.messageTooLong.replaceAll("{maxChars}", maxChars));
  }
  if (messageText.trim() === "") return reject(400, text.noQuestion);

  return { ok: true, chatId: id, message: { id: message.id, role: "user", parts }, parentId };
}

/** The text a message part list holds; other parts count for nothing. */
export function textOf(parts: UIMessage["parts"]): string {
  return parts.map((part) => (part.type === "text" ? part.text : "")).join("");
}

function reject(status: number, message: string): ParseChatRequestResult {
  return { ok: false, status, message };
}

/**
 * Reads the body as UTF-8 text, stopping as soon as it exceeds `maxBytes`, so an
 * oversized body is never fully buffered or parsed. Returns `undefined` when too large.
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
