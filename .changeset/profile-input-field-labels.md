---
"@promptfolio/core": patch
---

`profileInputJsonSchema()` now gives every field a `title`, usable as a form label, and a `description` where the rule needs explaining (date format, id format, current roles, `roleId`), shown as hover help in editors. Validation is unchanged.
