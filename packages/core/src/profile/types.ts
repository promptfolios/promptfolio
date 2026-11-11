/**
 * Canonical profile model.
 *
 * These types describe the normalized profile that the rest of Promptfolio consumes,
 * regardless of which source a fact came from. Source-specific input formats are
 * normalized into this shape by loaders such as `loadStructuredProfile`.
 *
 * Everything in a profile is treated as public: it may be shown to visitors or sent
 * to a model. Do not add private or sensitive fields.
 */

/**
 * Why a fact is believed.
 *
 * - `self-reported`: stated by the profile owner (for example, in a profile file).
 * - `source-observed`: observed in an external source (for example, a public repository).
 * - `derived`: inferred or summarized from other facts; never presented as verified.
 *
 * Unknown information is represented by absence, not by a basis value: a missing
 * skill means "not in the profile", not "does not have this skill".
 */
export type ClaimBasis = "self-reported" | "source-observed" | "derived";

/** Where a record came from and when it was observed. */
export interface Provenance {
  /** Id of the entry in `Profile.sources` that supplied the record. */
  sourceId: string;
  basis: ClaimBasis;
  /** ISO 8601 timestamp at which the source data was observed. */
  observedAt: string;
}

/** A source that contributed records to the profile. */
export interface SourceRef {
  id: string;
  /**
   * Source type, for example `"structured-file"` or `"github"`. Deliberately an open
   * string so new source adapters do not require changes to this package.
   */
  kind: string;
  /** Human-readable description of the source. */
  label: string;
  url?: string;
  /** ISO 8601 timestamp at which the source was read. */
  retrievedAt: string;
}

/** A date with year or month precision: `"YYYY"` or `"YYYY-MM"`. */
export type PartialDate = string;

/** A labelled external URL (http or https). */
export interface ExternalLink {
  label: string;
  url: string;
}

export interface ProfileIdentity {
  name: string;
  headline: string;
  summary: string;
  location?: string;
  provenance: Provenance;
}

/** A public link about the profile owner, such as a GitHub or LinkedIn profile. */
export interface ProfileLink extends ExternalLink {
  provenance: Provenance;
}

export interface Role {
  /**
   * Stable, author-assigned id, unique across roles, projects, and education. Either a
   * lowercase slug (`"acme-frontend"`) or a source key (`"github.com/owner/name"`).
   */
  id: string;
  organization: string;
  title: string;
  start: PartialDate;
  /** Absent when the role is current. */
  end?: PartialDate;
  location?: string;
  summary?: string;
  highlights: string[];
  /** Links about the role, such as the product worked on. Empty when the input has none. */
  links: ExternalLink[];
  /** Skill names, matched against `Profile.skills` case-insensitively. */
  skills: string[];
  provenance: Provenance;
}

export interface Project {
  /**
   * Stable, author-assigned id, unique across roles, projects, and education. A project whose
   * id is a repository's source key is the owner's description of that repository.
   */
  id: string;
  name: string;
  description: string;
  /** Id of the role under which the project was done, if any. */
  roleId?: string;
  responsibilities: string[];
  outcomes: string[];
  links: ExternalLink[];
  /** Skill names, matched against `Profile.skills` case-insensitively. */
  skills: string[];
  provenance: Provenance;
}

/** A skill, identified by its name (compared case-insensitively). */
export interface Skill {
  name: string;
  category?: string;
  provenance: Provenance;
}

export interface Education {
  /** Stable, author-assigned id, unique across roles, projects, and education. */
  id: string;
  institution: string;
  credential: string;
  field?: string;
  start?: PartialDate;
  end?: PartialDate;
  provenance: Provenance;
}

/** A language's share of a repository's code, as measured by the source. */
export interface LanguageShare {
  name: string;
  /** Whole percent of the repository's code, 1 to 100. */
  percent: number;
}

/**
 * A public code repository observed in a code-hosting source (for example GitHub).
 *
 * Everything here is what the source shows about the repository. It does not establish who
 * wrote the code, how much, or how well. An owner project with the same id is the owner's
 * own description of the repository (see `findRecordById`).
 */
export interface Repository {
  /** Source key such as `"github.com/owner/name"`: unique, and the same for every reader. */
  id: string;
  name: string;
  /** `"owner/name"` as the source shows it. */
  fullName: string;
  description?: string;
  url: string;
  homepage?: string;
  /** Largest first. Not a statement about the owner's skills. */
  languages: LanguageShare[];
  topics: string[];
  fork: boolean;
  archived: boolean;
  created?: PartialDate;
  /** Month of the most recent push, as reported by the source. */
  lastActivity?: PartialDate;
  /** SPDX license id, for example `"MIT"`. */
  license?: string;
  /** Beginning of the repository's README as plain text. */
  readme?: string;
  /** Whether `readme` was cut short. */
  readmeTruncated?: boolean;
  provenance: Provenance;
}

/**
 * A change attributed to the owner that is in a repository they do not own. Source-neutral: a
 * commit today. It shows that the source attributes the change to the owner, not its size or
 * importance, or a role in the project. The owner's project whose id is `repositoryId` is
 * their description of this work (see `findRecordById`).
 */
export interface Contribution {
  /** Source key such as `"github.com/owner/name/commit/<hash>"`. */
  id: string;
  /** Short description, written on the source: untrusted. */
  title: string;
  url: string;
  /** Source key of the repository, such as `"github.com/owner/name"`. */
  repositoryId: string;
  /** `"owner/name"` as the source shows it. */
  repository: string;
  repositoryUrl: string;
  repositoryDescription?: string;
  /** Month the change was authored, as reported by the source. */
  authored: PartialDate;
  provenance: Provenance;
}

/** The canonical, validated profile. */
export interface Profile {
  schemaVersion: 1;
  identity: ProfileIdentity;
  links: ProfileLink[];
  experience: Role[];
  projects: Project[];
  skills: Skill[];
  education: Education[];
  /**
   * Repositories observed in code-hosting sources such as
   * [source-github](https://www.npmjs.com/package/@promptfolio/source-github);
   * empty when none is configured.
   */
  repositories: Repository[];
  /**
   * Changes in other owners' repositories, from code-hosting sources such as
   * [source-github](https://www.npmjs.com/package/@promptfolio/source-github);
   * empty when none.
   */
  contributions: Contribution[];
  sources: SourceRef[];
}
