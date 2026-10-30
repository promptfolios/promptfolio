import { loadStructuredProfile, type Profile } from "@promptfolio/core";
import { describe, expect, it, vi } from "vitest";
import {
  buildChatSources,
  citedIds,
  evidenceIdsIn,
  OWNER_IDENTITY_CITATION,
  unverifiedIds,
  withSources,
} from "./citations";

const REPOSITORY_ID = "github.com/jordan-example/markdown-linter";
const OBSERVED = "2026-10-28T06:00:00.000Z";

function testProfile(): Profile {
  const loaded = loadStructuredProfile(
    {
      schemaVersion: 1,
      identity: { name: "Jordan Example", headline: "Engineer", summary: "Builds web tools." },
      experience: [
        { id: "globex-fullstack", organization: "Globex", title: "Engineer", start: "2023-09" },
      ],
      projects: [
        { id: "service-catalog", name: "Service Catalog", description: "A catalog." },
        { id: REPOSITORY_ID, name: "Markdown Linter", description: "My link checker." },
      ],
      education: [{ id: "example-university", institution: "Example U", credential: "BSc" }],
    },
    { sourceId: "owner-profile", label: "Owner's file", observedAt: new Date("2026-10-01") },
  );
  if (!loaded.ok) throw new Error("test profile is invalid");

  return {
    ...loaded.profile,
    sources: [
      ...loaded.profile.sources,
      { id: "github", kind: "github", label: "Public GitHub data", retrievedAt: OBSERVED },
    ],
    repositories: [
      {
        id: REPOSITORY_ID,
        name: "markdown-linter",
        fullName: "jordan-example/markdown-linter",
        url: "https://github.com/jordan-example/markdown-linter",
        languages: [],
        topics: [],
        fork: false,
        archived: false,
        provenance: { sourceId: "github", basis: "source-observed", observedAt: OBSERVED },
      },
    ],
  };
}

describe("citedIds", () => {
  it("finds bracketed ids, splits a drifted [a, b], and skips Markdown links", () => {
    expect(citedIds("A [service-catalog], B [a, b], [GitHub](https://github.com) [x]")).toEqual([
      "service-catalog",
      "a",
      "b",
      "x",
    ]);
  });

  it("lists an id once, and ignores empty parts", () => {
    expect(citedIds("[a] and [a] and [b,] and [ , ]")).toEqual(["a", "b"]);
  });

  it("does not treat brackets in code as citations", () => {
    expect(citedIds("Use `items[0]` here.\n```\nconst x = list[1];\n```\nDone [a].")).toEqual([
      "a",
    ]);
  });

  it("finds nothing in an answer without citations", () => {
    expect(citedIds("Jordan is an engineer.")).toEqual([]);
  });
});

describe("unverifiedIds", () => {
  it("accepts returned ids and the identity block, and nothing else", () => {
    const text = `A [one]. B [${OWNER_IDENTITY_CITATION}]. C [invented].`;

    expect(unverifiedIds(text, ["one"])).toEqual(["invented"]);
  });
});

