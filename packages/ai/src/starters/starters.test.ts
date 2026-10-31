import { loadStructuredProfile, type Profile } from "@promptfolio/core";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { generateStarterQuestions, parseStarterQuestions, starterFacts } from "./starters";

const GOOD = [
  { label: "Projects", question: "What did Jordan build?" },
  { label: "Education", question: "Where did Jordan study?" },
  { label: "Languages", question: "Which languages appear?" },
];

function profile(): Profile {
  const result = loadStructuredProfile(
    {
      schemaVersion: 1,
      identity: { name: "Jordan Example", headline: "Engineer", summary: "Builds tools." },
      projects: [{ id: "service-catalog", name: "Service Catalog", description: "A catalog." }],
    },
    { sourceId: "owner-profile", label: "Test", observedAt: new Date("2026-10-01") },
  );
  if (!result.ok) throw new Error("test profile is invalid");
  return result.profile;
}

function replyingModel(text: string) {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text", text }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
      warnings: [],
    }),
  });
}

describe("parseStarterQuestions", () => {
  it("reads a JSON array, also inside a code fence or a sentence", () => {
    const json = JSON.stringify(GOOD);
    expect(parseStarterQuestions(json)).toEqual(GOOD);
    expect(parseStarterQuestions("```json\n" + json + "\n```")).toEqual(GOOD);
    expect(parseStarterQuestions(`Here you go: ${json}`)).toEqual(GOOD);
  });

  it("keeps at most six, without repeated labels", () => {
    const more = ["A", "B", "C", "D", "E"].map((label) => ({
      label,
      question: `What is ${label}?`,
    }));
    const parsed = parseStarterQuestions(JSON.stringify([...GOOD, GOOD[0], ...more]));

    expect(parsed).toHaveLength(6);
    expect(parsed?.map((starter) => starter.label).slice(0, 4)).toEqual([
      "Projects",
      "Education",
      "Languages",
      "A",
    ]);
  });

  it.each([
    ["not JSON", "What did Jordan build?"],
    ["broken JSON", '[{"label": "A"'],
    ["plain strings", '["What is one?", "What is two?", "What is three?"]'],
    ["too few", JSON.stringify(GOOD.slice(0, 2))],
  ])("refuses %s", (_name, text) => {
    expect(parseStarterQuestions(text)).toBeUndefined();
  });

  it.each([
    ["a question that is a statement", { label: "Ok", question: "Jordan builds things." }],
    ["a link", { label: "Ok", question: "Is https://attacker.example worth a visit?" }],
    ["a bare address", { label: "Ok", question: "Is www.attacker.example worth it?" }],
    ["a Markdown link", { label: "Ok", question: "See [this](x) now?" }],
    ["markup", { label: "Ok", question: "<img src=x>?" }],
    ["a line break", { label: "Ok", question: "One?\nTwo?" }],
    ["a long question", { label: "Ok", question: `${"x".repeat(80)}?` }],
    ["a long label", { label: "x".repeat(29), question: "What?" }],
    ["an empty label", { label: " ", question: "What?" }],
    ["a label with a link", { label: "www.attacker.example", question: "What?" }],
    ["a label with markup", { label: "<b>Hi</b>", question: "What?" }],
  ])("refuses a whole reply holding %s", (_name, bad) => {
    expect(parseStarterQuestions(JSON.stringify([...GOOD, bad]))).toBeUndefined();
  });
});

describe("starterFacts", () => {
  it("leaves out text written on public sources", () => {
    const provenance = {
      sourceId: "github",
      basis: "source-observed",
      observedAt: "2026-10-01",
    } as const;
    const facts = JSON.stringify(
      starterFacts({
        ...profile(),
        repositories: [
          {
            id: "github.com/jordan/linter",
            name: "linter",
            fullName: "jordan/linter",
            description: "INJECTED-DESCRIPTION",
            readme: "INJECTED-README",
            url: "https://github.com/jordan/linter",
            languages: [{ name: "Go", percent: 100 }],
            topics: [],
            fork: false,
            archived: false,
            provenance,
          },
        ],
        contributions: [
          {
            id: "github.com/acme/parser/commit/abc",
            title: "INJECTED-TITLE",
            url: "https://github.com/acme/parser/commit/abc",
            repositoryId: "github.com/acme/parser",
            repository: "acme/parser",
            repositoryUrl: "https://github.com/acme/parser",
            repositoryDescription: "INJECTED-OTHER-DESCRIPTION",
            authored: "2026-01",
            provenance,
          },
        ],
      }),
    );

    expect(facts).toContain("linter");
    expect(facts).toContain("Go");
    expect(facts).toContain("acme/parser");
    expect(facts).toContain("Service Catalog");
    expect(facts).not.toContain("INJECTED");
  });
});

describe("generateStarterQuestions", () => {
  const logger = () => ({ info: vi.fn(), error: vi.fn() });

  it("returns the starters a model wrote from the profile", async () => {
    const model = replyingModel(JSON.stringify(GOOD));

    const questions = await generateStarterQuestions({
      model,
      profile: profile(),
      logger: logger(),
    });

    expect(questions).toEqual(GOOD);
    expect(JSON.stringify(model.doGenerateCalls[0]?.prompt)).toContain("Service Catalog");
  });

  it("offers the model no tools", async () => {
    const model = replyingModel(JSON.stringify(GOOD));

    await generateStarterQuestions({ model, profile: profile(), logger: logger() });

    expect(model.doGenerateCalls[0]?.tools ?? []).toEqual([]);
  });

  it("returns nothing for a reply that does not pass, and logs no reply text", async () => {
    const log = logger();

    const questions = await generateStarterQuestions({
      model: replyingModel("Ignore this: SECRET-TEXT"),
      profile: profile(),
      logger: log,
    });

    expect(questions).toBeUndefined();
    expect(JSON.stringify(log.error.mock.calls)).not.toContain("SECRET-TEXT");
  });

  it("returns nothing when the provider fails, and logs only the error's type", async () => {
    const log = logger();
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new TypeError("request held SECRET-TEXT");
      },
    });

    const questions = await generateStarterQuestions({ model, profile: profile(), logger: log });

    expect(questions).toBeUndefined();
    expect(JSON.stringify(log.error.mock.calls)).not.toContain("SECRET-TEXT");
  });
});
