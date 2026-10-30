import type { UIMessage } from "ai";
import { z } from "zod";
import { CHAT_LIMITS } from "./limits";

/**
 * The only message parts accepted from the browser. `step-start` is a content-free
 * marker the AI SDK adds to assistant messages. `data-sources` is the sources block the server
 * itself sent with an earlier answer. Both are accepted and then dropped, so the sources never
 * reach the model, and a forged one has no effect.
 * Every other part type (files, tools, reasoning, other data) is rejected.
 */
const partSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("step-start") }),
  z.object({ type: z.literal("data-sources") }),
]);

const messageSchema = z.object({
  id: z.string().max(200),
  // "system" is deliberately not accepted: the server owns the instructions.
  role: z.enum(["user", "assistant"]),
  parts: z.array(partSchema),
});

/** Why the client sent the request: a new message, or a new answer to the last one. */
export type ChatTrigger = "submit-message" | "regenerate-message";

/**
 * The accepted request body. Only `messages` and `trigger` are read; every other field the
 * client sends (such as `system`, `tools`, or `messageId`) is stripped by zod.
 *
 * `trigger` is metadata, not content: a missing or unknown value means `submit-message`
 * instead of rejecting the request. It only decides whether a prepared answer may be used.
 */
const bodySchema = z.object({
  messages: z.array(messageSchema).min(1).max(CHAT_LIMITS.maxMessages),
  trigger: z
    .enum(["submit-message", "regenerate-message"])
    .optional()
    .catch(undefined)
    .transform((trigger): ChatTrigger => trigger ?? "submit-message"),
});

export type ParseChatRequestResult =
  | { ok: true; messages: UIMessage[]; trigger: ChatTrigger }
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
export async function parseChatRequest(request: Request): Promise<ParseChatRequestResult> {
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return reject(403, "This request is not allowed.");
  }
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return reject(415, "The request must be JSON.");
  }

  const text = await readBodyWithLimit(request, CHAT_LIMITS.maxBodyBytes);
  if (text === undefined) return reject(413, "The request is too large.");

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return reject(400, "The request body is not valid JSON.");
  }

  const parsed = bodySchema.safeParse(data);
  if (!parsed.success) return reject(400, "The request does not contain a valid conversation.");

  let totalChars = 0;
  let lastText = "";
  const messages: UIMessage[] = [];
  for (const message of parsed.data.messages) {
    const textParts = message.parts.flatMap((part) =>
      part.type === "text" ? [{ type: "text" as const, text: part.text }] : [],
    );
    const text = textParts.map((part) => part.text).join("");
    if (message.role === "user" && text.length > CHAT_LIMITS.maxMessageChars) {
      return reject(413, `A message is longer than ${CHAT_LIMITS.maxMessageChars} characters.`);
    }
    totalChars += text.length;
    lastText = text;
    messages.push({ id: message.id, role: message.role, parts: textParts });
  }

  if (totalChars > CHAT_LIMITS.maxTotalChars) {
    return reject(413, "The conversation is too long. Please start a new chat.");
  }

  if (messages.at(-1)?.role !== "user" || lastText.trim() === "") {
    return reject(400, "The conversation must end with a question.");
  }

  return { ok: true, messages, trigger: parsed.data.trigger };
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
