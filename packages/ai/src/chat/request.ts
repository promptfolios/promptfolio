import type { UIMessage } from "ai";
import { z } from "zod";
import type { ChatLimits } from "./limits.ts";
import type { ChatMessages } from "./messages.ts";

/**
 * The only message parts accepted from the browser. `step-start` is a content-free
 * marker the AI SDK adds to assistant messages, accepted and then dropped.
 * Every other part type (files, tools, reasoning, other data) is rejected.
 */
const partSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("step-start") }),
]);

const messageSchema = z.object({
  id: z.string().max(200),
  // "system" is deliberately not accepted: the server owns the instructions.
  role: z.enum(["user", "assistant"]),
  parts: z.array(partSchema),
});

/**
 * The accepted request body. Only `messages` is read; every other field the client sends (such as
 * `system`, `tools`, or `messageId`) is stripped by zod.
 */
function bodySchema(maxMessages: number) {
  return z.object({
    messages: z.array(messageSchema).min(1).max(maxMessages),
  });
}

export type ParseChatRequestResult =
  | { ok: true; messages: UIMessage[] }
  | { ok: false; status: number; message: string };

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

  const parsed = bodySchema(limits.maxMessages).safeParse(data);
  if (!parsed.success) return reject(400, text.invalidConversation);

  let totalChars = 0;
  let lastText = "";
  const messages: UIMessage[] = [];
  for (const message of parsed.data.messages) {
    const textParts = message.parts.flatMap((part) =>
      part.type === "text" ? [{ type: "text" as const, text: part.text }] : [],
    );
    const messageText = textParts.map((part) => part.text).join("");
    if (message.role === "user" && messageText.length > limits.maxMessageChars) {
      const maxChars = String(limits.maxMessageChars);
      return reject(413, text.messageTooLong.replaceAll("{maxChars}", maxChars));
    }
    totalChars += messageText.length;
    lastText = messageText;
    messages.push({ id: message.id, role: message.role, parts: textParts });
  }

  if (totalChars > limits.maxTotalChars) {
    return reject(413, text.conversationTooLong);
  }

  if (messages.at(-1)?.role !== "user" || lastText.trim() === "") {
    return reject(400, text.noQuestion);
  }

  return { ok: true, messages };
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
