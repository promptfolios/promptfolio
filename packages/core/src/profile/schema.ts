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
  url: 2048,
  listItems: 100,
} as const;

const shortText = z.string().trim().min(1).max(LIMITS.shortText);
const longText = z.string().trim().min(1).max(LIMITS.longText);

const recordId = z
  .string()
  .max(LIMITS.id)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Expected a lowercase id such as 'acme-frontend'");

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

/** The structured profile authoring format, as written by the profile owner. */
export type ProfileInput = z.input<typeof profileInputSchema>;

/** `ProfileInput` after validation, with defaults applied and strings trimmed. */
export type ParsedProfileInput = z.output<typeof profileInputSchema>;
