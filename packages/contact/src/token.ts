import { z } from "zod";
import { type ContactDraft, draftContentSchema } from "./request";

/**
 * A confirmation token is `payload.signature`: the draft and an expiry, signed with HMAC-SHA-256.
 * The server stores nothing, and `send` needs nothing but the token, so the text cannot change
 * between the review and the send. The token is signed, not encrypted: it holds only what the
 * visitor typed, and it goes only to that visitor's browser.
 *
 * It proves the content passed `prepare` unchanged. It does not prove that a person read it.
 */

const payloadSchema = z.strictObject({
  v: z.literal(1),
  /** Milliseconds since the epoch. */
  exp: z.number().int(),
  draft: draftContentSchema,
});

export type VerifyTokenResult =
  | { ok: true; draft: ContactDraft }
  | { ok: false; reason: "invalid" | "expired" };

export async function signContactToken(
  draft: ContactDraft,
  expiresAt: number,
  secret: string,
): Promise<string> {
  const payload = toBase64Url(
    new TextEncoder().encode(JSON.stringify({ v: 1, exp: expiresAt, draft })),
  );
  const key = await importKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return `${payload}.${toBase64Url(new Uint8Array(signature))}`;
}

export async function verifyContactToken(
  token: string,
  now: number,
  secret: string,
): Promise<VerifyTokenResult> {
  const [payload, signature, ...rest] = token.split(".");
  if (!payload || !signature || rest.length > 0) return { ok: false, reason: "invalid" };

  const signatureBytes = fromBase64Url(signature);
  if (!signatureBytes) return { ok: false, reason: "invalid" };

  // `verify` compares in constant time, and nothing in the payload is read before it passes.
  const key = await importKey(secret);
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    signatureBytes,
    new TextEncoder().encode(payload),
  );
  if (!valid) return { ok: false, reason: "invalid" };

  const parsed = payloadSchema.safeParse(parsePayload(payload));
  if (!parsed.success) return { ok: false, reason: "invalid" };
  if (parsed.data.exp <= now) return { ok: false, reason: "expired" };
  return { ok: true, draft: parsed.data.draft };
}

function importKey(secret: string) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function parsePayload(payload: string): unknown {
  const bytes = fromBase64Url(payload);
  if (!bytes) return undefined;
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return undefined;
  }
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | undefined {
  try {
    const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return undefined;
  }
}
