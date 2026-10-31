import { describe, expect, it } from "vitest";
import { canonicalProfileContent, profileFingerprint } from "./canonical";
import { loadStructuredProfile } from "./load";
import type { Profile } from "./types";

function testProfile(observedAt = new Date("2026-10-01"), label = "Test profile"): Profile {
  const result = loadStructuredProfile(
    {
      schemaVersion: 1,
      identity: { name: "Jordan Example", headline: "Engineer", summary: "Builds things." },
      links: [{ label: "GitHub", url: "https://github.com/example" }],
      experience: [
        {
          id: "acme-frontend",
          organization: "Acme Corp",
          title: "Frontend Engineer",
          start: "2021-03",
          skills: ["TypeScript"],
        },
      ],
      projects: [
        {
          id: "service-catalog",
          name: "Service Catalog",
          description: "An internal catalog.",
          outcomes: ["Fewer support requests."],
          skills: ["TypeScript"],
        },
        { id: "markdown-linter", name: "Markdown Linter", description: "A linter." },
      ],
      skills: [{ name: "TypeScript" }],
    },
    { sourceId: "owner-profile", label, observedAt },
  );
  if (!result.ok) throw new Error("test profile is invalid");
  return result.profile;
}

/** Rebuilds every object with its keys in reverse order. */
function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([key, child]) => [key, reverseKeys(child)]),
  );
}

describe("profileFingerprint", () => {
  it("is stable for the same content and ignores observation times", async () => {
    const fingerprint = await profileFingerprint(testProfile());

    expect(fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(await profileFingerprint(testProfile())).toBe(fingerprint);
    expect(await profileFingerprint(testProfile(new Date("2027-01-01")))).toBe(fingerprint);
  });

  it("changes when the content changes", async () => {
    expect(await profileFingerprint(testProfile(undefined, "Another label"))).not.toBe(
      await profileFingerprint(testProfile()),
    );
  });
});

describe("canonicalProfileContent", () => {
  it("does not depend on object key order", () => {
    const profile = testProfile();
    const reversed = reverseKeys(profile) as Profile;
    expect(JSON.stringify(reversed)).not.toBe(JSON.stringify(profile));
    expect(canonicalProfileContent(reversed)).toBe(canonicalProfileContent(profile));
  });

  it("changes when any single fact changes", () => {
    const base = canonicalProfileContent(testProfile());
    const edits: Array<(profile: Profile) => void> = [
      (p) => {
        p.identity.summary = "Builds other things.";
      },
      (p) => {
        for (const role of p.experience) role.title = "Senior Frontend Engineer";
      },
      (p) => {
        for (const project of p.projects) project.outcomes.push("More support requests.");
      },
      (p) => {
        for (const skill of p.skills) skill.category = "Languages";
      },
      (p) => {
        for (const link of p.links) link.url = "https://github.com/other";
      },
      (p) => {
        p.identity.provenance.basis = "derived";
      },
    ];
    for (const edit of edits) {
      const profile = testProfile();
      edit(profile);
      expect(canonicalProfileContent(profile)).not.toBe(base);
    }
    expect(canonicalProfileContent(testProfile(undefined, "Another label"))).not.toBe(base);
  });

  it("changes when records are reordered", () => {
    const profile = testProfile();
    const base = canonicalProfileContent(profile);
    profile.projects.reverse();
    expect(canonicalProfileContent(profile)).not.toBe(base);
  });

  it("ignores observation timestamps", () => {
    const earlier = canonicalProfileContent(testProfile(new Date("2026-10-01")));
    const later = canonicalProfileContent(testProfile(new Date("2027-01-15")));
    expect(later).toBe(earlier);
    expect(earlier).not.toContain("observedAt");
    expect(earlier).not.toContain("retrievedAt");
  });
});
