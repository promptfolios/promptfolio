---
"@promptfolio/core": patch
---

Add `profileInputJsonSchema()`, a JSON Schema (draft 7) of the profile file format (`ProfileInput`) for editor autocomplete, hover help, or generating forms. Each call returns a new copy. It is generated from the same rules the loader uses but is looser: unique ids, an end date not before its start, unique skill names, record-id format, and trimming are checked only by `loadStructuredProfile`, which remains the validator.
