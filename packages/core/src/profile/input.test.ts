import { describe, expect, expectTypeOf, it } from "vitest";
import type { z } from "zod";
import type { ProfileInput } from "./input.ts";
import { loadStructuredProfile } from "./load.ts";
import type { profileInputSchema } from "./schema.ts";

describe("ProfileInput", () => {
  it("matches the input shape of the validation schema", () => {
    // Checked by `pnpm typecheck`: fails when the schema changes and these types do not.
    expectTypeOf<ProfileInput>().toEqualTypeOf<z.input<typeof profileInputSchema>>();
  });

  it("types a profile that leaves out every defaulted list", () => {
    const minimal = {
      schemaVersion: 1,
      identity: { name: "Jordan Example", headline: "Engineer", summary: "Builds things." },
      experience: [{ id: "acme", organization: "Acme Corp", title: "Engineer", start: "2021" }],
    } satisfies ProfileInput;

    const result = loadStructuredProfile(minimal, {
      sourceId: "owner-profile",
      label: "Owner-provided profile file",
      observedAt: new Date("2026-10-01T12:00:00.000Z"),
    });
    expect(result.ok).toBe(true);
  });
});
