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
                       label: "Owner-provided profile", ... }
```

Unknown is **absence**, not a fourth basis: a skill that is not listed means "not in the profile",
never "does not have it".

From M5, every record a tool returns carries its full provenance (`basis`, `sourceId`, and
`observedAt`), and each result lists its `sources` by label. The system prompt asks the model to
attribute `self-reported` facts to the owner ("Jordan's profile lists…") and to explain the source
and basis when a visitor asks how it knows something. This addresses the M4 finding that answers
sometimes stated self-reported facts as plain fact; the prompt guides this, but nothing enforces it.

From M8, GitHub repositories are the first `source-observed` records: `addObservedRecords` stamps
them with `basis: "source-observed"`, the GitHub source id, and the snapshot's `retrievedAt` as
`observedAt`, and registers a `SourceRef` (`kind: "github"`, the account URL). A repository,
its README, and its language shares show what the repository contains, not who wrote it, how
much, or how well; the system prompt tells the model to attribute such facts to GitHub and never
infer authorship or skill from them. An owner project with the same id as a repository is the
owner's own (`self-reported`) description of it: both records keep their own provenance.

From M8.1, a contribution is a `source-observed` commit in someone else's repository. It shows that
GitHub attributes the commit to the owner, not its size or importance, or a role
([contributions and evidence](contributions-and-evidence.md)).

From M9, `observedAt` is per repository: when a refresh cannot read a repository again, it keeps
the previous data together with the time that data was read, so a carried record says it was
observed on an earlier day instead of looking as current as the rest
([refresh status and last known good](refresh-status-and-last-known-good.md)).

From M11.2, provenance reaches the visitor directly. After an answer, the server sends the sources for
its verified citations, built from these fields on the profile, and the page shows them below the answer.
The model cannot write that proof, because it never touches it. A repository with owner notes lists both
its public source and the notes, because naming only the public source would claim it shows more than it
does. A panel shows where a fact comes from, not that the sentence restates it correctly, and a fact
stated without a citation gets no entry. One citation can also look like more proof than it is: a
sentence listing seven technologies may cite one repository that shows only one of them.

## 4. Where it lives in the code

- `ClaimBasis`, `Provenance`, `SourceRef`: [packages/core/src/profile/types.ts](../../packages/core/src/profile/types.ts)
- Stamping in `normalize()`: [packages/core/src/profile/load.ts](../../packages/core/src/profile/load.ts)
- Citations drawn as numbered markers: [apps/portfolio/src/chat/citation-links.ts](../../apps/portfolio/src/chat/citation-links.ts) and
  [apps/portfolio/src/components/citation-marker.tsx](../../apps/portfolio/src/components/citation-marker.tsx)
- Source id and observation time chosen by the app: [apps/portfolio/src/server/profile.ts](../../apps/portfolio/src/server/profile.ts)
- Tests ("stamps every record…", "registers the source…"): [packages/core/src/profile/load.test.ts](../../packages/core/src/profile/load.test.ts)
- Decision: [ADR 0005](../adr/0005-profile-model-and-provenance.md)
- Provenance in tool results (`evidence`, `sourcesFor`): [packages/ai/src/profile-tools.ts](../../packages/ai/src/profile-tools.ts);
  attribution rules in [packages/ai/src/system-prompt.ts](../../packages/ai/src/system-prompt.ts)
- `source-observed` records from GitHub (`addObservedRecords`): [packages/core/src/profile/observed.ts](../../packages/core/src/profile/observed.ts);
  the attribution rule in [packages/ai/src/system-prompt.ts](../../packages/ai/src/system-prompt.ts)
- The sources an answer shows: [packages/ai/src/citations.ts](../../packages/ai/src/citations.ts) and
  [apps/portfolio/src/components/sources-panel.tsx](../../apps/portfolio/src/components/sources-panel.tsx)
- Source and observed basis for GitHub data: [packages/source-github/src/normalize.ts](../../packages/source-github/src/normalize.ts)

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
