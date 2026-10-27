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
  /** Stable, author-assigned id, unique across roles, projects, and education. */
  id: string;
  organization: string;
  title: string;
  start: PartialDate;
  /** Absent when the role is current. */
  end?: PartialDate;
  location?: string;
  summary?: string;
  highlights: string[];
  /** Skill names, matched against `Profile.skills` case-insensitively. */
  skills: string[];
  provenance: Provenance;
}

export interface Project {
  /** Stable, author-assigned id, unique across roles, projects, and education. */
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

/** The canonical, validated profile. */
export interface Profile {
  schemaVersion: 1;
  identity: ProfileIdentity;
  links: ProfileLink[];
  experience: Role[];
  projects: Project[];
  skills: Skill[];
  education: Education[];
  sources: SourceRef[];
}
