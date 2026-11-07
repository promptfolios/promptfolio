---
"@promptfolio/ai": minor
---

`listProfileRecords` now includes each project's `links` in its summary, so a model that answers from the list alone can still link projects. The tool description and the system prompt no longer send the model to `getProfileRecord` for links.

A project with the same id as a repository also gets that repository's url as `repositoryUrl`, and the list's `sources` then include the repository's source.
