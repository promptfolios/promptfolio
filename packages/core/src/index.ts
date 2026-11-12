/**
 * Public entry point of `@promptfolio/core`.
 *
 * Only what is exported here is part of the public API.
 */
export { canonicalProfileContent, profileFingerprint } from "./profile/canonical.ts";
export { findContactDetails } from "./profile/contact-details.ts";
export type {
  EducationInput,
  ProfileIdentityInput,
  ProfileInput,
  ProjectInput,
  RoleInput,
  SkillInput,
} from "./profile/input.ts";
export { profileInputJsonSchema } from "./profile/json-schema.ts";
export {
  loadStructuredProfile,
  type ProfileIssue,
  type ProfileLoadResult,
  type StructuredProfileSource,
} from "./profile/load.ts";
export {
  addObservedRecords,
  type ContributionInput,
  type ObservedRecords,
  type ObservedSource,
  type RepositoryInput,
} from "./profile/observed.ts";
export {
  findRecordById,
  type ProfileRecordMatch,
  profileLinkUrls,
  recordsUsingSkill,
  type SkillUsage,
} from "./profile/query.ts";
export { isRecordId } from "./profile/schema.ts";
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
} from "./profile/types.ts";
