---
"@promptfolio/ai": patch
---

The model now gets told what each profile section holds, so a question that says "projects" no longer picks that section alone.

- The system prompt opens with the profile sections, one line each, and how a visitor's words map to them. `listProfileRecords`'s `section` argument describes each section too.
- An empty `projects`, `repositories`, or `contributions` list carries a `note` naming the other two sections, so the model checks them before saying there is none.
- The prompt's history rules match server-side history: a tool result anywhere in the conversation counts as evidence, and the text of earlier messages still does not.
