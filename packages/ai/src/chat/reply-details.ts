import { findRecordById, type Profile, type ProfileRecordMatch } from "@promptfolio/core";
import type { UIMessageChunk } from "ai";
import { getInputSchema, listInputSchema } from "../grounding/profile-tools.ts";

/**
 * What visitors may see of a reply besides its text. Off by default: without it, the browser
 * receives text only.
 */
export interface ReplyDetails {
  /**
   * Shows each profile lookup while the reply streams, as AI SDK tool parts with content the
   * server writes (see `visitorToolInput` and `visitorToolOutput`). Arguments as the model wrote
   * them, full results, and calls to tools the server does not have never reach the browser.
   */
  tools?: boolean;
  /**
   * The name to show for the model that answered, given its id: the id the provider reports, or
   * for a failover model the answering entry's label. Return `undefined` to show none. Called on
   * the server, so the id itself never reaches the browser. Must not throw.
   */
  model?: (modelId: string) => string | undefined;
}

/** The server's tools that visitors may see. A call to any other name is left out. */
const VISITOR_TOOL_NAMES = ["listProfileRecords", "getProfileRecord"] as const;
export type VisitorToolName = (typeof VISITOR_TOOL_NAMES)[number];

export function isVisitorToolName(name: unknown): name is VisitorToolName {
  return typeof name === "string" && (VISITOR_TOOL_NAMES as readonly string[]).includes(name);
}

/** A lookup's arguments as visitors see them: only values that cannot carry free text. */
export interface VisitorToolInput {
  /** `listProfileRecords` only: one of the schema's fixed sections. */
  section?: string;
  /** `listProfileRecords` only: a skill was given (never the skill itself). */
  skillFilter?: true;
}

/** `failed` covers invalid arguments and a tool that threw. */
export type VisitorToolStatus = "listed" | "found" | "not_found" | "limit_reached" | "failed";

/** A lookup's result as visitors see them. */
export interface VisitorToolOutput {
  status: VisitorToolStatus;
  /** For `found` only: the record's name, from the server's profile. */
  title?: string;
}

const TOOL_STATUSES: ReadonlySet<string> = new Set([
  "listed",
  "found",
  "not_found",
  "limit_reached",
]);

/**
 * The part of a call's input visitors may see, read by shape and checked against the tool's own
 * schema values. `getProfileRecord`'s id is left out, because the model writes it.
 */
export function visitorToolInput(toolName: VisitorToolName, input: unknown): VisitorToolInput {
  if (toolName !== "listProfileRecords" || typeof input !== "object" || input === null) return {};
  const section =
    "section" in input ? listInputSchema.shape.section.safeParse(input.section) : undefined;
  return {
    ...(section?.success && { section: section.data }),
    ...("skill" in input && input.skill !== undefined && { skillFilter: true }),
  };
}

/**
 * A call's result as visitors see it: the status, and for a record that was found, its name
 * looked up again in the profile. Nothing of the result itself is copied.
 */
export function visitorToolOutput(
  toolName: VisitorToolName,
  input: unknown,
  output: unknown,
  profile: Profile,
): VisitorToolOutput {
  const raw =
    typeof output === "object" && output !== null && "status" in output ? output.status : undefined;
  const status: VisitorToolStatus =
    typeof raw === "string" && TOOL_STATUSES.has(raw) ? (raw as VisitorToolStatus) : "failed";
  if (toolName !== "getProfileRecord" || status !== "found") return { status };
  const parsed = getInputSchema.safeParse(input);
  const match = parsed.success ? findRecordById(profile, parsed.data.id) : undefined;
  return match === undefined ? { status } : { status, title: recordTitle(match) };
}

function recordTitle(match: ProfileRecordMatch): string {
  switch (match.kind) {
    case "role":
      return `${match.record.title}, ${match.record.organization}`;
    case "education":
      return `${match.record.credential}, ${match.record.institution}`;
    case "project":
    case "repository":
      return match.record.name;
    case "contribution":
      return match.record.title;
  }
}

/**
 * Turns the tool chunks of one reply into the ones a visitor receives, each built from scratch
 * (see the table in ADR 0019). Returns the chunks to send, often none. Keeps per-call state, so
 * create one per stream.
 *
 * - `tool-input-start`: passed, so the call shows as running.
 * - `tool-input-delta`: dropped, because it is the arguments as the model writes them.
 * - `tool-input-available`: the safe input only. A `tool-input-start` is sent first if the
 *   provider sent none, so every call shows as running before its result.
 * - `tool-output-available`: `{ status, title? }`.
 * - `tool-input-error`, `tool-output-error`: become `tool-input-available` and
 *   `tool-output-available` with `{ status: "failed" }`, so every result has one shape.
 * - Calls to a tool the server does not have, and every other tool chunk type, are dropped.
 */
export function visitorToolChunks(profile: Profile): (chunk: UIMessageChunk) => UIMessageChunk[] {
  interface Call {
    toolName: VisitorToolName;
    input?: unknown;
    /** Its failure was already sent, after a `tool-input-error`. */
    failed?: boolean;
  }
  const calls = new Map<string, Call>();

  const started = (toolCallId: string, toolName: VisitorToolName): UIMessageChunk[] => {
    if (calls.has(toolCallId)) return [];
    calls.set(toolCallId, { toolName });
    return [{ type: "tool-input-start", toolCallId, toolName }];
  };

  return (chunk) => {
    switch (chunk.type) {
      case "tool-input-start":
        return isVisitorToolName(chunk.toolName) ? started(chunk.toolCallId, chunk.toolName) : [];
      case "tool-input-available":
      case "tool-input-error": {
        const { toolCallId, toolName } = chunk;
        if (!isVisitorToolName(toolName)) return [];
        const start = started(toolCallId, toolName);
        const failed = chunk.type === "tool-input-error";
        calls.set(toolCallId, { toolName, input: chunk.input, failed });
        return [
          ...start,
          {
            type: "tool-input-available",
            toolCallId,
            toolName,
            input: visitorToolInput(toolName, chunk.input),
          },
          ...(failed
            ? [{ type: "tool-output-available", toolCallId, output: FAILED } as const]
            : []),
        ];
      }
      case "tool-output-available": {
        const call = calls.get(chunk.toolCallId);
        if (call === undefined || call.failed || chunk.preliminary) return [];
        return [
          {
            type: "tool-output-available",
            toolCallId: chunk.toolCallId,
            output: visitorToolOutput(call.toolName, call.input, chunk.output, profile),
          },
        ];
      }
      case "tool-output-error": {
        const call = calls.get(chunk.toolCallId);
        if (call === undefined || call.failed) return [];
        return [{ type: "tool-output-available", toolCallId: chunk.toolCallId, output: FAILED }];
      }
      default:
        return [];
    }
  };
}

const FAILED: VisitorToolOutput = { status: "failed" };

/** Message metadata as the server stores it: the id of the model that answered the last step. */
export interface StoredReplyMetadata {
  modelId: string;
}

/** Message metadata as visitors see it. */
export interface VisitorReplyMetadata {
  model: string;
}

/**
 * The metadata visitors see for a stored or streamed message: the display name of the model that
 * answered, or `undefined` when there is none to show. Read by shape.
 */
export function visitorReplyMetadata(
  metadata: unknown,
  model: ReplyDetails["model"],
): VisitorReplyMetadata | undefined {
  if (model === undefined || typeof metadata !== "object" || metadata === null) return undefined;
  if (!("modelId" in metadata) || typeof metadata.modelId !== "string") return undefined;
  const name = model(metadata.modelId);
  return typeof name === "string" && name.trim() !== "" ? { model: name } : undefined;
}
