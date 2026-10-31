import { afterEach, describe, expect, it, vi } from "vitest";
import { loadAppProfile } from "./profile";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("a second profile, by configuration alone", () => {
  it("loads a different person from data, with no code change", async () => {
    vi.stubEnv("PROMPTFOLIO_PROFILE_FILE", "second.profile.json");

    const { fileName, result } = await loadAppProfile();

    expect(fileName).toBe("second.profile.json");
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.warnings).toEqual([]);
    expect(result.profile.identity.name).toBe("Morgan Sample");
    expect(result.profile.projects.map((project) => project.id)).toEqual(["benefits-form"]);
    expect(result.profile.repositories).toEqual([]);
  });
});
