import { skillKey } from "./load";
import type { Contribution, Education, Profile, Project, Repository, Role } from "./types";

/** A record found by id, tagged with the section it belongs to. */
export type ProfileRecordMatch =
  | { kind: "role"; record: Role }
  | { kind: "project"; record: Project }
  | { kind: "education"; record: Education }
  /** `ownerNotes` is the owner's project with the same id, if there is one. */
  | { kind: "repository"; record: Repository; ownerNotes?: Project }
  /** `ownerNotes` is the owner's project whose id is the contribution's `repositoryId`. */
  | { kind: "contribution"; record: Contribution; ownerNotes?: Project };

/** Records that list or match a skill, and whether the skill itself is listed. */
export interface SkillUsage {
  /** Whether `Profile.skills` lists the skill. */
  inProfile: boolean;
  roles: Role[];
  projects: Project[];
  /** Repositories with the skill among their languages or topics. Adds nothing to `inProfile`. */
  repositories: Repository[];
}

/**
 * Finds a role, project, education entry, repository, or contribution by its id. Ids share one namespace,
 * with one exception: a project may share a repository's id, as the owner's description of
 * that repository. Then the repository is returned with the project as `ownerNotes`. A
 * contribution is returned with the project for its repository, if there is one.
 *
 * Matching is exact: ids are lowercase by schema, and a near miss (other casing, extra
 * spaces) returns `undefined` rather than a guess.
 */
export function findRecordById(profile: Profile, id: string): ProfileRecordMatch | undefined {
  const repository = profile.repositories.find((record) => record.id === id);
  if (repository) {
    const ownerNotes = profile.projects.find((record) => record.id === id);
    return { kind: "repository", record: repository, ...(ownerNotes && { ownerNotes }) };
  }
  const contribution = profile.contributions.find((record) => record.id === id);
  if (contribution) {
    const ownerNotes = profile.projects.find((record) => record.id === contribution.repositoryId);
    return { kind: "contribution", record: contribution, ...(ownerNotes && { ownerNotes }) };
  }
  const role = profile.experience.find((record) => record.id === id);
  if (role) return { kind: "role", record: role };
  const project = profile.projects.find((record) => record.id === id);
  if (project) return { kind: "project", record: project };
  const education = profile.education.find((record) => record.id === id);
  if (education) return { kind: "education", record: education };
  return undefined;
}

/**
 * Finds the roles and projects that list a skill, and the repositories whose languages or
 * topics match it, compared with `skillKey` (case and spacing ignored, symbols kept, so `C`
 * and `C++` stay distinct).
 *
 * A record may list a skill that `Profile.skills` does not (a load warning, not an error),
 * so `inProfile` is reported separately from the matches. A repository's language is not a
 * skill claim, so repositories never make `inProfile` true.
 */
export function recordsUsingSkill(profile: Profile, skill: string): SkillUsage {
  const key = skillKey(skill);
  const usesSkill = (record: { skills: string[] }) =>
    record.skills.some((name) => skillKey(name) === key);
  const matchesRepository = (repository: Repository) =>
    repository.languages.some((language) => skillKey(language.name) === key) ||
    repository.topics.some((topic) => skillKey(topic) === key);
  return {
    inProfile: profile.skills.some((entry) => skillKey(entry.name) === key),
    roles: profile.experience.filter(usesSkill),
    projects: profile.projects.filter(usesSkill),
    repositories: profile.repositories.filter(matchesRepository),
  };
}
