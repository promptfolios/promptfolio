# ADR 0005: Canonical profile model and record-level provenance

- **Status:** Accepted
- **Date:** 2026-10-27

## Context

The assistant must answer from evidence, not invent facts, and must distinguish owner-provided
information, information observed in public sources, derived inferences, and unknowns. Profile
facts will come from several sources (a structured file now, GitHub in M8) and will be looked up
by tools (M5), cited in answers, and tracked by caches (M7, M9).

## Decision

1. **Structured, canonical model.** `@promptfolio/core` defines a `Profile` (identity, links,
   experience, projects, skills, education, sources). Source-specific input is normalized into it.
2. **Record-level provenance.** Every record carries
   `provenance: { sourceId, basis, observedAt }`, where `basis` is `self-reported`,
   `source-observed`, or `derived`. `sourceId` refers to an entry in `Profile.sources`.
   Per-field provenance was rejected as too heavy to author; document-level provenance as too
   coarse for citations.
3. **Unknown means absent.** Missing information is not represented by a value; a missing skill
   means "not in the profile", never "does not have it".
4. **Record ids.** Roles, projects, and education require explicit, author-assigned lowercase ids,
   unique across all three, so tools and citations can reference records unambiguously and ids
   survive edits to names. Skills are identified by name, compared case-insensitively (`skillKey`),
   without transforming symbols, so `C`, `C++`, and `C#` stay distinct. Deriving ids from names was
   rejected: renames would break references, and slugging can cause collisions.
5. **Open source kinds.** `SourceRef.kind` is a string (`"structured-file"`, later `"github"`), so
   new source adapters do not require changes to `core`.
6. **Validation at the boundary.** The authoring format (`ProfileInput`) is validated with zod:
   unknown keys are rejected (catching typos), text and lists have size limits (profile data is
   eventually sent to a model), dates use `YYYY` or `YYYY-MM`, and links must use http or https.
7. **Results, not exceptions.** `loadStructuredProfile` returns
   `{ ok: true, profile, warnings } | { ok: false, issues }`, reporting every problem with a path.
   Invalid data never produces a profile. Dangling references (unknown skills or roles) are
   warnings. It throws only for invalid arguments supplied by the application.
8. **zod is internal.** The public API exposes plain TypeScript types and functions, so zod's
   version is not part of the public contract.
9. **Everything in a profile is public.** It may be shown to visitors or sent to a model, so the
   model contains no private fields. Private configuration (for example, the contact email for
   M10) lives in server configuration.

## Consequences

- Authors write a few explicit ids; in return, citations and cross-references are stable.
- Later sources produce the same record types with `basis: "source-observed"`.
- Confidence scores, certifications, open-source contributions, and conflict resolution between
  sources are deferred.
