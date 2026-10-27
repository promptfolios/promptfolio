# Provenance and claim basis

First appears in: **M2** (profile schema). Status: **in use**.

## 1. What it is

Provenance is a small label on every record that says *where it came from* (`sourceId`), *when it
was observed* (`observedAt`), and *why it is believed* (`basis`). The basis is one of
`self-reported`, `source-observed`, or `derived`.

## 2. Why it matters in Promptfolio

The assistant must be able to say whose claim a fact is. "Jordan says they led the migration"
(self-reported) is different from "the public repository shows 40 commits by Jordan"
(source-observed), and both differ from "Jordan probably knows CSS" (derived). Without the label,
everything sounds equally verified.

## 3. How it works

`loadStructuredProfile` stamps every record from the owner's file with the same provenance and
registers the file as a source:

```
profile.experience[0].provenance = {
  sourceId:   "owner-profile",          ──► profile.sources[0].id
  basis:      "self-reported",
  observedAt: "2026-10-20T09:14:00.000Z" (the file's modification time)
}

profile.sources[0] = { id: "owner-profile", kind: "structured-file",
                       label: "Owner-provided profile file (example.profile.json)", ... }
```

Unknown is **absence**, not a fourth basis: a skill that is not listed means "not in the profile",
never "does not have it".

## 4. Where it lives in the code

- `ClaimBasis`, `Provenance`, `SourceRef`: [packages/core/src/profile/types.ts](../../packages/core/src/profile/types.ts)
- Stamping in `normalize()`: [packages/core/src/profile/load.ts](../../packages/core/src/profile/load.ts)
- Source id and observation time chosen by the app: [apps/portfolio/src/server/profile.ts](../../apps/portfolio/src/server/profile.ts)
- Tests ("stamps every record…", "registers the source…"): [packages/core/src/profile/load.test.ts](../../packages/core/src/profile/load.test.ts)
- Decision: [ADR 0005](../adr/0005-profile-model-and-provenance.md)
- `source-observed` records from GitHub: **planned** (M8). Citing provenance in answers: **planned** (M5)

## 5. Common pitfalls and misconceptions

- Provenance is not proof. `source-observed` means "seen in that source", not "true".
- `derived` facts must never be presented as verified, even if they sound obvious.
- Provenance is per record, not per field: a role's `title` and `highlights` share one label.
  Per-field provenance was rejected as too heavy to author.
- Each record gets its *own* provenance object (see the comment in `normalize()`), so mutating one
  cannot silently change another.

## 6. Further reading

- [W3C PROV overview](https://www.w3.org/TR/prov-overview/) (the general idea; Promptfolio uses a
  much smaller model)
