import { z } from "zod";

/**
 * Validation schema for the structured profile authoring format (`ProfileInput`).
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
  /** Owner names on GitHub are at most 39 characters and repository names at most 100. */
  sourceKey: 160,
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
 * source key (at most 160 characters). Exported so other packages validate ids by the same
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

const recordId = z
  .string()
  .refine(
    isRecordId,
    "Expected a lowercase id such as 'acme-frontend' or a source key such as 'github.com/owner/name'",
  );

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

const externalLinkSchema = z.strictObject({
  label: shortText,
  url: httpUrl,
});

const roleSchema = z
  .strictObject({
    id: recordId,
    organization: shortText,
    title: shortText,
    start: partialDate,
    end: partialDate.optional(),
    location: shortText.optional(),
    summary: longText.optional(),
    highlights: list(longText),
    skills: list(shortText),
  })
  .superRefine(checkDateRange);

const projectSchema = z.strictObject({
  id: recordId,
  name: shortText,
  description: longText,
  roleId: recordId.optional(),
  responsibilities: list(longText),
  outcomes: list(longText),
  links: list(externalLinkSchema),
  skills: list(shortText),
});

const skillSchema = z.strictObject({
  name: shortText,
  category: shortText.optional(),
});

const educationSchema = z
  .strictObject({
    id: recordId,
    institution: shortText,
    credential: shortText,
    field: shortText.optional(),
    start: partialDate.optional(),
    end: partialDate.optional(),
  })
  .superRefine(checkDateRange);

export const profileInputSchema = z.strictObject({
  schemaVersion: z.literal(1),
  identity: z.strictObject({
    name: shortText,
    headline: shortText,
    summary: longText,
    location: shortText.optional(),
  }),
  links: list(externalLinkSchema),
  experience: list(roleSchema),
  projects: list(projectSchema),
  skills: list(skillSchema),
  education: list(educationSchema),
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

/** Records observed in an external source, produced by a source adapter (not by the owner). */
export const observedRecordsSchema = z.strictObject({
  links: list(externalLinkSchema),
  repositories: list(repositoryInputSchema),
});

/** The structured profile authoring format, as written by the profile owner. */
export type ProfileInput = z.input<typeof profileInputSchema>;

/** `ProfileInput` after validation, with defaults applied and strings trimmed. */
export type ParsedProfileInput = z.output<typeof profileInputSchema>;
