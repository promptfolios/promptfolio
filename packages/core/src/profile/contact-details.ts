import type { ProfileIssue } from "./load.ts";

/*
 * Everything in a profile is public (ADR 0005): it may be rendered on a site or sent to a model.
 * The schema already has no field for a phone number or email address, but free text (a summary,
 * a highlight) can still hold one. This check looks for that text.
 *
 * It is a heuristic. It catches the usual ways contact details are written, and it can be wrong in
 * both directions: a 10-digit order number is reported, and a number written as words is not.
 */

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
const CONTACT_SCHEME = { mailto: /\bmailto:/i, tel: /\btel:/i };
/** A run that could be a phone number: digits with optional spaces, dots, dashes, or brackets. */
const PHONE_CANDIDATE = /\+?\(?\d[\d\s().-]*\d/g;
/** Phone numbers have 10 to 15 digits (E.164 allows at most 15); dates and short ids have fewer. */
const PHONE_DIGITS = { min: 10, max: 15 };

/**
 * Reports every string in raw profile data that looks like an email address or phone number,
 * with its path (for example `experience[0].summary`; the root is `""`).
 *
 * It reads the data as given, before validation, so it also checks fields the schema would reject.
 * It only reports: the caller decides whether a finding fails a check, is dropped, or is shown as a
 * warning. Links are checked too, since a link such as `tel:` or a messaging URL can carry a number.
 */
export function findContactDetails(data: unknown): ProfileIssue[] {
  const issues: ProfileIssue[] = [];
  for (const { path, value } of strings(data, "", new WeakSet())) {
    const message = contactDetailIn(value);
    if (message !== undefined) issues.push({ path, message });
  }
  return issues;
}

/** Why a string looks like contact details, or `undefined` if it does not. */
function contactDetailIn(text: string): string | undefined {
  if (CONTACT_SCHEME.mailto.test(text) || EMAIL.test(text)) return "Looks like an email address";
  if (CONTACT_SCHEME.tel.test(text)) return "Looks like a phone number";
  for (const candidate of text.match(PHONE_CANDIDATE) ?? []) {
    const digits = candidate.replace(/\D/g, "").length;
    if (digits >= PHONE_DIGITS.min && digits <= PHONE_DIGITS.max) {
      return "Looks like a phone number";
    }
  }
  return undefined;
}

/**
 * Yields every string in a value with its path, formatted like `experience[0].summary`.
 * `seen` guards against cycles: JSON has none, but the argument is any value.
 */
function* strings(
  value: unknown,
  path: string,
  seen: WeakSet<object>,
): Generator<{ path: string; value: string }> {
  if (typeof value === "string") {
    yield { path, value };
    return;
  }
  if (typeof value !== "object" || value === null || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) yield* strings(item, `${path}[${index}]`, seen);
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    yield* strings(item, path ? `${path}.${key}` : key, seen);
  }
}
