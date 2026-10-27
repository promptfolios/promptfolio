# Promptfolio architecture

A living overview of the current architecture. Update it when a milestone changes the structure.
Decisions and their rationale are recorded in [`docs/adr/`](adr/); milestone progress is tracked
in [`ROADMAP.md`](ROADMAP.md#status).

## Packages and dependency direction

```
┌──────────────────────────── apps/portfolio  (Next.js reference app) ────────────────────────┐
│                                                                                              │
│  profile/                                    src/                                            │
│   ├─ example.profile.json  (committed,        ├─ app/page.tsx   (temporary diagnostic page)  │
│   │   fictional)                              │      │ calls                                 │
│   └─ *.local.json          (gitignored,       │      ▼                                       │
│       real data)                              └─ server/profile.ts  (server-only: fs + env)  │
│                                                      │                                       │
│  .env.local ── PROMPTFOLIO_PROFILE_FILE ─────────────┘                                       │
└──────────────────────────────────────────────────────┼───────────────────────────────────────┘
                                                       │ import from "@promptfolio/core"
                                                       │ (public entry point only)
                                                       ▼
┌──────────────────────────── packages/core  (@promptfolio/core) ──────────────────────────────┐
│  src/index.ts   the only entry point (package.json "exports")                                │
│   ├─ profile/load.ts    loadStructuredProfile(), skillKey()                                  │
│   ├─ profile/schema.ts  zod input schema and LIMITS (internal)                               │
│   └─ profile/types.ts   Profile, Role, Project, Skill, Education, Provenance, SourceRef      │
│                                                                                              │
│  Depends on zod only. No Node.js, browser, React, Next.js, or AI SDK code.                   │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

Dependencies point only towards `core`; packages never import the app
([ADR 0002](adr/0002-library-first-monorepo-boundaries.md)).

## Profile loading flow

```
profile JSON file (owner-written, no provenance)
   │
   │  apps/portfolio/src/server/profile.ts
   │   1. choose the file from PROMPTFOLIO_PROFILE_FILE (default: example.profile.json)
   │   2. reject paths outside profile/
   │   3. read the file and its modification time  ── failure ─► { ok: false, issues: [(file)] }
   │   4. parse JSON                                ── failure ─► { ok: false, issues: [(file)] }
   ▼
loadStructuredProfile(data, { sourceId, label, observedAt })        (@promptfolio/core)
   ├─ 1. validate with the schema (strict keys, sizes, dates, URLs) ── failure ─► issues
   ├─ 2. check duplicate record ids and skills                      ── failure ─► issues
   ├─ 3. normalize: stamp provenance on every record, register the source
   └─ 4. collect dangling references (unknown skills or roles)      ─────────────► warnings
   ▼
{ ok: true, profile: Profile, warnings }  ─►  rendered by the app
```

## Canonical profile model

```
Profile
 ├─ schemaVersion: 1
 ├─ identity      { name, headline, summary, location?, provenance }
 ├─ links[]       { label, url, provenance }
 ├─ experience[]  { id, organization, title, start, end?, highlights[], skills[], provenance }
 ├─ projects[]    { id, name, description, roleId? → experience.id,
 │                  responsibilities[], outcomes[], links[], skills[] → skills.name, provenance }
 ├─ skills[]      { name (case-insensitive key), category?, provenance }
 ├─ education[]   { id, institution, credential, field?, start?, end?, provenance }
 └─ sources[]     { id, kind, label, url?, retrievedAt }

provenance = { sourceId → sources.id, basis: self-reported | source-observed | derived, observedAt }
```

Record ids are the targets of future tool lookups and citations; `basis` lets the assistant say
whose claim a fact is ([ADR 0005](adr/0005-profile-model-and-provenance.md)).

## Planned extensions

```
apps/portfolio ─► chat UI (M3) ─► /api/chat route (M4) ─► @promptfolio/ai (M4)
                                                              │ AI SDK, tools (M5)
                                                              ▼
                                                       @promptfolio/core
                                                              ▲
                                   GitHub adapter (M8) ── produces records with
                                                          basis "source-observed", kind "github"
```

## Decision records

| ADR                                                   | Decision                                      | Status   |
| ----------------------------------------------------- | --------------------------------------------- | -------- |
| [0001](adr/0001-reference-app-framework.md)           | Next.js for the reference app; serverless     | Accepted |
| [0002](adr/0002-library-first-monorepo-boundaries.md) | Library-first monorepo and package boundaries | Accepted |
| [0003](adr/0003-ai-sdk-selection.md)                  | Vercel AI SDK v7 (confirm at M4)              | Proposed |
| [0004](adr/0004-biome-lint-and-format.md)             | Biome for linting and formatting              | Accepted |
| [0005](adr/0005-profile-model-and-provenance.md)      | Canonical profile model and provenance        | Accepted |
| [0006](adr/0006-profile-data-location.md)             | Profile data location in the reference app    | Accepted |
