# Record ids

First appears in: **M2** (profile schema). Status: **in use**.

## 1. What it is

Every role, project, and education entry has an explicit, author-written id such as
`acme-frontend`. Ids are lowercase slugs, unique across all three sections. Skills have no id; they
are identified by name, compared with `skillKey()` (case and spacing ignored, symbols kept).

## 2. Why it matters in Promptfolio

Ids are the handles that code and the model use to point at a fact:

- `Project.roleId` links a project to the role it was done under.
- M5 tools will take an id as an argument ("get project `service-catalog`") and return it.
- Answers will cite ids so a claim can be traced back to a record.

If ids changed whenever a name changed, every one of those links would break.

## 3. How it works

```
experience: [{ id: "acme-frontend", ... }]
projects:   [{ id: "service-catalog", roleId: "globex-fullstack", ... }]
                                           │
                       must match an experience id, else a warning (not an error)

skillKey("  Node.JS ")  → "node.js"
skillKey("C++")         → "c++"     (stays distinct from "c" and "c#")
```

Validation rules:

| Check                                   | Result  |
| --------------------------------------- | ------- |
| id missing or not `^[a-z0-9]+(-[a-z0-9]+)*$` | issue   |
| same id in two sections                 | issue   |
| two skills with the same `skillKey`     | issue   |
| `roleId` or skill name not found        | warning |

## 4. Where it lives in the code

- `recordId` regex: [packages/core/src/profile/schema.ts](../../packages/core/src/profile/schema.ts)
- `findDuplicateRecordIds`, `findDuplicateSkills`, `findDanglingReferences`, `skillKey`:
  [packages/core/src/profile/load.ts](../../packages/core/src/profile/load.ts)
- Tests: [packages/core/src/profile/load.test.ts](../../packages/core/src/profile/load.test.ts)
- Decision: [ADR 0005](../adr/0005-profile-model-and-provenance.md), point 4
- Ids as tool arguments and citations: **planned** (M5)

## 5. Common pitfalls and misconceptions

- Deriving ids from names (slugging "Acme Corp" → `acme-corp`) looks convenient but breaks on
  renames and can collide. This was explicitly rejected.
- Ids are not secret and not authorization. Knowing an id must not grant access to anything.
- A dangling reference is a warning, not an error, so the profile still loads. Warnings are logged
  on the server for the owner, not shown to visitors (see [page.tsx](../../apps/portfolio/src/app/page.tsx)).

## 6. Further reading

- [Zod: string formats and regex](https://zod.dev/api#strings)
