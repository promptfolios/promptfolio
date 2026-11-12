# M24 plan: field labels for the profile input JSON Schema

- **Status:** Plan approved (2026-11-12). Done (2026-11-12), not released: the changeset waits for the
  next release. Verified before release from a `pnpm pack` tarball in a consumer app (forms).
- **Date:** 2026-11-12
- **Roadmap:** not listed before. Requested by a profile editor (an app outside this repository) that
  builds forms for a profile file and shows hover help in its JSON editor. Follows M23.

## Objective

Every field in `profileInputJsonSchema()` has a `title` (a form label), and a `description` where a
label cannot show the rule. Validation does not change.

**Excluded:** translations, UI hints (widget types, ordering), and a published `.json` file.

## Design

- zod 4 `.meta({ title, description })`, which `z.toJSONSchema` copies into the schema. A small
  `labeled(schema, title, description?)` helper in `schema.ts` applies it.
- Applied to each field where it is used, never to the shared `shortText`, `longText`, or
  `partialDate` (every field would get the same label), and never with an `id` (zod would move the
  field into `$defs`). Placed on the outermost wrapper (after `.optional()` or the list default);
  both positions produce the same output, checked before choosing.
- Descriptions follow the TSDoc in `input.ts`: the date format, the id format and uniqueness, "leave
  out for a current role", `roleId`, and skill matching. Obvious fields (name, organization) get a
  title only.

**Rejected:** `.describe()`, which sets only `description`, so forms would have no labels.

## Files

- `packages/core/src/profile/schema.ts`, `json-schema.test.ts`, and its snapshot
- `packages/core/README.md` (exports table), `docs/ROADMAP.md` (status row), a changeset

## Tests

- The snapshot shows every added `title` and `description` in review.
- Every property, nested and in list items, has a non-empty `title`, so a new field cannot be added
  without one.
- Sample descriptions (dates, current role, `roleId`, ids), read through `properties.title` and
  `properties.description` where the format has fields of those names.
- The loader tests pass unchanged, so validation did not change.

## Learning notes

No new concept and no changed one: no learning-note change.

## Release

A patch changeset for `core`; additive, no breaking change. The developer publishes later, with
other changes.

## Verification

`pnpm verify`, `pnpm test:tarballs`, and `pnpm changeset status`.
