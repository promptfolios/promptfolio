import type { z } from "zod";
import { type ParsedProfileInput, profileInputSchema } from "./schema";
import type { Profile, Provenance, SourceRef } from "./types";

/** A problem found while loading a profile, located by a path such as `experience[0].end`. */
export interface ProfileIssue {
  path: string;
  message: string;
}

export type ProfileLoadResult =
  | { ok: true; profile: Profile; warnings: ProfileIssue[] }
  | { ok: false; issues: ProfileIssue[] };

/** Describes the structured source the profile data was read from. */
export interface StructuredProfileSource {
  /** Stable id for the source, referenced by every record's provenance. */
  sourceId: string;
  /** Human-readable description, for example "Owner-provided profile file". */
  label: string;
  /** When the source data was observed, for example the file's modification time. */
  observedAt: Date;
  url?: string;
}

/**
 * Validates structured, owner-provided profile data and normalizes it into the
 * canonical `Profile`, stamping every record with `self-reported` provenance.
 *
 * Invalid data never produces a profile: all validation problems are returned as
 * issues. Non-fatal problems, such as references to skills that are not listed,
 * are returned as warnings alongside the profile.
 *
 * @param data Untrusted input, typically parsed JSON.
 * @param source Describes where the data came from. Supplied by the application.
 * @throws {TypeError} If `source` is invalid (a programming error, not a data error).
 */
export function loadStructuredProfile(
  data: unknown,
  source: StructuredProfileSource,
): ProfileLoadResult {
  assertValidSource(source);

  const parsed = profileInputSchema.safeParse(data);
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.map(toProfileIssue) };
  }

  const input = parsed.data;
  const issues = [...findDuplicateRecordIds(input), ...findDuplicateSkills(input)];
  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    profile: normalize(input, source),
    warnings: findDanglingReferences(input),
  };
}

/** Skills are identified by name, ignoring case and surrounding or repeated whitespace. */
export function skillKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function assertValidSource(source: StructuredProfileSource): void {
  if (source.sourceId.trim() === "") {
    throw new TypeError("source.sourceId must not be empty");
  }
  if (Number.isNaN(source.observedAt.getTime())) {
    throw new TypeError("source.observedAt must be a valid date");
  }
}

/** Internal to the package; shared with `addObservedRecords`. */
export function toProfileIssue(issue: z.core.$ZodIssue): ProfileIssue {
  return { path: formatPath(issue.path), message: issue.message };
}

function formatPath(path: readonly PropertyKey[]): string {
  let result = "";
  for (const segment of path) {
    if (typeof segment === "number") {
      result += `[${segment}]`;
    } else {
      result += result === "" ? String(segment) : `.${String(segment)}`;
    }
  }
  return result === "" ? "(root)" : result;
}

/** Role, project, and education ids share one namespace so any record can be cited by id. */
function findDuplicateRecordIds(input: ParsedProfileInput): ProfileIssue[] {
  const idsAt = (section: string, records: { id: string }[]) =>
    records.map((record, index) => ({ id: record.id, path: `${section}[${index}].id` }));
  const records = [
    ...idsAt("experience", input.experience),
    ...idsAt("projects", input.projects),
    ...idsAt("education", input.education),
  ];

  const firstPathById = new Map<string, string>();
  const issues: ProfileIssue[] = [];
  for (const { id, path } of records) {
    const firstPath = firstPathById.get(id);
    if (firstPath === undefined) {
      firstPathById.set(id, path);
    } else {
      issues.push({ path, message: `Duplicate id '${id}' (already used at ${firstPath})` });
    }
  }
  return issues;
}

function findDuplicateSkills(input: ParsedProfileInput): ProfileIssue[] {
  const firstIndexByKey = new Map<string, number>();
  const issues: ProfileIssue[] = [];
  input.skills.forEach((skill, index) => {
    const key = skillKey(skill.name);
    const firstIndex = firstIndexByKey.get(key);
    if (firstIndex === undefined) {
      firstIndexByKey.set(key, index);
    } else {
      issues.push({
        path: `skills[${index}].name`,
        message: `Duplicate skill '${skill.name}' (already listed at skills[${firstIndex}])`,
      });
    }
  });
  return issues;
}

function findDanglingReferences(input: ParsedProfileInput): ProfileIssue[] {
  const knownSkills = new Set(input.skills.map((skill) => skillKey(skill.name)));
  const knownRoles = new Set(input.experience.map((role) => role.id));
  const warnings: ProfileIssue[] = [];

  const checkSkills = (skills: string[], basePath: string): void => {
    skills.forEach((name, index) => {
      if (!knownSkills.has(skillKey(name))) {
        warnings.push({
          path: `${basePath}.skills[${index}]`,
          message: `Skill '${name}' is not listed in skills`,
        });
      }
    });
  };

  input.experience.forEach((role, index) => {
    checkSkills(role.skills, `experience[${index}]`);
  });
  input.projects.forEach((project, index) => {
    checkSkills(project.skills, `projects[${index}]`);
    if (project.roleId !== undefined && !knownRoles.has(project.roleId)) {
      warnings.push({
        path: `projects[${index}].roleId`,
        message: `Role '${project.roleId}' does not exist in experience`,
      });
    }
  });

  return warnings;
}

function normalize(input: ParsedProfileInput, source: StructuredProfileSource): Profile {
  const observedAt = source.observedAt.toISOString();
  // A fresh object per record, so modifying one record's provenance cannot affect another.
  const provenance = (): Provenance => ({
    sourceId: source.sourceId,
    basis: "self-reported",
    observedAt,
  });

  const sourceRef: SourceRef = {
    id: source.sourceId,
    kind: "structured-file",
    label: source.label,
    retrievedAt: observedAt,
    ...(source.url !== undefined && { url: source.url }),
  };

  return {
    schemaVersion: input.schemaVersion,
    identity: { ...input.identity, provenance: provenance() },
    links: input.links.map((link) => ({ ...link, provenance: provenance() })),
    experience: input.experience.map((role) => ({ ...role, provenance: provenance() })),
    projects: input.projects.map((project) => ({
      ...project,
      links: project.links.map((link) => ({ ...link })),
      provenance: provenance(),
    })),
    skills: input.skills.map((skill) => ({ ...skill, provenance: provenance() })),
    education: input.education.map((entry) => ({ ...entry, provenance: provenance() })),
    // Owners do not write repositories; source adapters add them (`addObservedRecords`).
    repositories: [],
    sources: [sourceRef],
  };
}
