import type { Profile } from "./types";

/**
 * Fields that record *when* something was observed, not *what* was observed. They change
 * without any fact changing: today `observedAt` is the profile file's modification time,
 * which moves on every save and every `git checkout`.
 */
const OBSERVATION_TIME_KEYS: ReadonlySet<string> = new Set(["observedAt", "retrievedAt"]);

/**
 * A stable JSON serialization of the profile's content, for comparing two profiles or
 * fingerprinting one (for example, to tell whether a prepared answer is still current).
 *
 * - Object keys are sorted, so the result does not depend on how the profile was built.
 * - Array order is kept: the order of records is part of the profile.
 * - Observation timestamps (`provenance.observedAt`, `sources[].retrievedAt`) are left out,
 *   so re-reading unchanged data gives the same result.
 * - `undefined` properties are skipped, as `JSON.stringify` does.
 */
export function canonicalProfileContent(profile: Profile): string {
  return JSON.stringify(canonicalize(profile));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || value === null) return value;

  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const child = (value as Record<string, unknown>)[key];
    if (OBSERVATION_TIME_KEYS.has(key) || child === undefined) continue;
    sorted[key] = canonicalize(child);
  }
  return sorted;
}
