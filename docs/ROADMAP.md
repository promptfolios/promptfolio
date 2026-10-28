# Promptfolio Roadmap

This document describes the suggested milestone sequence and future directions. It is a planning guide, not authorization to implement every item. Work proceeds one approved milestone at a time under `CLAUDE.md`.

## Working rules

- Start with repository discovery; inspect existing files and Git status before proposing changes.
- For each milestone, propose a bounded plan and acceptance criteria, then wait for approval.
- Implement only the approved milestone, verify it, explain the result, and wait for review before continuing.
- Adjust milestone boundaries when the repository or learning needs make a smaller step more useful.
- Do not add deferred features just because they appear here.

## Status

| Milestone                                 | Status    | What you can check                                                    |
| ----------------------------------------- | --------- | --------------------------------------------------------------------- |
| M0 — Discovery and architecture plan      | Done      | `docs/ARCHITECTURE.md`, `docs/adr/`                                   |
| M1 — Minimal monorepo foundation          | Done      | `pnpm install`, `pnpm build`; the app imports `@promptfolio/core`     |
| M1.1 — Linting and formatting             | Done      | `pnpm lint`, `pnpm verify`                                            |
| M2 — Profile schema and structured source | Done      | `pnpm test`; `pnpm dev` shows the loaded profile or validation issues |
| M3 — Minimal application shell            | Done      | `pnpm dev`: chat workspace with starters, threads, placeholder replies |
| M4 — First AI integration                 | Done      | `pnpm dev` with a Gemini or Claude key: streamed replies; [plan](plans/m4-first-ai-integration.md) |

Update this table when a milestone is approved.

## MVP milestones

### M0 — Repository discovery and architecture plan

**Objective:** Understand the existing repository and agree on a small implementation sequence before editing.

**Activities:**
- Inspect files, package manager setup, Git status, existing app/framework, scripts, and tests.
- Identify existing code worth preserving.
- Propose package boundaries, dependency direction, and a minimal first deliverable.
- Compare relevant AI SDK options against current stable APIs and project requirements.
- Identify unresolved choices and recommend defaults.

**Exit criteria:** The developer approves the architecture direction and the next bounded milestone. No implementation is assumed before approval.

### M1 — Minimal monorepo foundation

**Objective:** Establish the smallest useful PNPM TypeScript workspace.

**Activities:**
- Create or adapt workspace configuration.
- Add only the initial app and package(s) needed to demonstrate the dependency direction.
- Establish consistent scripts for development and verification.
- Confirm the app can import a public package entry point.
- Document setup and workspace commands.

**Exit criteria:** Workspace install and relevant checks succeed; the app imports a package through its public API. Do not create speculative packages.

### M1.1 — Linting and formatting

**Objective:** Add consistent linting and formatting after the workspace foundation exists. Deferred from M1 to keep M1 small.

**Activities:**
- Choose lint and format tooling (for example, ESLint with typescript-eslint plus Prettier, or Biome) after verifying compatibility with the installed TypeScript version.
- Add root `lint` and `format` scripts and integrate them into the verification commands.
- Fix or explicitly document any existing violations.
- Optionally add commit-message linting (commitlint) for the Conventional Commits convention in `CLAUDE.md`; not before it is approved.

**Exit criteria:** `lint` and format checks run across the workspace and pass, or remaining issues are documented.

### M2 — Profile schema and structured source

**Objective:** Define a canonical, validated profile representation and load a small local profile.

**Activities:**
- Model the profile facts required by the first conversation.
- Define provenance/source metadata.
- Validate input and reject or report malformed data.
- Keep sample/profile-owner data outside reusable package internals.
- Add tests for valid, invalid, and incomplete profile records.

**Exit criteria:** A structured profile can be loaded, validated, and consumed through a deliberate public API.

### M3 — Minimal application shell

**Objective:** Build the basic portfolio chat workspace without introducing AI complexity yet.

**Activities:**
- Implement the primary workspace layout and message composer.
- Add the 4–5 seeded conversation starters as real UI entry points.
- Add empty, loading, error, and responsive states as appropriate.
- Keep UI-specific code in the app or UI package according to the agreed boundary.
- Use temporary deterministic responses only if clearly identified as scaffolding.

**Exit criteria:** The interaction shell is usable and its state flow is understandable. Any scaffolding is documented and not misrepresented as AI functionality.

