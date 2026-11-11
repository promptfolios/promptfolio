---
"@promptfolio/core": minor
"@promptfolio/ai": minor
---

Roles accept an optional `links` list, like projects, for pages such as the product worked on. `Role.links` is an empty array when the input has none, so existing profiles load unchanged.

`listProfileRecords` includes each role's `links` in its summary, so a model that answers from the list alone can link roles too.
