import { describe, expect, it } from "vitest";
import { loadStructuredProfile, type StructuredProfileSource, skillKey } from "./load.ts";
import { LIMITS } from "./schema.ts";

const source: StructuredProfileSource = {
  sourceId: "owner-profile",
  label: "Owner-provided profile file",
  observedAt: new Date("2026-10-01T12:00:00.000Z"),
};

/** A fictional, complete profile. Returns a fresh object so tests can modify it freely. */
function fullInput() {
  return {
    schemaVersion: 1,
    identity: {
      name: "  Jordan Example  ",
      headline: "Full-stack engineer",
      summary: "Builds web applications with TypeScript.",
      location: "Remote",
    },
    links: [{ label: "GitHub", url: "https://github.com/jordan-example" }],
    experience: [
      {
        id: "acme-frontend",
        organization: "Acme Corp",
        title: "Frontend Engineer",
        start: "2021-03",
        end: "2023-08",
        highlights: ["Led the migration to React."],
        links: [{ label: "Product", url: "https://example.com/acme-product" }],
        skills: ["TypeScript", "react"],
      },
    ],
    projects: [
      {
        id: "promptfolio",
        name: "Promptfolio",
        description: "A conversational portfolio.",
        roleId: "acme-frontend",
        outcomes: ["Published as open source."],
        links: [{ label: "Repository", url: "https://github.com/jordan-example/promptfolio" }],
        skills: ["TypeScript"],
      },
    ],
    skills: [{ name: "TypeScript", category: "Languages" }, { name: "React" }],
    education: [
      {
        id: "state-university",
        institution: "State University",
        credential: "BSc",
        field: "Computer Science",
        start: "2017",
        end: "2021",
      },
    ],
  };
}

function minimalInput() {
  return {
    schemaVersion: 1,
    identity: { name: "Jordan Example", headline: "Engineer", summary: "Writes software." },
  };
}

/** Loads input that is expected to be invalid and returns its issues. */
function issuesFor(data: unknown) {
  const result = loadStructuredProfile(data, source);
  if (result.ok) {
    throw new Error("Expected loading to fail");
  }
  return result.issues;
}

describe("loadStructuredProfile: valid input", () => {
  it("loads a complete profile and trims text", () => {
    const result = loadStructuredProfile(fullInput(), source);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual([]);
    expect(result.profile.identity.name).toBe("Jordan Example");
    expect(result.profile.experience[0]?.id).toBe("acme-frontend");
    expect(result.profile.experience[0]?.links).toEqual([
      { label: "Product", url: "https://example.com/acme-product" },
    ]);
    expect(result.profile.projects[0]?.roleId).toBe("acme-frontend");
  });

  it("stamps every record with self-reported provenance from the source", () => {
    const result = loadStructuredProfile(fullInput(), source);
    if (!result.ok) throw new Error("Expected loading to succeed");
    const { profile } = result;

    const expected = {
      sourceId: "owner-profile",
      basis: "self-reported",
      observedAt: "2026-10-01T12:00:00.000Z",
    };
    const records = [
      profile.identity,
      ...profile.links,
      ...profile.experience,
      ...profile.projects,
      ...profile.skills,
      ...profile.education,
    ];
    expect(records.length).toBe(7);
    for (const record of records) {
      expect(record.provenance).toEqual(expected);
    }
  });

  it("registers the source that every provenance entry refers to", () => {
    const result = loadStructuredProfile(fullInput(), {
      ...source,
      url: "https://example.com/profile.json",
    });
    if (!result.ok) throw new Error("Expected loading to succeed");

    expect(result.profile.sources).toEqual([
      {
        id: "owner-profile",
        kind: "structured-file",
        label: "Owner-provided profile file",
        url: "https://example.com/profile.json",
        retrievedAt: "2026-10-01T12:00:00.000Z",
      },
    ]);
  });

  it("does not modify the input", () => {
    const input = fullInput();
    const snapshot = JSON.parse(JSON.stringify(input));

    loadStructuredProfile(input, source);

    expect(input).toEqual(snapshot);
  });

  it("accepts a year-only end date in the same year as a month start date", () => {
    const input = fullInput();
    const role = input.experience[0];
    if (!role) throw new Error("fixture");
    role.start = "2021-05";
    role.end = "2021";

    expect(loadStructuredProfile(input, source).ok).toBe(true);
  });
});