### M4 — First AI integration

**Objective:** Send a visitor message to a model and render the response.

**Activities:**
- Implement the approved SDK's smallest supported chat path.
- Keep credentials server-side.
- Add streaming if the chosen path supports it with reasonable complexity.
- Add basic error handling and input limits.
- Explain request/response flow and the role of the SDK.

**Exit criteria:** A visitor can ask a basic question and receive a model response; secrets are not exposed to the browser.

### M5 — Tools and grounded profile lookup

**Objective:** Answer profile questions using structured evidence rather than relying on the model's prior knowledge.

**Activities:**
- Define a small typed tool interface.
- Add deterministic lookup for profile facts, projects, roles, and skills as needed.
- Validate tool arguments and enforce permissions in code.
- Return compact results with evidence/provenance references.
- Add tests for supported questions, unknown facts, malformed tool inputs, and denied actions.

**Exit criteria:** The assistant uses available profile data for supported questions and clearly handles missing evidence. No vector database is required.

### M6 — Conversation persistence

**Objective:** Let visitors continue a conversation within a clearly defined scope.

**Activities:**
- Decide and document the initial scope (for example, browser/session scoped, not account-based).
- Persist the minimum necessary message history.
- Enforce size/retention limits and conversation isolation.
- Test loading, saving, malformed data, and separation between visitors/sessions.

**Exit criteria:** The documented persistence behavior works and does not expose another visitor's history. If persistence is deferred or simplified, document the approved trade-off.

### M7 — Seeded conversations and cache behavior

**Objective:** Make seeded starters useful and consistent with profile state.

**Activities:**
- Decide whether starters generate a conversation, load a prepared answer, or combine both.
- If answers are cached, define cache keys and profile-version dependencies.
- Invalidate or recompute relevant answers when source facts change.
- Test cache hits, misses, invalidation, and graceful fallback.

**Exit criteria:** Seeded interactions behave consistently, and the app does not knowingly serve stale prepared answers after relevant data changes.

### M8 — GitHub source adapter

**Objective:** Add public GitHub information as a second source of profile facts.

**Activities:**
- Identify the minimum useful public profile/repository data.
- Implement fetching separately from normalization.
- Handle rate limits, missing fields, malformed responses, and network failures.
- Preserve source URLs and observation timestamps.
- Use fixtures for deterministic tests.

**Exit criteria:** Selected public GitHub data can be normalized into the canonical model with provenance, without leaking GitHub-specific assumptions throughout the app.

### M9 — Refresh pipeline and profile versioning

**Objective:** Update source-backed data safely and connect changes to caches.

**Activities:**
- Define a refresh operation and observable status.
- Normalize and validate before replacing the current version.
- Preserve the last known-good data when refresh fails.
- Detect meaningful changes and increment profile version only according to the agreed policy.
- Connect profile version changes to relevant cache invalidation.
- Start with manual or startup refresh if sufficient; schedule periodic refresh only when runtime requirements are clear.

**Exit criteria:** Refresh outcomes are distinguishable, failed ingestion does not silently erase valid data, and changed facts cannot leave dependent cached answers knowingly stale.

### M10 — Contact workflow

**Objective:** Provide a safe, confirmed way for a visitor to contact the profile owner.

**Activities:**
- Collect/clarify the visitor's message.
- Prepare an email using the configured recipient.
- Display recipient and content for review.
- Require explicit confirmation before sending.
- Validate fields, apply abuse protection, keep credentials server-side, and handle provider failures truthfully.

**Exit criteria:** No email is sent without confirmation, and the UI accurately reports whether sending succeeded.

### M11 — Reliability, security, and AI evaluation

**Objective:** Improve correctness and failure handling across the MVP.

**Activities:**
- Review untrusted inputs, prompt-injection exposure, tool authorization, rate limits, output limits, and secrets handling.
- Add representative source fixtures and failure-path tests.
- Create a small AI evaluation set for answerable, unanswerable, exaggeration-prone, and injection-related questions.
- Verify error states and observability without logging unnecessary personal data.
- Document known limitations.

**Exit criteria:** Important safety and reliability requirements have tests or explicit documented limitations; evaluation results reflect actual runs.

### M12 — Second-consumer test, documentation, and deployment decision

