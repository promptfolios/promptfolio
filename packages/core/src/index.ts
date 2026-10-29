/**
 * Public entry point of `@promptfolio/core`.
 *
 * Only what is exported here is part of the public API.
 */
export {
  loadStructuredProfile,
  type ProfileIssue,
  type ProfileLoadResult,
  type StructuredProfileSource,
  skillKey,
} from "./profile/load";
export {
  findRecordById,
  type ProfileRecordMatch,
  recordsUsingSkill,
  type SkillUsage,
} from "./profile/query";
export type { ProfileInput } from "./profile/schema";
export type {
  ClaimBasis,
  Education,
  ExternalLink,
  PartialDate,
  Profile,
  ProfileIdentity,
  ProfileLink,
  Project,
  Provenance,
  Role,
  Skill,
  SourceRef,
} from "./profile/types";
