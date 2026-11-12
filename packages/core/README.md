# @promptfolio/core

The canonical profile model: validates profile data, keeps where each fact came from, and looks records up. It has no
framework, model, or network code.

## Install

```sh
npm install @promptfolio/core
```

Requires Node.js 22 or later. ES modules only.

## Entry point

| Export | Purpose |
| ------ | ------- |
| `loadStructuredProfile` | Validates owner data and returns a `Profile`, or issues with their paths |
| `findContactDetails` | Reports text that looks like an email address or phone number, with its path. A heuristic: it narrows the risk of publishing contact details, and the caller decides what a finding means |
| `addObservedRecords` | Adds records read from a source, keeping their provenance |
| `findRecordById`, `recordsUsingSkill` | Look records up |
| `profileLinkUrls` | The URLs an answer may link to; a UI should make only these clickable |
| `canonicalProfileContent`, `profileFingerprint` | A stable serialization and its hash, for telling whether content changed |
| `isRecordId` | Checks a record id's form |
| Types | `Profile` and its records, `ProfileIssue`, `ProfileLoadResult`, `Provenance`, and others |
| Input types | `ProfileInput` and its records (`RoleInput`, `ProjectInput`, ...): the profile file's shape before validation |
| `profileInputJsonSchema` | A JSON Schema (draft 7) of the profile file, with a `title` (form label) on every field and a `description` (hover help) where useful, for editor autocomplete or forms. Looser than `loadStructuredProfile`, which remains the validator: unique ids, date order, and id format are checked only in code |

## Example

From [the minimal consumer](https://github.com/promptfolios/promptfolio/blob/main/apps/minimal-consumer/src/consumer.ts):

```ts
import { loadStructuredProfile } from "@promptfolio/core";

const owner = loadStructuredProfile(ownerProfile, {
  sourceId: "owner-profile",
  label: "Owner-provided profile",
  observedAt: new Date("2026-10-30T06:00:00.000Z"),
});
if (!owner.ok) throw new Error(`invalid profile: ${JSON.stringify(owner.issues)}`);
```

The data comes from you, as parsed JSON, and everything in it is treated as public.

## License

MIT
