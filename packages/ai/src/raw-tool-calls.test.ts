import type { UIMessageChunk } from "ai";
import { describe, expect, it, vi } from "vitest";
import { withoutRawToolCalls } from "./raw-tool-calls";

const ERROR = "could not answer";

/** Runs one text part, split into these deltas, through the filter. */
async function run(...deltas: string[]) {
  const onBlocked = vi.fn();
  const chunks: UIMessageChunk[] = [
    { type: "text-start", id: "t1" },
    ...deltas.map((delta): UIMessageChunk => ({ type: "text-delta", id: "t1", delta })),
    { type: "text-end", id: "t1" },
    { type: "finish", finishReason: "stop" },
  ];
  const stream = new ReadableStream<UIMessageChunk>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  }).pipeThrough(withoutRawToolCalls({ errorText: ERROR, onBlocked }));

  const out: UIMessageChunk[] = [];
  for await (const chunk of stream) out.push(chunk);
  return {
    onBlocked,
    out,
    text: out.flatMap((chunk) => (chunk.type === "text-delta" ? [chunk.delta] : [])).join(""),
    errors: out.flatMap((chunk) => (chunk.type === "error" ? [chunk.errorText] : [])),
  };
}

describe("withoutRawToolCalls", () => {
  it.each([
    ["<tool_call>", "<tool_call>\n<function=listProfileRecords>\n</function>\n</tool_call>"],
    ["<function=", "<function=listProfileRecords>"],
    ["another case", "<TOOL_CALL>"],
  ])("blocks a whole marker: %s", async (_name, text) => {
    const { text: visible, errors, onBlocked } = await run(text);

    expect(visible).toBe("");
    expect(errors).toEqual([ERROR]);
    expect(onBlocked).toHaveBeenCalledOnce();
  });

  it("blocks a marker split across chunks, without showing any of it", async () => {
    const { text, errors } = await run("<to", "ol_c", "all>", '{"name":"x"}');

    expect(text).toBe("");
    expect(errors).toEqual([ERROR]);
  });

  it("keeps the normal text before a marker, and drops all text after it", async () => {
    const { text, errors } = await run("Let me check. <tool", "_call>secret", " more text");

    expect(text).toBe("Let me check. ");
    expect(errors).toEqual([ERROR]);
  });

  it("still ends the text part and the stream after blocking", async () => {
    const { out } = await run("<tool_call>");

    expect(out.map((chunk) => chunk.type)).toEqual(["text-start", "error", "text-end", "finish"]);
  });

  it("passes ordinary text with a less-than sign through in the same chunk", async () => {
    const { out, errors, onBlocked } = await run("When a < b and x <y> holds.");

    expect(out[1]).toEqual({ type: "text-delta", id: "t1", delta: "When a < b and x <y> holds." });
    expect(errors).toEqual([]);
    expect(onBlocked).not.toHaveBeenCalled();
  });

  it("holds only what could start a marker, and releases it when it does not", async () => {
    const { out, text, errors } = await run("Compare a <to", "ols list.");

    expect(out[1]).toEqual({ type: "text-delta", id: "t1", delta: "Compare a " });
    expect(text).toBe("Compare a <tools list.");
    expect(errors).toEqual([]);
  });

  it("releases held text when the part ends", async () => {
    const { text, errors } = await run("Ends with <tool");

    expect(text).toBe("Ends with <tool");
    expect(errors).toEqual([]);
  });
});
