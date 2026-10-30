import type { ChatSources } from "@promptfolio/ai";
import { z } from "zod";

/** The message part that carries an answer's sources, as the server sends it. */
export const SOURCES_PART_TYPE = "data-sources";

/**
 * The sources of one answer. They arrive from the server or back from browser storage, which can be
 * old or edited by hand, so they are checked before they are saved or shown. The type annotation
 * keeps this in step with what the server sends.
 */
export const chatSourcesSchema: z.ZodType<ChatSources> = z.object({
  sources: z
    .array(
      z.object({
        id: z.string().max(300),
        record: z.string().max(500),
        url: z.string().max(2048).optional(),
        evidence: z
          .array(
            z.object({
              basis: z.enum(["self-reported", "source-observed", "derived"]),
              source: z.string().max(500),
              observedAt: z.string().max(40),
            }),
          )
          .max(5),
      }),
    )
    .max(100),
  unverifiedCitations: z.number().int().min(0),
});

/**
 * The messages to send to the server, without their sources. The server has no use for them, and
 * they would otherwise count against the request's size limit on every later message in a thread.
 */
export function withoutSources<T extends { parts: ReadonlyArray<{ type: string }> }>(
  messages: readonly T[],
): T[] {
  return messages.map((message) => ({
    ...message,
    parts: message.parts.filter((part) => part.type !== SOURCES_PART_TYPE),
  }));
}
