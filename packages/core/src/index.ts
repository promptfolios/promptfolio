/**
 * Public entry point of `@promptfolio/core`.
 *
 * Only what is exported here is part of the public API.
 */
export { canonicalProfileContent, profileFingerprint } from "./profile/canonical";
export {
  loadStructuredProfile,
  type ProfileIssue,
  type ProfileLoadResult,
  type StructuredProfileSource,
} from "./profile/load";
export {
  addObservedRecords,
  type ContributionInput,
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
export { isRecordId, type ProfileInput } from "./profile/schema";
export type {
  ClaimBasis,
  Contribution,
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
