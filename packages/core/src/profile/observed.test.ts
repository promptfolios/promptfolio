import { describe, expect, it } from "vitest";
import { canonicalProfileContent } from "./canonical";
import { loadStructuredProfile } from "./load";
import { addObservedRecords, type ObservedRecords, type RepositoryInput } from "./observed";
import { findRecordById, recordsUsingSkill } from "./query";
import type { Profile } from "./types";

const REPO_ID = "github.com/jordan-example/markdown-linter";

function ownerProfile(): Profile {
  const result = loadStructuredProfile(
    {
      schemaVersion: 1,
      identity: { name: "Jordan Example", headline: "Engineer", summary: "Builds things." },
      links: [{ label: "GitHub", url: "https://github.com/Jordan-Example/" }],
      experience: [
        { id: "acme-frontend", organization: "Acme", title: "Engineer", start: "2021-03" },
      ],
      projects: [
        {
          id: REPO_ID,
          name: "Markdown Linter",
          description: "My link checker.",
          responsibilities: ["Sole maintainer."],
        },
      ],
      skills: [{ name: "Go" }],
      education: [{ id: "example-university", institution: "Example U", credential: "BSc" }],
    },
    { sourceId: "owner-profile", label: "Owner file", observedAt: new Date("2026-10-01") },
  );
  if (!result.ok) throw new Error("test profile is invalid");
  return result.profile;
}

function repository(overrides: Partial<RepositoryInput> = {}): RepositoryInput {
  return {
    id: REPO_ID,
    name: "markdown-linter",
    fullName: "jordan-example/markdown-linter",
    description: "Checks Markdown files for broken links.",
    url: "https://github.com/jordan-example/markdown-linter",
    languages: [
      { name: "TypeScript", percent: 92 },
      { name: "Shell", percent: 8 },
    ],
    topics: ["markdown", "linter"],
    fork: false,
    archived: false,
    created: "2024-02",
    lastActivity: "2026-09",
    license: "MIT",
    readme: "# Markdown Linter\n\nFinds broken links.",
    ...overrides,
  };
}

function observed(overrides: Partial<ObservedRecords> = {}): ObservedRecords {
  return {
    source: {
      id: "github",
      kind: "github",
      label: "Public GitHub data for @jordan-example",
      url: "https://github.com/jordan-example",
      retrievedAt: new Date("2026-10-28T06:00:00.000Z"),
    },
    links: [{ label: "GitHub", url: "https://github.com/jordan-example" }],
    repositories: [repository()],
    ...overrides,
  };
}

function merged(records = observed(), profile = ownerProfile()): Profile {
  const result = addObservedRecords(profile, records);
  if (!result.ok) throw new Error(`Expected merging to succeed: ${JSON.stringify(result.issues)}`);
  return result.profile;
}

function issuesFor(records: ObservedRecords, profile = ownerProfile()) {
  const result = addObservedRecords(profile, records);
  if (result.ok) throw new Error("Expected merging to fail");
  return result.issues;
}

