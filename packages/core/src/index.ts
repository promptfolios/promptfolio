/**
 * Public entry point of `@promptfolio/core`.
 *
 * Only what is exported here is part of the public API.
 */
export { canonicalProfileContent } from "./profile/canonical";
export {
  loadStructuredProfile,
  type ProfileIssue,
  type ProfileLoadResult,
  type StructuredProfileSource,
  skillKey,
} from "./profile/load";
export {
  addObservedRecords,
  type ObservedRecords,
  type ObservedSource,
  type RepositoryInput,
} from "./profile/observed";
export {
  findRecordById,
  type ProfileRecordMatch,
  recordsUsingSkill,
  type SkillUsage,
} from "./profile/query";
export { isRecordId, isSourceKey, type ProfileInput } from "./profile/schema";
export type {
  ClaimBasis,
  Education,
  ExternalLink,
  LanguageShare,
  PartialDate,
  Profile,
  ProfileIdentity,
  ProfileLink,
  Project,
  Provenance,
  Repository,
  Role,
  Skill,
  SourceRef,
} from "./profile/types";
