import type { UIMessageChunk } from "ai";

/**
 * How a model writes a tool call as text, seen when it wants another lookup and none is allowed.
 * Only these forms are recognised, and other models may have others. Lower case, because matching
 * ignores case.
 */
const RAW_TOOL_CALL_MARKERS = ["<tool_call", "<function="] as const;

export interface RawToolCallOptions {
  /** Sent to the visitor in place of the raw text. */
  errorText: string;
  onBlocked: () => void;
}

/**
 * Stops a tool call written as text from reaching the visitor. Model output is untrusted, and this
 * text means nothing to a visitor and shows them tool names and arguments.
 *
 * Text streams as it arrives, except for the end of a chunk that could be the start of a marker,
 * which waits for the next chunk. On a match, the text from the marker on and all later text are
 * dropped, and the visitor gets the error. Text already sent stays, because it cannot be recalled.
 */
export function withoutRawToolCalls({
  errorText,
  onBlocked,
}: RawToolCallOptions): TransformStream<UIMessageChunk, UIMessageChunk> {
  let held = "";
  let heldId = "";
  let blocked = false;
  return new TransformStream({
    transform(chunk, controller) {
      if (chunk.type === "text-delta") {
        if (blocked) return;
        const text = held + chunk.delta;
        heldId = chunk.id;
        const start = markerStart(text);
        if (start !== -1) {
          held = "";
          blocked = true;
          if (start > 0) {
            controller.enqueue({ type: "text-delta", id: chunk.id, delta: text.slice(0, start) });
          }
          controller.enqueue({ type: "error", errorText });
          onBlocked();
          return;
        }
        const safe = text.length - possibleMarkerLength(text);
        held = text.slice(safe);
        if (safe > 0) {
          controller.enqueue({ type: "text-delta", id: chunk.id, delta: text.slice(0, safe) });
        }
        return;
      }
      // The part ended, so what was held turned out to be ordinary text.
      if (chunk.type === "text-end" && held !== "") {
        controller.enqueue({ type: "text-delta", id: chunk.id, delta: held });
        held = "";
      }
      controller.enqueue(chunk);
    },
    flush(controller) {
      if (held !== "") controller.enqueue({ type: "text-delta", id: heldId, delta: held });
    },
  });
}

function markerStart(text: string): number {
  const lower = text.toLowerCase();
  const starts = RAW_TOOL_CALL_MARKERS.map((marker) => lower.indexOf(marker)).filter(
    (index) => index !== -1,
  );
  return starts.length === 0 ? -1 : Math.min(...starts);
}

/** The length of the longest end of `text` that a marker could continue from. */
function possibleMarkerLength(text: string): number {
  const lower = text.toLowerCase();
  const longest = Math.max(...RAW_TOOL_CALL_MARKERS.map((marker) => marker.length));
  for (let length = Math.min(longest - 1, lower.length); length > 0; length -= 1) {
    const end = lower.slice(-length);
    if (RAW_TOOL_CALL_MARKERS.some((marker) => marker.startsWith(end))) return length;
  }
  return 0;
}
