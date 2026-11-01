import { describe, expect, it } from "vitest";
import { loadStructuredProfile } from "./load.ts";
import { findRecordById, profileLinkUrls, recordsUsingSkill } from "./query.ts";
import type { Profile } from "./types.ts";

function testProfile(): Profile {
  const result = loadStructuredProfile(
    {
      schemaVersion: 1,
      identity: { name: "Jordan Example", headline: "Engineer", summary: "Builds things." },
      experience: [
        {
          id: "acme-frontend",
          organization: "Acme Corp",
          title: "Frontend Engineer",
          start: "2021-03",
          skills: ["TypeScript", "C++"],
        },
      ],
      projects: [
        {
          id: "service-catalog",
          name: "Service Catalog",
          description: "An internal catalog.",
          roleId: "acme-frontend",
          skills: ["typescript", "C#", "Rust"],
        },
      ],
      skills: [{ name: "TypeScript" }, { name: "C++" }, { name: "C#" }],
      education: [
        { id: "example-university", institution: "Example University", credential: "BSc" },
      ],
    },
    { sourceId: "owner-profile", label: "Test profile", observedAt: new Date("2026-10-01") },
  );
  if (!result.ok) throw new Error("test profile is invalid");
  return result.profile;
}

describe("profileLinkUrls", () => {
  const provenance = { sourceId: "s", basis: "source-observed", observedAt: "2026-10-01" } as const;

  it("collects the URLs of every structured field, normalized and without repeats", () => {
    const profile: Profile = {
      ...testProfile(),
      links: [{ label: "Site", url: "https://JORDAN.example", provenance }],
      repositories: [
        {
          id: "github.com/jordan/linter",
          name: "linter",
          fullName: "jordan/linter",
          url: "https://github.com/jordan/linter",
          homepage: "https://linter.example/",
          languages: [],
          topics: [],
          fork: false,
          archived: false,
          readme: "See https://attacker.example for more.",
          provenance,
        },
      ],
      contributions: [
        {
          id: "github.com/acme/parser/commit/abc",
          title: "Fix",
          url: "https://github.com/acme/parser/commit/abc",
          repositoryId: "github.com/acme/parser",
          repository: "acme/parser",
          repositoryUrl: "https://github.com/acme/parser",
          authored: "2026-01",
          provenance,
        },
      ],
      sources: [
        {
          id: "s",
          kind: "github",
          label: "GitHub",
          url: "https://github.com/jordan/linter",
          retrievedAt: "2026-10-01",
        },
      ],
    };

    expect(profileLinkUrls(profile)).toEqual([
      "https://jordan.example/",
      "https://github.com/jordan/linter",
      "https://linter.example/",
      "https://github.com/acme/parser/commit/abc",
      "https://github.com/acme/parser",
    ]);
  });

  it("has nothing for a profile without URLs", () => {
    expect(profileLinkUrls(testProfile())).toEqual([]);
  });
});

describe("findRecordById", () => {
  it("finds a role, a project, and an education entry with their kind", () => {
    const profile = testProfile();
    expect(findRecordById(profile, "acme-frontend")).toEqual({
      kind: "role",
      record: profile.experience[0],
    });
    expect(findRecordById(profile, "service-catalog")).toEqual({
      kind: "project",
      record: profile.projects[0],
    });
    expect(findRecordById(profile, "example-university")).toEqual({
      kind: "education",
      record: profile.education[0],
    });
  });

  it("returns undefined for an unknown id and does not guess near misses", () => {
    const profile = testProfile();
    expect(findRecordById(profile, "nasa-rover")).toBeUndefined();
    expect(findRecordById(profile, "Service-Catalog")).toBeUndefined();
    expect(findRecordById(profile, " service-catalog")).toBeUndefined();
    expect(findRecordById(profile, "")).toBeUndefined();
  });
});

describe("recordsUsingSkill", () => {
  it("matches skills case-insensitively", () => {
    const usage = recordsUsingSkill(testProfile(), "  TYPESCRIPT ");
    expect(usage.inProfile).toBe(true);
    expect(usage.roles.map((role) => role.id)).toEqual(["acme-frontend"]);
    expect(usage.projects.map((project) => project.id)).toEqual(["service-catalog"]);
  });

  it("keeps C, C++, and C# distinct", () => {
    const profile = testProfile();
    expect(recordsUsingSkill(profile, "C++").roles.map((role) => role.id)).toEqual([
      "acme-frontend",
    ]);
    expect(recordsUsingSkill(profile, "C++").projects).toEqual([]);
    expect(recordsUsingSkill(profile, "C#").projects.map((p) => p.id)).toEqual(["service-catalog"]);
    expect(recordsUsingSkill(profile, "C#").roles).toEqual([]);
    expect(recordsUsingSkill(profile, "C")).toEqual({
      inProfile: false,
      roles: [],
      projects: [],
      repositories: [],
    });
  });

  it("reports a skill that is not listed, even when a record mentions it", () => {
    const usage = recordsUsingSkill(testProfile(), "Rust");
    expect(usage.inProfile).toBe(false);
    expect(usage.projects.map((project) => project.id)).toEqual(["service-catalog"]);
  });

  it("returns empty matches for an unknown skill", () => {
    expect(recordsUsingSkill(testProfile(), "Haskell")).toEqual({
      inProfile: false,
      roles: [],
      projects: [],
      repositories: [],
    });
  });
});
