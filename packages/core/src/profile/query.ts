import { skillKey } from "./load";
import type { Education, Profile, Project, Role } from "./types";

/** A record found by id, tagged with the section it belongs to. */
export type ProfileRecordMatch =
  | { kind: "role"; record: Role }
  | { kind: "project"; record: Project }
  | { kind: "education"; record: Education };

/** Roles and projects that list a skill, and whether the skill itself is listed. */
export interface SkillUsage {
  /** Whether `Profile.skills` lists the skill. */
  inProfile: boolean;
  roles: Role[];
  projects: Project[];
}

/**
 * Finds a role, project, or education entry by its id. Ids share one namespace, so at most
 * one record matches.
 *
 * Matching is exact: ids are lowercase by schema, and a near miss (other casing, extra
 * spaces) returns `undefined` rather than a guess.
 */
export function findRecordById(profile: Profile, id: string): ProfileRecordMatch | undefined {
  const role = profile.experience.find((record) => record.id === id);
  if (role) return { kind: "role", record: role };
  const project = profile.projects.find((record) => record.id === id);
  if (project) return { kind: "project", record: project };
  const education = profile.education.find((record) => record.id === id);
  if (education) return { kind: "education", record: education };
  return undefined;
}

/**
 * Finds the roles and projects that list a skill, compared with `skillKey` (case and
 * spacing ignored, symbols kept, so `C` and `C++` stay distinct).
 *
 * A record may list a skill that `Profile.skills` does not (a load warning, not an error),
 * so `inProfile` is reported separately from the matches.
 */
export function recordsUsingSkill(profile: Profile, skill: string): SkillUsage {
  const key = skillKey(skill);
  const usesSkill = (record: { skills: string[] }) =>
    record.skills.some((name) => skillKey(name) === key);
  return {
    inProfile: profile.skills.some((entry) => skillKey(entry.name) === key),
    roles: profile.experience.filter(usesSkill),
    projects: profile.projects.filter(usesSkill),
  };
}
