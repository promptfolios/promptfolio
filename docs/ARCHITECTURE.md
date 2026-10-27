# Promptfolio architecture

A living overview of the current architecture. Update it when a milestone changes the structure.
Decisions and their rationale are recorded in [`docs/adr/`](adr/); milestone progress is tracked
in [`ROADMAP.md`](ROADMAP.md#status).

## Packages and dependency direction

```mermaid
flowchart TB
    subgraph app["apps/portfolio (Next.js reference app)"]
        direction TB
        env[".env.local<br/>PROMPTFOLIO_PROFILE_FILE"]
        files["profile/<br/>example.profile.json (committed, fictional)<br/>*.local.json (gitignored, real data)"]
        page["src/app/page.tsx<br/>server: load profile, then render workspace or issues"]
        serverProfile["src/server/profile.ts<br/>fs + env"]
        workspace["src/components/chat-workspace.tsx<br/>client, see Chat workspace"]
        page --> serverProfile
        page --> workspace
        env --> serverProfile
        serverProfile -- reads --> files
    end

    subgraph core["packages/core (@promptfolio/core)"]
        direction TB
        index["src/index.ts<br/>the only entry point (package.json exports)"]
        load["profile/load.ts<br/>loadStructuredProfile(), skillKey()"]
        schema["profile/schema.ts<br/>zod input schema and LIMITS (internal)"]
        types["profile/types.ts<br/>Profile, Role, Project, Skill, Education, Provenance, SourceRef"]
        index --> load
        index --> types
        load --> schema
    end

    app -- "import from @promptfolio/core<br/>(public entry point only)" --> index
```

`core` depends on zod only: no Node.js, browser, React, Next.js, or AI SDK code. Dependencies point
only towards `core`; packages never import the app
([ADR 0002](adr/0002-library-first-monorepo-boundaries.md)).

## Profile loading flow

```mermaid
flowchart TD
    file["profile JSON file<br/>(owner-written, no provenance)"]

    subgraph appLoader["apps/portfolio/src/server/profile.ts"]
        direction TB
        choose["1. choose the file from PROMPTFOLIO_PROFILE_FILE<br/>(default: example.profile.json)"]
        guard["2. reject paths outside profile/"]
        read["3. read the file and its modification time"]
        parse["4. parse JSON"]
        choose --> guard --> read --> parse
    end

    subgraph coreLoader["loadStructuredProfile(data, { sourceId, label, observedAt }) in @promptfolio/core"]
        direction TB
        validate["1. validate with the schema<br/>(strict keys, sizes, dates, URLs)"]
        dupes["2. check duplicate record ids and skills"]
        normalize["3. normalize: stamp provenance on every record,<br/>register the source"]
        dangling["4. collect dangling references<br/>(unknown skills or roles) as warnings"]
        validate --> dupes --> normalize --> dangling
    end

    fileIssues["{ ok: false, issues: [(file)] }"]
    issues["{ ok: false, issues }"]
    ok["{ ok: true, profile: Profile, warnings }<br/>rendered by the app"]

    file --> choose
    parse --> validate
    read -- failure --> fileIssues
    parse -- failure --> fileIssues
    validate -- failure --> issues
    dupes -- failure --> issues
    dangling --> ok
```

## Chat workspace

The UI and thread state come from assistant-ui ([ADR 0007](adr/0007-chat-ui-assistant-ui.md));
Promptfolio code wires the runtime and supplies adapters and configuration.

```mermaid
flowchart TD
    ws["ChatWorkspace<br/>use client, src/components/chat-workspace.tsx"]
    list["useRemoteThreadListRuntime"]
    adapter["TitledInMemoryThreadListAdapter (src/chat/)<br/>thread list in memory, titled from the first message<br/>M6: replace with a persistent adapter"]
    local["useLocalRuntime(model), once per thread"]
    model["ChatModelAdapter.run({ messages, abortSignal })<br/>M3: createPlaceholderModel(), labelled, not AI output<br/>M4: replaced by the AI SDK (server route)"]
    config["AuiConfig({ suggestions: Suggestions(STARTERS) })<br/>src/config/starters.ts"]
    ui["ThreadList in the sidebar, Thread in the main area<br/>vendored: src/components/assistant-ui/, src/components/ui/, src/hooks/"]

    ws --> list
    list -- adapter --> adapter
    list -- runtimeHook --> local
    local -- model --> model
    ws --> config
    ws -- renders --> ui
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

```mermaid
flowchart LR
    app["apps/portfolio"] --> ui["chat UI (M3, done)"]
    ui --> route["route /api/chat (M4)"]
    route --> ai["@promptfolio/ai (M4)<br/>AI SDK, tools (M5)"]
    ai --> core["@promptfolio/core"]
    github["GitHub adapter (M8)"] -- "produces records with<br/>basis source-observed, kind github" --> core
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