describe("loadStructuredProfile: incomplete input", () => {
  it("loads a profile with only identity, using empty lists for missing sections", () => {
    const result = loadStructuredProfile(minimalInput(), source);
    if (!result.ok) throw new Error("Expected loading to succeed");

    expect(result.profile.experience).toEqual([]);
    expect(result.profile.projects).toEqual([]);
    expect(result.profile.skills).toEqual([]);
    expect(result.profile.education).toEqual([]);
    expect(result.profile.links).toEqual([]);
    expect(result.profile.repositories).toEqual([]);
  });

  it("warns, but still loads, when a record references an unlisted skill", () => {
    const input = fullInput();
    input.projects[0]?.skills.push("Rust");

    const result = loadStructuredProfile(input, source);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual([
      { path: "projects[0].skills[1]", message: "Skill 'Rust' is not listed in skills" },
    ]);
  });

  it("warns, but still loads, when a project references an unknown role", () => {
    const input = fullInput();
    const project = input.projects[0];
    if (!project) throw new Error("fixture");
    project.roleId = "missing-role";

    const result = loadStructuredProfile(input, source);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual([
      { path: "projects[0].roleId", message: "Role 'missing-role' does not exist in experience" },
    ]);
  });
});

describe("loadStructuredProfile: invalid input", () => {
  it.each([
    ["null", null],
    ["a string", "profile"],
    ["an array", []],
  ])("rejects %s", (_label, data) => {
    expect(issuesFor(data)).toEqual([{ path: "(root)", message: expect.any(String) }]);
  });

  it("rejects a missing name with its path", () => {
    const input = fullInput();
    const { name: _name, ...identity } = input.identity;

    expect(issuesFor({ ...input, identity })).toEqual([
      { path: "identity.name", message: expect.any(String) },
    ]);
  });

  it("rejects whitespace-only text", () => {
    const input = fullInput();
    input.identity.headline = "   ";

    expect(issuesFor(input).map((issue) => issue.path)).toEqual(["identity.headline"]);
  });

  it("rejects unknown keys, so typos are caught", () => {
    const input = { ...fullInput(), sumary: "typo" };

    expect(issuesFor(input)).toEqual([
      { path: "(root)", message: expect.stringContaining("sumary") },
    ]);
  });

  it("rejects an unsupported schema version", () => {
    expect(issuesFor({ ...fullInput(), schemaVersion: 2 }).map((issue) => issue.path)).toEqual([
      "schemaVersion",
    ]);
  });

  it("rejects wrong types", () => {
    const input = { ...fullInput(), skills: "TypeScript" };

    expect(issuesFor(input).map((issue) => issue.path)).toEqual(["skills"]);
  });

  it("rejects malformed dates and an end date before the start date", () => {
    const input = fullInput();
    const role = input.experience[0];
    const education = input.education[0];
    if (!role || !education) throw new Error("fixture");
    role.start = "2021-13";
    education.start = "2021";
    education.end = "2019";

    expect(issuesFor(input)).toEqual([
      { path: "experience[0].start", message: "Expected a date in YYYY or YYYY-MM format" },
      { path: "education[0].end", message: "End date is before start date" },
    ]);
  });

  it("rejects non-http URLs", () => {
    const input = fullInput();
    const link = input.links[0];
    if (!link) throw new Error("fixture");
    link.url = "javascript:alert(1)";

    expect(issuesFor(input).map((issue) => issue.path)).toEqual(["links[0].url"]);
  });

  it("rejects non-http URLs in a role's links", () => {
    const input = fullInput();
    const link = input.experience[0]?.links[0];
    if (!link) throw new Error("fixture");
    link.url = "javascript:alert(1)";

    expect(issuesFor(input).map((issue) => issue.path)).toEqual(["experience[0].links[0].url"]);
  });

  it("rejects ids that are not lowercase slugs", () => {
    const input = fullInput();
    const role = input.experience[0];
    if (!role) throw new Error("fixture");
    role.id = "Acme Frontend";

    expect(issuesFor(input).map((issue) => issue.path)).toContain("experience[0].id");
  });

  it("accepts source keys as ids, such as a project describing a repository", () => {
    const input = fullInput();
    const [project] = input.projects;
    if (!project) throw new Error("fixture");
    project.id = "github.com/jordan-example/jordan-example.github.io";

    const result = loadStructuredProfile(input, source);
    if (!result.ok) throw new Error("Expected loading to succeed");
    expect(result.profile.projects[0]?.id).toBe(project.id);
  });

  it.each([
    "GitHub.com/jordan/promptfolio",
    "github.com",
    "github.com/",
    "https://github.com/jordan/promptfolio",
    "github.com/jordan/..",
    "github/jordan",
    `github.com/jordan/${"a".repeat(200)}`,
  ])("rejects the malformed source key %s", (id) => {
    const input = fullInput();
    const [project] = input.projects;
    if (!project) throw new Error("fixture");
    project.id = id;

    expect(issuesFor(input).map((issue) => issue.path)).toContain("projects[0].id");
  });

  it("rejects a missing record id", () => {
    const input = fullInput();
    const [project] = input.projects;
    if (!project) throw new Error("fixture");
    const { id: _id, ...projectWithoutId } = project;

    expect(issuesFor({ ...input, projects: [projectWithoutId] }).map((i) => i.path)).toEqual([
      "projects[0].id",
    ]);
  });

  it("rejects duplicate ids across roles, projects, and education", () => {
    const input = fullInput();
    const education = input.education[0];
    if (!education) throw new Error("fixture");
    education.id = "promptfolio";

    expect(issuesFor(input)).toEqual([
      {
        path: "education[0].id",
        message: "Duplicate id 'promptfolio' (already used at projects[0].id)",
      },
    ]);
  });

  it("rejects skills that differ only in case or spacing", () => {
    const input = fullInput();
    input.skills.push({ name: " typescript " });

    expect(issuesFor(input)).toEqual([
      {
        path: "skills[2].name",
        message: "Duplicate skill 'typescript' (already listed at skills[0])",
      },
    ]);
  });

  it("rejects text and lists over their size limits", () => {
    const input = fullInput();
    input.identity.summary = "x".repeat(LIMITS.longText + 1);
    input.skills = Array.from({ length: LIMITS.listItems + 1 }, (_, i) => ({ name: `Skill ${i}` }));

    expect(issuesFor(input).map((issue) => issue.path)).toEqual(["identity.summary", "skills"]);
  });

  it("reports every problem at once", () => {
    const input = fullInput();
    input.identity.name = "";
    input.identity.headline = "";

    expect(issuesFor(input).length).toBe(2);
  });
});

describe("loadStructuredProfile: source validation", () => {
  it("throws for an empty source id", () => {
    expect(() => loadStructuredProfile(minimalInput(), { ...source, sourceId: " " })).toThrow(
      TypeError,
    );
  });

  it("throws for an invalid observation date", () => {
    expect(() =>
      loadStructuredProfile(minimalInput(), { ...source, observedAt: new Date("invalid") }),
    ).toThrow(TypeError);
  });
});

describe("skillKey", () => {
  it("ignores case and surrounding or repeated whitespace", () => {
    expect(skillKey("  Type   Script ")).toBe("type script");
  });

  it("keeps symbols, so similar names stay distinct", () => {
    expect(new Set(["C", "C++", "C#"].map(skillKey)).size).toBe(3);
  });
});
