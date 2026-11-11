/**
 * The structured profile authoring format: the shape of an owner's profile file (for example
 * `profile.json`) before `loadStructuredProfile` validates and normalizes it.
 *
 * Plain TypeScript, kept identical to the internal zod schema by a type-level test, so zod is
 * not part of the public API. Types cannot express every rule: text is trimmed and length-limited,
 * dates are `YYYY` or `YYYY-MM`, URLs use http or https, ids are slugs or source keys, and unknown
 * keys are rejected. Data typed with these interfaces is not validated; only
 * `loadStructuredProfile` validates it.
 *
 * Lists are optional here because the loader defaults a missing list to `[]`; the normalized
 * `Profile` always has them.
 */
import type { ExternalLink, PartialDate } from "./types.ts";

/** The structured profile authoring format, as written by the profile owner. */
export interface ProfileInput {
  schemaVersion: 1;
  identity: ProfileIdentityInput;
  /** Public links about the owner, such as a GitHub or LinkedIn profile. */
  links?: ExternalLink[] | undefined;
  experience?: RoleInput[] | undefined;
  projects?: ProjectInput[] | undefined;
  skills?: SkillInput[] | undefined;
  education?: EducationInput[] | undefined;
}

export interface ProfileIdentityInput {
  name: string;
  headline: string;
  summary: string;
  location?: string | undefined;
}

export interface RoleInput {
  /** A lowercase slug (`"acme-frontend"`) or a source key, unique across roles, projects, and education. */
  id: string;
  organization: string;
  title: string;
  start: PartialDate;
  /** Absent when the role is current. Not before `start`. */
  end?: PartialDate | undefined;
  location?: string | undefined;
  summary?: string | undefined;
  highlights?: string[] | undefined;
  links?: ExternalLink[] | undefined;
  /** Skill names, matched against `skills` case-insensitively. */
  skills?: string[] | undefined;
}

export interface ProjectInput {
  /** A lowercase slug or a source key, unique across roles, projects, and education. */
  id: string;
  name: string;
  description: string;
  /** Id of the role under which the project was done, if any. */
  roleId?: string | undefined;
  responsibilities?: string[] | undefined;
  outcomes?: string[] | undefined;
  links?: ExternalLink[] | undefined;
  /** Skill names, matched against `skills` case-insensitively. */
  skills?: string[] | undefined;
}

/** A skill, identified by its name (compared case-insensitively, so names must be unique). */
export interface SkillInput {
  name: string;
  category?: string | undefined;
}

export interface EducationInput {
  /** A lowercase slug or a source key, unique across roles, projects, and education. */
  id: string;
  institution: string;
  credential: string;
  field?: string | undefined;
  start?: PartialDate | undefined;
  /** Not before `start`. */
  end?: PartialDate | undefined;
}
