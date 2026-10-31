# @promptfolio/core

The canonical profile model: validates profile data, keeps where each fact came from, and looks records up. It has no
framework, model, or network code.

Not published. Use it from this workspace as `"@promptfolio/core": "workspace:*"`.

## Entry point

| Export | Purpose |
| ------ | ------- |
| `loadStructuredProfile` | Validates owner data and returns a `Profile`, or issues with their paths |
| `addObservedRecords` | Adds records read from a source, keeping their provenance |
| `findRecordById`, `recordsUsingSkill` | Look records up |
| `profileLinkUrls` | The URLs an answer may link to; a UI should make only these clickable |
| `canonicalProfileContent`, `profileFingerprint` | A stable serialization and its hash, for telling whether content changed |
| `isRecordId` | Checks a record id's form |
| Types | `Profile` and its records, `ProfileIssue`, `ProfileLoadResult`, `Provenance`, and others |

## Example

From [the minimal consumer](../../apps/minimal-consumer/src/consumer.ts):

```ts
const owner = loadStructuredProfile(ownerProfile, {
  sourceId: "owner-profile",
  label: "Owner-provided profile",
  observedAt: new Date("2026-10-30T06:00:00.000Z"),
});
if (!owner.ok) throw new Error(`invalid profile: ${JSON.stringify(owner.issues)}`);
```

The data comes from you, as parsed JSON, and everything in it is treated as public.
