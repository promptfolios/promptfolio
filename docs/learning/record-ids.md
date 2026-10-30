# Record ids

First appears in: **M2** (profile schema). Status: **in use**.

## 1. What it is

Every role, project, and education entry has an explicit, author-written id such as
`acme-frontend`. Ids are lowercase slugs, unique across all three sections. Skills have no id; they
are identified by name, compared with `skillKey()` (case and spacing ignored, symbols kept).

## 2. Why it matters in Promptfolio

Ids are the handles that code and the model use to point at a fact:

- `Project.roleId` links a project to the role it was done under.
- The `getProfileRecord` tool takes an id as its argument, and every summary returned by
  `listProfileRecords` carries one.
- Answers cite ids in square brackets (`[service-catalog]`), so a claim can be traced back to a
  record.

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

From M8 an id has one of two forms. **Slugs** (`acme-frontend`) stay for records only the owner
writes. **Source keys** (`github.com/jordan/markdown-linter`) identify records observed in a source:
the location of the record in its source, lowercased, like a Go module path. A source key is unique
and the same for everyone, so the owner can refer to a repository without a mapping: a project
whose id equals a repository's id is the owner's description of that repository, and
`findRecordById` returns the repository with that project as `ownerNotes`. Only projects may share
an id with a repository; a role or education entry may not. Renaming a repository changes its key.
This refines ADR 0005's rule against derived ids: for observed records, the source decides the id.

From M8.1, contributions have keys like `github.com/<owner>/<name>/commit/<hash>` (source keys are at
most 200 characters). No record may share such an id, not even a project; the owner's notes use the
repository's key instead.

## 4. Where it lives in the code

- `recordId` regex: [packages/core/src/profile/schema.ts](../../packages/core/src/profile/schema.ts)
- `findDuplicateRecordIds`, `findDuplicateSkills`, `findDanglingReferences`, `skillKey`:
  [packages/core/src/profile/load.ts](../../packages/core/src/profile/load.ts)
- Tests: [packages/core/src/profile/load.test.ts](../../packages/core/src/profile/load.test.ts)
- Decision: [ADR 0005](../adr/0005-profile-model-and-provenance.md), point 4
- Lookup by id (`findRecordById`, exact match only): [packages/core/src/profile/query.ts](../../packages/core/src/profile/query.ts)
- Ids as tool arguments: [packages/ai/src/profile-tools.ts](../../packages/ai/src/profile-tools.ts);
  citation rule in [packages/ai/src/system-prompt.ts](../../packages/ai/src/system-prompt.ts).
  Checking that cited ids were returned in that turn: [packages/ai/src/citations.ts](../../packages/ai/src/citations.ts)
- Both id forms (`isRecordId`, `isSourceKey`): [packages/core/src/profile/schema.ts](../../packages/core/src/profile/schema.ts);
  repository ids from GitHub (`repositoryKey`): [packages/source-github/src/normalize.ts](../../packages/source-github/src/normalize.ts);
  id conflicts and annotations: [packages/core/src/profile/observed.ts](../../packages/core/src/profile/observed.ts)

`owner_identity` is a reserved citation for the identity block, which reaches the model in the system
prompt rather than through a tool. Record ids cannot contain an underscore, so it cannot collide with one.

## 5. Common pitfalls and misconceptions

- Deriving ids from names (slugging "Acme Corp" → `acme-corp`) looks convenient but breaks on
  renames and can collide. This was explicitly rejected.
- Ids are not secret and not authorization. Knowing an id must not grant access to anything.
- A dangling reference is a warning, not an error, so the profile still loads. Warnings are logged
  on the server for the owner, not shown to visitors (see [page.tsx](../../apps/portfolio/src/app/page.tsx)).

## 6. Further reading

- [Zod: string formats and regex](https://zod.dev/api#strings)
