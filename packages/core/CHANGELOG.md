# @promptfolio/core

## 0.0.4

### Patch Changes

- e65256a: New `findContactDetails(data)` reports text in raw profile data that looks like an email address or phone number (`mailto:` and `tel:` links, and runs of 10 to 15 digits), as `ProfileIssue`s with their paths. It is a heuristic and only reports: a store's checks can fail on a finding, and a consumer can leave the text out before rendering it or sending it to a model.
- b2eb73e: Export plain TypeScript types for the profile file before validation: `ProfileInput`, `ProfileIdentityInput`, `RoleInput`, `ProjectInput`, `SkillInput`, and `EducationInput`. A consumer reading an already-validated profile file can type it without zod. Lists that the loader defaults are optional in these types. They are types only and validate nothing; `loadStructuredProfile` remains the validator.
- 4abe083: Roles accept an optional `links` list, like projects, for pages such as the product worked on. `Role.links` is an empty array when the input has none, so existing profiles load unchanged.
  
  `listProfileRecords` includes each role's `links` in its summary, so a model that answers from the list alone can link roles too.

## 0.0.3

No changes in this release.

## 0.0.2

### Patch Changes

- ac462a0: Ship TypeScript source with source maps and declaration maps, for readable stack traces and Go to Definition.
