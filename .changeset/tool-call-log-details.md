---
"@promptfolio/ai": patch
---

Tool-call log lines can now be told apart. A `listProfileRecords` line includes its `section` and `skillFilter: true` when a skill filter was used (never the skill itself), and a `getProfileRecord` line includes the `id` when the record was found. Other arguments are still not logged, because they may echo visitor text.
