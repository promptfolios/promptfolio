import "server-only";
import { z } from "zod";

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export function emptyResponse(status: number): Response {
  return new Response(null, { status, headers: { "cache-control": "no-store" } });
}

/** A store failure: only the error's type is logged, because it can repeat a store credential. */
export function historyUnavailable(action: string, error: unknown): Response {
  console.error(`[chat] history ${action} failed`, {
    name: error instanceof Error ? error.name : "unknown",
  });
  return json({ error: "Conversations are not available right now." }, 503);
}

/**
 * Whether a request that changes a conversation came from another site. The owner cookie is
 * `SameSite=Lax`, so browsers do not send it then anyway; this refuses such a request outright.
 */
export function isCrossSite(request: Request): boolean {
  return request.headers.get("sec-fetch-site") === "cross-site";
}

/** What a visitor may change about a conversation. */
export const chatChangesSchema = z
  .strictObject({
    title: z.string().trim().min(1).max(100).optional(),
    status: z.enum(["regular", "archived"]).optional(),
  })
  .refine((changes) => changes.title !== undefined || changes.status !== undefined);

/** Reads a small JSON body; `undefined` if it is not JSON or too large. */
export async function readSmallJson(request: Request, maxChars = 1_000): Promise<unknown> {
  try {
    const text = await request.text();
    if (text.length > maxChars) return undefined;
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
