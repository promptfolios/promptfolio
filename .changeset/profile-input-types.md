---
"@promptfolio/core": minor
---

Export plain TypeScript types for the profile file before validation: `ProfileInput`, `ProfileIdentityInput`, `RoleInput`, `ProjectInput`, `SkillInput`, and `EducationInput`. A consumer reading an already-validated profile file can type it without zod. Lists that the loader defaults are optional in these types. They are types only and validate nothing; `loadStructuredProfile` remains the validator.
