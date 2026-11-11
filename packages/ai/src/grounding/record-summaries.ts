import type { ClaimBasis, ExternalLink, LanguageShare, PartialDate } from "@promptfolio/core";

/*
 * Shapes of the records the profile tools return (see `createProfileTools` in
 * `profile-tools.ts`, which builds them).
 */

/**
 * The full provenance every returned record carries, flattened onto the record, so an answer
 * can say whose claim it is and when it was observed without another lookup.
 */
export interface RecordEvidence {
  basis: ClaimBasis;
  sourceId: string;
  observedAt: string;
}

export interface SourceSummary {
  id: string;
  kind: string;
  label: string;
}

/*
 * The record shapes listProfileRecords returns: exactly the fields the model sees for each
 * section. Fields are copied one by one (never spread from the source record), so a new field
 * on a profile type reaches the model only when it is added here on purpose.
 */

export interface RoleSummary extends RecordEvidence {
  id: string;
  organization: string;
  title: string;
  start: PartialDate;
  end?: PartialDate;
  summary?: string;
  links: ExternalLink[];
}

export interface ProjectSummary extends RecordEvidence {
  id: string;
  name: string;
  description: string;
  roleId?: string;
  skills: string[];
  links: ExternalLink[];
  /**
   * The url of the repository with this project's id, when there is one. It comes from that
   * repository's source (listed in the result's sources), not from the owner's project.
   */
  repositoryUrl?: string;
}

export interface RepositorySummary extends RecordEvidence {
  id: string;
  name: string;
  description?: string;
  url: string;
  languages: LanguageShare[];
  topics: string[];
  /** Present (and true) only for archived repositories. */
  archived?: true;
  lastActivity?: PartialDate;
  license?: string;
  /** Whether the owner has a project with this repository's id (their own description of it). */
  hasOwnerNotes: boolean;
}

export interface ContributionSummary extends RecordEvidence {
  id: string;
  title: string;
  url: string;
  repositoryId: string;
  repository: string;
  repositoryUrl: string;
  repositoryDescription?: string;
  authored: PartialDate;
  hasOwnerNotes: boolean;
}

export interface EducationSummary extends RecordEvidence {
  id: string;
  institution: string;
  credential: string;
  field?: string;
  start?: PartialDate;
  end?: PartialDate;
}

export interface SkillSummary extends RecordEvidence {
  name: string;
  category?: string;
}

export interface LinkSummary extends RecordEvidence {
  label: string;
  url: string;
}

export type RecordSummary =
  | RoleSummary
  | ProjectSummary
  | RepositorySummary
  | ContributionSummary
  | EducationSummary
  | SkillSummary
  | LinkSummary;
