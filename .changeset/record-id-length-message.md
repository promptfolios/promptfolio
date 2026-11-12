---
"@promptfolio/core": patch
---

`loadStructuredProfile` now reports an id that is valid apart from its length as too long ("Ids are at most 64 characters; this one has 66"), instead of saying it is not a lowercase id.
