import { z } from "zod";

/**
 * Validation schema for the structured profile authoring format.
 *
 * Internal to the package: the public API exposes `loadStructuredProfile` and plain
 * TypeScript types, so zod stays an implementation detail.
 *
 * Limits bound the size of profile data because it is eventually sent to a model.
 */
export const LIMITS = {
  shortText: 200,
  longText: 2000,
  id: 64,
  /**
   * Owner names on GitHub are at most 39 characters and repository names at most 100; a commit
   * key such as `github.com/owner/name/commit/<40 hex>` adds up to 199.
   */
  sourceKey: 200,
  url: 2048,
  listItems: 100,
  readme: 3000,
  languages: 5,
  topics: 20,
} as const;

const shortText = z.string().trim().min(1).max(LIMITS.shortText);
const longText = z.string().trim().min(1).max(LIMITS.longText);

/** An author-written slug such as `acme-frontend`. */
const SLUG_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/**
 * A source key: a lowercase host followed by a path, such as `github.com/owner/name`, the
 * record's location in its source. No scheme, and no path segment made only of dots.
 */
const SOURCE_KEY = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/(?!\.+(?:\/|$))[a-z0-9._-]+)+$/;

/**
 * Whether a string is a valid record id: a lowercase slug (at most 64 characters) or a
 * source key (at most 200 characters). Exported so other packages validate ids by the same
 * rule without depending on zod.
 */
export function isRecordId(value: string): boolean {
  return (
    (value.length <= LIMITS.id && SLUG_ID.test(value)) ||
    (value.length <= LIMITS.sourceKey && SOURCE_KEY.test(value))
  );
}

/** Whether a string is a source key such as `github.com/owner/name`. */
export function isSourceKey(value: string): boolean {
  return value.length <= LIMITS.sourceKey && SOURCE_KEY.test(value);
}

/** Why a string is not a record id, so a too-long id is not reported as a badly formatted one. */
function recordIdProblem(value: string): string {
  if (SLUG_ID.test(value)) {
    return `Ids are at most ${LIMITS.id} characters; this one has ${value.length}`;
  }
  if (SOURCE_KEY.test(value)) {
    return `Source keys are at most ${LIMITS.sourceKey} characters; this one has ${value.length}`;
  }
  return "Expected a lowercase id such as 'acme-frontend' or a source key such as 'github.com/owner/name'";
}

const recordId = z.string().superRefine((value, ctx) => {
  if (!isRecordId(value)) ctx.addIssue({ code: "custom", message: recordIdProblem(value) });
});

const sourceKey = z
  .string()
  .refine(isSourceKey, "Expected a source key such as 'github.com/owner/name'");

const partialDate = z
  .string()
  .regex(/^\d{4}(?:-(?:0[1-9]|1[0-2]))?$/, "Expected a date in YYYY or YYYY-MM format");

const httpUrl = z.url({ protocol: /^https?$/ }).max(LIMITS.url);

function list<T extends z.ZodType>(item: T) {
  return z.array(item).max(LIMITS.listItems).default([]);
}

/**
 * Compares partial dates at the coarser of the two precisions, so a year-only end
 * date ("2021") is not considered earlier than a start date within that year ("2021-05").
 */
function isEndBeforeStart(start: string, end: string): boolean {
  if (start.length === 4 || end.length === 4) {
    return end.slice(0, 4) < start.slice(0, 4);
  }
  return end < start;
}

function checkDateRange(
  value: { start?: string | undefined; end?: string | undefined },
  ctx: z.RefinementCtx,
): void {
  if (value.start && value.end && isEndBeforeStart(value.start, value.end)) {
    ctx.addIssue({ code: "custom", path: ["end"], message: "End date is before start date" });
  }
}

/**
 * Adds a form label (`title`) and, where it helps, hover help (`description`). They appear only in
 * `profileInputJsonSchema()`; validation is unchanged. Applied to each field where it is used, never
 * to the shared `shortText`, `longText`, or `partialDate` (every field would get the same label), and
 * never with an `id` (zod would move the field into `$defs`).
 */
function labeled<T extends z.ZodType>(schema: T, title: string, description?: string): T {
  return schema.meta(description === undefined ? { title } : { title, description });
}

const ID_HELP =
  "A lowercase slug such as 'acme-frontend', or a source key such as 'github.com/owner/name'. Unique across roles, projects, and education.";
const DATE_HELP = "YYYY or YYYY-MM, for example 2024 or 2024-06.";

const idField = () => labeled(recordId, "Id", ID_HELP);
const skillsField = () =>
  labeled(
    list(shortText),
    "Skills",
    "Skill names, matched against the profile's skills case-insensitively.",
  );

const externalLinkSchema = labeled(
  z.strictObject({
    label: labeled(shortText, "Label", "The link text, for example 'GitHub' or 'Case study'."),
    url: labeled(httpUrl, "URL", "An http or https address."),
  }),
  "Link",
);

