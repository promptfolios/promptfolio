# Promptfolio architecture

A living overview of the current architecture. Update it when a milestone changes the structure.
Decisions and their rationale are recorded in [`docs/adr/`](adr/); milestone progress is tracked
in [`ROADMAP.md`](ROADMAP.md#status).

## Packages and dependency direction

```
┌──────────────────────────── apps/portfolio  (Next.js reference app) ────────────────────────┐
│                                                                                              │
│  profile/                                    src/                                            │
│   ├─ example.profile.json  (committed,        ├─ app/page.tsx  (server: load profile, then   │
│   │   fictional)                              │      │          render workspace or issues)  │
│   └─ *.local.json          (gitignored,       │      ├──► server/profile.ts (fs + env)       │
│       real data)                              │      └──► components/chat-workspace.tsx      │
│                                               │              (client, see "Chat workspace")  │
│  .env.local ── PROMPTFOLIO_PROFILE_FILE ──────┘                                              │
└──────────────────────────────────────────────────────┬───────────────────────────────────────┘
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

## Chat workspace

The UI and thread state come from assistant-ui ([ADR 0007](adr/0007-chat-ui-assistant-ui.md));
Promptfolio code wires the runtime and supplies adapters and configuration.

```
ChatWorkspace ("use client", src/components/chat-workspace.tsx)
 │
 ├─ useRemoteThreadListRuntime ─── adapter: TitledInMemoryThreadListAdapter   (src/chat/)
 │     │                            thread list in memory, titled from the first message
 │     │                            (M6: replace with a persistent adapter)
 │     └─ runtimeHook ─► useLocalRuntime(model) per thread
 │                           model: ChatModelAdapter.run({ messages, abortSignal })
 │                           M3: createPlaceholderModel() — labelled, not AI output
 │                           M4: replaced by the AI SDK (server route)
 │
 ├─ AuiConfig({ suggestions: Suggestions(STARTERS) })            (src/config/starters.ts)
 │
 └─ renders <ThreadList/> in the sidebar and <Thread/> in the main area
       vendored: src/components/assistant-ui/, src/components/ui/, src/hooks/
```

Message shape: each message has `parts` (for example text, later tool calls), the same model the
AI SDK uses, so M4 can swap the placeholder model without changing the UI.

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
apps/portfolio ─► chat UI (M3, done) ─► /api/chat route (M4) ─► @promptfolio/ai (M4)
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
| [0007](adr/0007-chat-ui-assistant-ui.md)              | assistant-ui, Tailwind, and shadcn for chat   | Accepted |