describe("addObservedRecords", () => {
  it("adds repositories stamped source-observed and registers the source", () => {
    const profile = merged();

    expect(profile.repositories).toHaveLength(1);
    expect(profile.repositories[0]?.provenance).toEqual({
      sourceId: "github",
      basis: "source-observed",
      observedAt: "2026-10-28T06:00:00.000Z",
    });
    expect(profile.sources.map((source) => source.id)).toEqual(["owner-profile", "github"]);
    expect(profile.sources[1]).toEqual({
      id: "github",
      kind: "github",
      label: "Public GitHub data for @jordan-example",
      url: "https://github.com/jordan-example",
      retrievedAt: "2026-10-28T06:00:00.000Z",
    });
  });

  it("does not modify the input profile and gives every record its own provenance", () => {
    const original = ownerProfile();
    const before = JSON.stringify(original);
    const profile = merged(
      observed({ repositories: [repository(), repository({ id: `${REPO_ID}-2` })] }),
      original,
    );

    expect(JSON.stringify(original)).toBe(before);
    expect(profile.repositories[0]?.provenance).not.toBe(profile.repositories[1]?.provenance);
  });

  it("keeps the owner's link when the source observes the same URL", () => {
    const profile = merged();
    expect(profile.links).toHaveLength(1);
    expect(profile.links[0]?.provenance.basis).toBe("self-reported");
  });

  it("adds an observed link the owner does not list", () => {
    const profile = merged(
      observed({ links: [{ label: "Website", url: "https://jordan.example.com" }] }),
    );
    expect(profile.links.map((link) => link.provenance.basis)).toEqual([
      "self-reported",
      "source-observed",
    ]);
  });

  it("keeps an owner project with a repository's id as a separate record", () => {
    const profile = merged();
    expect(profile.projects[0]?.provenance.basis).toBe("self-reported");
    expect(findRecordById(profile, REPO_ID)).toEqual({
      kind: "repository",
      record: profile.repositories[0],
      ownerNotes: profile.projects[0],
    });
  });

  it("warns about an owner project on the same host that matches no repository", () => {
    const result = addObservedRecords(ownerProfile(), observed({ repositories: [] }));
    if (!result.ok) throw new Error("Expected merging to succeed");

    expect(result.warnings).toEqual([
      { path: "projects[0].id", message: expect.stringContaining(REPO_ID) },
    ]);
    expect(result.profile.projects).toHaveLength(1);
  });

  it("rejects a repository id used by a role, education entry, or another repository", () => {
    const issues = issuesFor(
      observed({
        repositories: [repository(), repository()],
      }),
    );
    expect(issues).toEqual([
      { path: "repositories[1].id", message: expect.stringContaining("a repository") },
    ]);

    const profile = ownerProfile();
    const [role] = profile.experience;
    if (!role) throw new Error("fixture");
    role.id = REPO_ID;
    expect(issuesFor(observed(), profile)).toEqual([
      { path: "repositories[0].id", message: expect.stringContaining("a role") },
    ]);
  });

  it("rejects a source id that is already in the profile", () => {
    const records = observed();
    records.source.id = "owner-profile";
    expect(issuesFor(records).map((issue) => issue.path)).toEqual(["source.id"]);
  });

  it.each([
    ["an invalid id", { id: "markdown-linter" }, "repositories[0].id"],
    ["an invalid URL", { url: "javascript:alert(1)" }, "repositories[0].url"],
    ["an invalid date", { lastActivity: "2026-13" }, "repositories[0].lastActivity"],
    ["a README over 3,000 characters", { readme: "x".repeat(3001) }, "repositories[0].readme"],
    [
      "a share over 100 percent",
      { languages: [{ name: "Go", percent: 101 }] },
      "repositories[0].languages[0].percent",
    ],
  ])("rejects %s", (_name, overrides, path) => {
    const issues = issuesFor(observed({ repositories: [repository(overrides)] }));
    expect(issues.map((issue) => issue.path)).toContain(path);
  });

  it("rejects unknown keys and more than 100 repositories", () => {
    const withExtra = { ...repository(), stars: 5 } as RepositoryInput;
    expect(issuesFor(observed({ repositories: [withExtra] })).map((i) => i.path)).toEqual([
      "repositories[0]",
    ]);

    const many = Array.from({ length: 101 }, (_, index) =>
      repository({ id: `${REPO_ID}-${index}` }),
    );
    expect(issuesFor(observed({ repositories: many })).map((i) => i.path)).toEqual([
      "repositories",
    ]);
  });

  it("throws for an invalid source, which is a programming error", () => {
    const records = observed();
    records.source.retrievedAt = new Date("not a date");
    expect(() => addObservedRecords(ownerProfile(), records)).toThrow(TypeError);
  });
});

describe("repositories in lookups", () => {
  it("matches a skill by language or topic, without listing the skill", () => {
    const profile = merged();
    const typescript = recordsUsingSkill(profile, "typescript");
    expect(typescript.repositories.map((entry) => entry.id)).toEqual([REPO_ID]);
    expect(typescript.inProfile).toBe(false);
    expect(recordsUsingSkill(profile, "Markdown").repositories).toHaveLength(1);
    expect(recordsUsingSkill(profile, "Go").repositories).toEqual([]);
  });
});

describe("canonical content of observed records", () => {
  it("does not change when only the retrieval time changes", () => {
    const later = observed();
    later.source.retrievedAt = new Date("2026-10-29T06:00:00.000Z");
    expect(canonicalProfileContent(merged(later))).toBe(canonicalProfileContent(merged()));
  });

  it("changes when a README or the last activity changes", () => {
    const base = canonicalProfileContent(merged());
    expect(
      canonicalProfileContent(merged(observed({ repositories: [repository({ readme: "New." })] }))),
    ).not.toBe(base);
    expect(
      canonicalProfileContent(
        merged(observed({ repositories: [repository({ lastActivity: "2026-10" })] })),
      ),
    ).not.toBe(base);
  });
});