describe("buildChatSources", () => {
  it("returns nothing for an answer that cites nothing", () => {
    expect(buildChatSources(testProfile(), "No citations here.", ["service-catalog"])).toBe(
      undefined,
    );
  });

  it("builds a verified record's entry from the profile", () => {
    expect(
      buildChatSources(testProfile(), "It lists a catalog [service-catalog].", ["service-catalog"]),
    ).toEqual({
      sources: [
        {
          id: "service-catalog",
          record: "Service Catalog",
          evidence: [
            {
              basis: "self-reported",
              source: "Owner's file",
              observedAt: "2026-10-01T00:00:00.000Z",
            },
          ],
        },
      ],
      unverifiedCitations: 0,
    });
  });

  it("names roles and education by what they are", () => {
    const text = "[globex-fullstack] [example-university]";
    const sources = buildChatSources(testProfile(), text, [
      "globex-fullstack",
      "example-university",
    ])?.sources;

    expect(sources?.map((source) => source.record)).toEqual(["Engineer, Globex", "BSc, Example U"]);
    // Neither has one place to point at, so no link.
    expect(sources?.some((source) => "url" in source)).toBe(false);
  });

  it("accepts the identity block without a lookup, with its own provenance", () => {
    const result = buildChatSources(testProfile(), "Builds tools [owner_identity].", []);

    expect(result).toEqual({
      sources: [
        {
          id: "owner_identity",
          record: "Jordan Example's profile summary",
          evidence: [expect.objectContaining({ basis: "self-reported", source: "Owner's file" })],
        },
      ],
      unverifiedCitations: 0,
    });
  });

  it("shows both the public source and the owner's notes for an annotated repository", () => {
    const result = buildChatSources(testProfile(), `See [${REPOSITORY_ID}].`, [REPOSITORY_ID]);

    expect(result?.sources[0]?.record).toBe("jordan-example/markdown-linter");
    expect(result?.sources[0]?.url).toBe("https://github.com/jordan-example/markdown-linter");
    expect(result?.sources[0]?.evidence.map(({ basis, source }) => [basis, source])).toEqual([
      ["source-observed", "Public GitHub data"],
      ["self-reported", "Owner's file"],
    ]);
  });

  it("counts a citation that is in the profile but was not returned in this turn", () => {
    const result = buildChatSources(testProfile(), "See [service-catalog].", []);

    expect(result).toEqual({ sources: [], unverifiedCitations: 1 });
  });

  it("counts a citation that is nowhere, and never repeats its text", () => {
    const result = buildChatSources(testProfile(), "See [made up by visitor].", []);

    expect(result).toEqual({ sources: [], unverifiedCitations: 1 });
    expect(JSON.stringify(result)).not.toContain("made up");
  });

  it("counts a returned id the profile does not hold, rather than inventing an entry", () => {
    expect(buildChatSources(testProfile(), "See [gone].", ["gone"])).toEqual({
      sources: [],
      unverifiedCitations: 1,
    });
  });

  it("handles a drifted [a, b] as two citations", () => {
    const result = buildChatSources(testProfile(), "[service-catalog, globex-fullstack]", [
      "service-catalog",
      "globex-fullstack",
    ]);

    expect(result?.sources.map((source) => source.id)).toEqual([
      "service-catalog",
      "globex-fullstack",
    ]);
  });
});

describe("evidenceIdsIn", () => {
  it("collects record ids from lists, fetched records, and role summaries, but not sources", () => {
    expect(
      evidenceIdsIn([
        {
          output: { status: "listed", records: [{ id: "a" }, { id: "b" }], sources: [{ id: "s" }] },
        },
        { output: { status: "found", record: { id: "c" }, role: { id: "d" } } },
        { output: { status: "not_found", id: "e" } },
        { output: "not an object" },
      ]),
    ).toEqual(["a", "b", "c", "d"]);
  });
});

describe("withSources", () => {
  async function run(chunks: Parameters<WritableStreamDefaultWriter["write"]>[0][]) {
    const logger = { info: vi.fn(), error: vi.fn() };
    const transform = withSources(testProfile(), "req", logger);
    const out: Array<Record<string, unknown>> = [];
    const reading = (async () => {
      for await (const chunk of transform.readable as unknown as AsyncIterable<
        Record<string, unknown>
      >) {
        out.push(chunk);
      }
    })();
    const writer = transform.writable.getWriter();
    for (const chunk of chunks) await writer.write(chunk);
    await writer.close();
    await reading;
    return { out, logger };
  }

  const finish = { type: "finish", finishReason: "stop" };

  it("adds the sources just before the finish chunk, from that turn's tool results", async () => {
    const { out, logger } = await run([
      {
        type: "tool-output-available",
        toolCallId: "c1",
        output: { records: [{ id: "service-catalog" }] },
      },
      { type: "text-delta", id: "t", delta: "A catalog [service-" },
      { type: "text-delta", id: "t", delta: "catalog]. And [invented]." },
      finish,
    ]);

    expect(out.map((chunk) => chunk.type)).toEqual([
      "tool-output-available",
      "text-delta",
      "text-delta",
      "data-sources",
      "finish",
    ]);
    const data = out[3]?.data as { sources: Array<{ id: string }>; unverifiedCitations: number };
    expect(data.sources.map((source) => source.id)).toEqual(["service-catalog"]);
    expect(data.unverifiedCitations).toBe(1);
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("citations"), {
      verified: 1,
      unverified: 1,
    });
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("invented");
  });

  it("adds nothing to an answer without citations, and still reports the counts", async () => {
    const { out, logger } = await run([{ type: "text-delta", id: "t", delta: "Hello." }, finish]);

    expect(out.map((chunk) => chunk.type)).toEqual(["text-delta", "finish"]);
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("citations"), {
      verified: 0,
      unverified: 0,
    });
  });

  it("adds nothing to a turn that never finishes", async () => {
    const { out } = await run([
      { type: "text-delta", id: "t", delta: "Partly [service-catalog]" },
      { type: "error", errorText: "failed" },
    ]);

    expect(out.map((chunk) => chunk.type)).toEqual(["text-delta", "error"]);
  });
});