const linksField = (description: string) => labeled(list(externalLinkSchema), "Links", description);

const roleSchema = labeled(
  z
    .strictObject({
      id: idField(),
      organization: labeled(shortText, "Organization"),
      title: labeled(shortText, "Title", "The job title, for example 'Frontend Engineer'."),
      start: labeled(partialDate, "Start", DATE_HELP),
      end: labeled(
        partialDate.optional(),
        "End",
        `${DATE_HELP} Leave it out for a current role. Not before the start.`,
      ),
      location: labeled(shortText.optional(), "Location"),
      summary: labeled(longText.optional(), "Summary", "A short description of the role."),
      highlights: labeled(list(longText), "Highlights", "Achievements in this role, one per item."),
      links: linksField("Public links about this role."),
      skills: skillsField(),
    })
    .superRefine(checkDateRange),
  "Role",
);

const projectSchema = labeled(
  z.strictObject({
    id: idField(),
    name: labeled(shortText, "Name"),
    description: labeled(longText, "Description"),
    roleId: labeled(
      recordId.optional(),
      "Role",
      "The id of the role in experience under which the project was done, if any.",
    ),
    responsibilities: labeled(list(longText), "Responsibilities", "What you did, one per item."),
    outcomes: labeled(list(longText), "Outcomes", "Results of the project, one per item."),
    links: linksField("Public links about this project, such as a repository or a demo."),
    skills: skillsField(),
  }),
  "Project",
);

const skillSchema = labeled(
  z.strictObject({
    name: labeled(shortText, "Name", "Unique; compared case-insensitively."),
    category: labeled(
      shortText.optional(),
      "Category",
      "A group such as 'Languages' or 'Frameworks'.",
    ),
  }),
  "Skill",
);

const educationSchema = labeled(
  z
    .strictObject({
      id: idField(),
      institution: labeled(shortText, "Institution"),
      credential: labeled(shortText, "Credential", "A degree or certificate, for example 'BSc'."),
      field: labeled(shortText.optional(), "Field", "The field of study."),
      start: labeled(partialDate.optional(), "Start", DATE_HELP),
      end: labeled(partialDate.optional(), "End", `${DATE_HELP} Not before the start.`),
    })
    .superRefine(checkDateRange),
  "Education",
);

export const profileInputSchema = z.strictObject({
  schemaVersion: labeled(z.literal(1), "Schema version", "The format version. Always 1."),
  identity: labeled(
    z.strictObject({
      name: labeled(shortText, "Name"),
      headline: labeled(shortText, "Headline", "One line, for example 'Frontend engineer'."),
      summary: labeled(longText, "Summary", "A short introduction."),
      location: labeled(
        shortText.optional(),
        "Location",
        "A public location, such as a city or region.",
      ),
    }),
    "Identity",
  ),
  links: linksField("Public links about you, such as a GitHub or LinkedIn profile."),
  experience: labeled(list(roleSchema), "Experience"),
  projects: labeled(list(projectSchema), "Projects"),
  skills: labeled(list(skillSchema), "Skills"),
  education: labeled(list(educationSchema), "Education"),
});

const repositoryInputSchema = z.strictObject({
  id: sourceKey,
  name: shortText,
  fullName: shortText,
  description: longText.optional(),
  url: httpUrl,
  homepage: httpUrl.optional(),
  languages: z
    .array(z.strictObject({ name: shortText, percent: z.number().int().min(1).max(100) }))
    .max(LIMITS.languages),
  topics: z.array(shortText).max(LIMITS.topics),
  fork: z.boolean(),
  archived: z.boolean(),
  created: partialDate.optional(),
  lastActivity: partialDate.optional(),
  license: shortText.optional(),
  readme: z.string().trim().min(1).max(LIMITS.readme).optional(),
  readmeTruncated: z.boolean().optional(),
  /** When this repository was read, if earlier than the source's `retrievedAt`. */
  observedAt: z.date().optional(),
});

const contributionInputSchema = z.strictObject({
  id: sourceKey,
  title: shortText,
  url: httpUrl,
  repositoryId: sourceKey,
  repository: shortText,
  repositoryUrl: httpUrl,
  repositoryDescription: longText.optional(),
  authored: partialDate,
  /** When this contribution was read, if earlier than the source's `retrievedAt`. */
  observedAt: z.date().optional(),
});

/** Records observed in an external source, produced by a source adapter (not by the owner). */
export const observedRecordsSchema = z.strictObject({
  links: list(externalLinkSchema),
  repositories: list(repositoryInputSchema),
  contributions: list(contributionInputSchema),
});

/** The authoring format after validation, with defaults applied and strings trimmed. */
export type ParsedProfileInput = z.output<typeof profileInputSchema>;