**Objective:** Validate that the reusable library is not coupled to the first portfolio app.

**Activities:**
- Create a small second profile or consumer configuration.
- Verify the same reusable APIs work without editing package internals.
- Improve setup and package usage documentation.
- Review public package exports and dependency direction.
- Decide whether deployment is useful now; obtain approval before publishing or deploying.

**Exit criteria:** The second consumer works through documented public APIs and configuration/data changes. Deployment is optional until separately approved.

## Deferred product phases

These ideas are intentionally outside the initial MVP unless explicitly approved.

### Phase 2 — Richer profile intelligence

- More detailed relationship between skills, projects, roles, outcomes, and evidence.
- Better provenance and confidence/validation state.
- Profile-owner review of derived summaries.
- More useful cross-project questions.
- More robust conflict handling when sources disagree.

### Phase 3 — Job-description matching

Allow a visitor or profile owner to provide a job description and compare its requirements against available profile evidence.

Potential behavior:
- Extract role requirements and separate must-haves from preferences.
- Map each requirement to supporting profile facts or public evidence.
- Label each requirement as **supported**, **partially supported**, or **unknown/unsupported**.
- Cite the evidence and explain gaps without fabricating experience.
- Produce a tailored summary only from supported facts.
- Make uncertainty explicit and avoid presenting the result as an objective hiring decision.

This phase needs its own evaluation examples and careful handling of inferred matches.

### Phase 4 — Voice and reverse interviewing

Explore a voice-based interview in which an AI interviewer asks questions about a profile or role and the user responds.

Potential work:
- Voice input/output and turn management.
- Interview modes and configurable question sets.
- Clear distinction between known profile evidence and information supplied during the interview.
- Consent and privacy behavior for audio/transcripts.
- Evaluation of transcription errors, interruptions, and unsupported summaries.

Do not add voice infrastructure before a clear use case and runtime requirements are established.

### Phase 5 — Additional source adapters

Possible sources include personal blogs, published articles, other code-hosting services, and selected professional/social profiles where access is permitted and reliable.

For each adapter:
- Verify current API and access rules.
- Minimize requested data.
- Normalize into the canonical model.
- Preserve source provenance and timestamps.
- Handle source-specific rate limits and partial failure.
- Avoid scraping or storing data contrary to source terms or user expectations.

### Phase 6 — More sophisticated retrieval

Consider semantic search, embeddings, reranking, or a vector store only if evaluation shows that structured lookup cannot answer important questions.

Before adoption:
- Define concrete retrieval failure examples.
- Compare against deterministic lookup and simpler text search.
- Measure retrieval relevance and evidence fidelity.
- Account for embedding/model costs, data refresh, deletion, and stale indexes.
- Keep retrieved content untrusted and preserve citations/provenance.

### Phase 7 — Hosted platform

A hosted multi-tenant product could let multiple profile owners configure data sources and publish conversational portfolios.

Potential requirements:
- Authentication and account management.
- Tenant isolation and authorization.
- Secure per-tenant secrets and source connections.
- Profile editing and ingestion status.
- Usage limits, abuse protection, billing, and observability.
- Data export/deletion and retention policies.
- Operational monitoring and deployment architecture.

This is a substantial product direction, not a small extension of the MVP. Do not add multi-tenancy, billing, or account-management systems to the initial portfolio.

### Other exploratory ideas

- Profile-owner dashboard for source health and evidence review.
- Shareable conversations or curated interview paths.
- Analytics that respect visitor privacy.
- Multiple portfolio themes and embeddable experiences.
- Import/export formats for profile data.
- Human-reviewed answer examples to improve evaluation.
- Additional AI-assisted authoring tools for the profile owner.

These are brainstorming items, not commitments. Promote an idea into a planned milestone only when it has a clear user need, scope, and acceptance criteria.

## Milestone completion checklist

For each approved milestone, confirm:
- [ ] Scope was approved before implementation.
- [ ] Changes are limited to the milestone.
- [ ] Relevant tests/checks were run and results reported accurately.
- [ ] Important decisions and limitations were explained.
- [ ] Learning docs added or updated in `docs/learning/` for concepts the milestone introduced or changed.
- [ ] Diff was reviewed and existing user changes were preserved.
- [ ] The developer explicitly approves moving to the next milestone.
