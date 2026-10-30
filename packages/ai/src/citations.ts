import { type ClaimBasis, findRecordById, type Profile, type Provenance } from "@promptfolio/core";
import type { UIMessageChunk } from "ai";
import type { ChatLogger } from "./chat-turn";

/**
 * Citations and their proof. The model cites ids in square brackets. The server then checks them
 * against the records the tools returned in that turn, and builds the sources from the profile, so
 * the model cannot write its own proof. This shows where a fact comes from, not that the sentence
 * restates it correctly.
 */

/**
 * The citation for the identity block in the system prompt. It is always available, because the
 * model reads that block on every turn. Record ids cannot contain an underscore, so it cannot
 * collide with one.
 */
export const OWNER_IDENTITY_CITATION = "owner_identity";

/** Where one cited record comes from. A repository with owner notes has two sources. */
export interface SourceEvidence {
  basis: ClaimBasis;
  /** The source's label, as written in the profile. */
  source: string;
  /** ISO 8601 timestamp at which the source data was observed. */
  observedAt: string;
}

export interface CitedSource {
  id: string;
  /** A short name for the record. */
  record: string;
  /** Where the visitor can see the record itself, if it has one place: a repository or a commit. */
  url?: string;
  evidence: SourceEvidence[];
}

/** What the browser receives as a `data-sources` chunk, after an answer's text. */
export interface ChatSources {
  sources: CitedSource[];
  /** Citations that match nothing returned in this turn. Their text is not repeated. */
  unverifiedCitations: number;
}

/**
 * The ids an answer cites: the content of every `[...]` that is not a Markdown link, split at commas
 * because models sometimes write `[a, b]`. Code is skipped, where brackets are not citations.
 */
export function citedIds(text: string): string[] {
  const withoutCode = text.replace(/```[\s\S]*?```|`[^`\n]*`/g, "");
  const ids = Array.from(withoutCode.matchAll(/\[([^[\]]+)\](?!\()/g)).flatMap((match) =>
    (match[1] ?? "").split(",").map((id) => id.trim()),
  );
  return [...new Set(ids.filter((id) => id !== ""))];
}

/**
 * The record ids in profile tool results: listed records, a fetched record, and the role
 * summary that comes with a project. Source ids are not record ids and are not collected.
 */
export function evidenceIdsIn(toolResults: ReadonlyArray<{ output: unknown }>): string[] {
  const ids = new Set<string>();
  const add = (value: unknown) => {
    if (isObject(value) && typeof value.id === "string") ids.add(value.id);
  };
  for (const { output } of toolResults) {
    if (!isObject(output)) continue;
    if (Array.isArray(output.records)) output.records.forEach(add);
    add(output.record);
    add(output.role);
    add(output.ownerNotes);
  }
  return [...ids];
}

/** Cited ids with nothing behind them: not the identity block, and not returned in this turn. */
export function unverifiedIds(text: string, returnedIds: readonly string[]): string[] {
  return citedIds(text).filter((id) => id !== OWNER_IDENTITY_CITATION && !returnedIds.includes(id));
}

/**
 * Builds the sources for an answer from the profile, for the cited ids that are verified. Returns
 * `undefined` when the answer cites nothing, as there is then nothing to show.
 */
export function buildChatSources(
  profile: Profile,
  text: string,
  returnedIds: readonly string[],
): ChatSources | undefined {
  const cited = citedIds(text);
  if (cited.length === 0) return undefined;

  const unverified = new Set(unverifiedIds(text, returnedIds));
  const sources = cited.flatMap((id) => {
    if (unverified.has(id)) return [];
    const source = citedSource(profile, id);
    if (source === undefined) unverified.add(id);
    return source === undefined ? [] : [source];
  });
  return { sources, unverifiedCitations: unverified.size };
}

function citedSource(profile: Profile, id: string): CitedSource | undefined {
  const toEvidence = ({ basis, sourceId, observedAt }: Provenance): SourceEvidence => ({
    basis,
    source: profile.sources.find((source) => source.id === sourceId)?.label ?? sourceId,
    observedAt,
  });

  if (id === OWNER_IDENTITY_CITATION) {
    const { name, provenance } = profile.identity;
    return { id, record: `${name}'s profile summary`, evidence: [toEvidence(provenance)] };
  }

  const match = findRecordById(profile, id);
  if (match === undefined) return undefined;
  switch (match.kind) {
    case "role": {
      const { title, organization, provenance } = match.record;
      return { id, record: `${title}, ${organization}`, evidence: [toEvidence(provenance)] };
    }
    case "project":
      return { id, record: match.record.name, evidence: [toEvidence(match.record.provenance)] };
    case "education": {
      const { credential, institution, provenance } = match.record;
      return { id, record: `${credential}, ${institution}`, evidence: [toEvidence(provenance)] };
    }
    case "repository":
    case "contribution": {
      // The owner's notes may be what the sentence relies on, so they are shown as well: naming
      // only the public source would claim it shows more than it does.
      const provenances = [match.record.provenance, match.ownerNotes?.provenance];
      const record = match.kind === "repository" ? match.record.fullName : match.record.title;
      return {
        id,
        record,
        url: match.record.url,
        evidence: provenances.flatMap((item) => (item ? [toEvidence(item)] : [])),
      };
    }
  }
}

/** The chunk that carries the sources. `forVisitor` lets this type through. */
export function sourcesChunk(sources: ChatSources): UIMessageChunk {
  return { type: "data-sources", id: "sources", data: sources };
}

/**
 * Watches a turn's tool results and text, and adds the sources just before the stream finishes.
 * A turn that fails has no `finish`, so it has no sources. Only counts are logged, because a cited
 * id is model text and can repeat what a visitor wrote.
 */
export function withSources(
  profile: Profile,
  requestId: string,
  logger: ChatLogger,
): TransformStream<UIMessageChunk, UIMessageChunk> {
  const returnedIds = new Set<string>();
  let text = "";
  return new TransformStream({
    transform(chunk, controller) {
      if (chunk.type === "tool-output-available") {
        for (const id of evidenceIdsIn([chunk])) returnedIds.add(id);
      } else if (chunk.type === "text-delta") {
        text += chunk.delta;
      } else if (chunk.type === "finish") {
        const sources = buildChatSources(profile, text, [...returnedIds]);
        logger.info(`[chat ${requestId}] citations`, {
          verified: sources?.sources.length ?? 0,
          unverified: sources?.unverifiedCitations ?? 0,
        });
        if (sources !== undefined) controller.enqueue(sourcesChunk(sources));
      }
      controller.enqueue(chunk);
    },
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
