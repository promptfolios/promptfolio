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
| M5 — Tools and grounded profile lookup    | Done      | `pnpm dev`: answers cite record ids; tool calls in the server log; [plan](plans/m5-tools-grounded-lookup.md) |
| M6 — Conversation persistence             | Done      | `pnpm dev`: conversations survive a reload, saved only in this browser; [plan](plans/m6-browser-conversation-persistence.md) |
| M7 — Seeded conversations and cache       | Removed in M12.5 | Was: `pnpm --filter portfolio prepare-answers`, then a starter answers at once; [plan](plans/m7-prepared-starter-answers.md) |
| M7.1 — OpenRouter provider                | Done      | `PROMPTFOLIO_MODEL=openrouter` with `OPENROUTER_API_KEY`: a free model answers with tools; [plan](plans/m7-1-openrouter-provider.md) |
| M7.2 — AI Gateway provider                | Done      | `PROMPTFOLIO_MODEL=gateway` with `AI_GATEWAY_API_KEY` (needs a card on the Vercel team): a $0 model answers; [plan](plans/m7-2-ai-gateway-provider.md) |
| M8 — GitHub source adapter                | Done      | `pnpm --filter portfolio refresh` (named `fetch-github` until M9) with `profile/<profile>.github.json`; answers cite `github.com/…` repositories; [plan](plans/m8-github-source-adapter.md) |
| M8.1 — GitHub contributions               | Done      | `pnpm --filter portfolio refresh`: commits in other owners' public repositories become contributions; answers cite `github.com/…/commit/…`; [plan](plans/m8-1-github-contributions.md) |
| M9 — Refresh pipeline and versions         | Done      | `pnpm --filter portfolio refresh`: exit 0, 2, or 1, `profile/<profile>.refresh-status.json`, snapshot unchanged when nothing changed; workflow template in [the guide](guides/scheduled-refresh.md); [plan](plans/m9-refresh-pipeline-and-versions.md) |
| M11.1 — Protection and failure paths       | Done      | `pnpm test`; [the guide](guides/chat-limit-setup.md): 30 live answers per visitor and 200 for the site per day, then a limit message; [plan](plans/m11-reliability-security-evaluation.md) |
| M11.2 — Citations and provenance          | Replaced in M12.7 | Was: an answer with citations shows a Sources panel below it; [plan](plans/m11-reliability-security-evaluation.md) |
| M11.3 — Evaluation and limitations        | Done      | `pnpm --filter portfolio evaluate --label=my-run`; [results](evaluation/README.md); [limitations](KNOWN_LIMITATIONS.md); prepared answers wait for the deployed model (M12); [plan](plans/m11-reliability-security-evaluation.md) |
| M12.1 — Second consumer and package docs   | Done      | `pnpm --filter minimal-consumer test`; package READMEs; [plan](plans/m12-second-consumer-and-deployment.md) |
| M12.2 — Answer readiness                   | Done      | `pnpm test`; [results](evaluation/README.md): the chosen model failed its gate, chosen anyway; [limitations](KNOWN_LIMITATIONS.md) |
| M12.4 — Fixes from the evaluation runs     | Done      | `pnpm test`; [plan](plans/m12-4-reliability-fixes.md) |
| M12.5 — Remove prepared answers and starters | Done     | Prepared answers removed; [plan](plans/m12-5-remove-prepared-answers.md). Replaces M7's starters and answers. M12.9 added generated starters |
| M12.6 — Code cleanup and folder layout     | Done      | `pnpm verify`; [plan](plans/m12-6-code-cleanup.md) |
| M12.7 — Markdown links                     | Done      | `pnpm dev`: answers link record names, with no sources panel; [plan](plans/m12-7-markdown-links.md) |
| M12.8 — Chat layout and themes             | Done      | `pnpm dev`: assistant-ui style layout, with a light and dark toggle; [plan](plans/m12-8-chat-layout-and-themes.md) |
| M12.9 — Generated starter questions        | Done      | Moved to build time in M12.10; [plan](plans/m12-9-generated-starter-questions.md) |
| M12.10 — Build-time starters and styling   | Done      | `pnpm build`: `/` stays static, with starters in its HTML; [plan](plans/m12-10-build-time-starters-and-styling.md) |
| M12.3 — Deployment                         | Not started | Optional, and the developer chose to stop before it; [plan](plans/m12-second-consumer-and-deployment.md) |
| M13.1 — `ai` API                           | Done      | `pnpm verify`; `handleChatRequest` takes `additionalInstructions`, `limits`, and `visitorMessages`; [plan](plans/m13-library-readiness.md) |
| M13.2 — Small package fixes                | Done      | `pnpm verify`; `core` exports no type built from zod, and token errors name no variable; [plan](plans/m13-library-readiness.md) |
| M13.3 — Packaging                          | Done      | `pnpm -r build`, then `pnpm pack` in a package: a tarball with `dist`, `README`, and `LICENSE`; [plan](plans/m13-library-readiness.md) |
| M13.4 — CI and versioning                  | Done      | `pnpm test:tarballs`; `pnpm changeset`; [the workflow](../.github/workflows/ci.yml); [plan](plans/m13-library-readiness.md) |
| M13.5 — Docs and evaluation                | Not started | [plan](plans/m13-library-readiness.md) |

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

Plan and decisions: [M8 plan](plans/m8-github-source-adapter.md), [ADR 0009](adr/0009-github-source-as-fetched-snapshot.md). The owner configures only a GitHub username; repositories are selected automatically, identified by source keys (`github.com/owner/repo`), and fetched by `pnpm --filter portfolio refresh` (named `fetch-github` in M8) into a snapshot file.

### M8.1 — GitHub contributions

**Objective:** Show work outside the owner's own repositories. Split from M8 on 2026-10-29.

**Activities:**
- Find commits GitHub attributes to the owner in other owners' public repositories (commit search; 10 searches per minute without a token, 30 with one). Commits replace the earlier idea of merged pull requests, which miss projects that take changes through their own review system.
- Pinned repositories of other owners only rank results; forks and pins without commits make no record.
- Add a source-observed `contribution` record and a prompt rule for what an attributed commit does and does not show.

**Exit criteria:** Contributions appear as cited, source-observed records without overstating authorship or size.

Plan and decisions: [M8.1 plan](plans/m8-1-github-contributions.md), [ADR 0011](adr/0011-contributions-as-attributed-commits.md).

### M9 — Refresh pipeline and profile versioning

**Objective:** Update source-backed data safely and connect changes to caches.

**Activities:**
- Define a refresh operation and observable status.
- Normalize and validate before replacing the current version.
- Preserve the last known-good data when refresh fails.
- Detect meaningful changes and increment profile version only according to the agreed policy.
- Connect profile version changes to relevant cache invalidation.
- Start with manual or startup refresh if sufficient; schedule periodic refresh only when runtime requirements are clear.
- Schedule the GitHub fetch from M8 (recommended in the [M8 plan](plans/m8-github-source-adapter.md#the-fetch-command-decision-b-schedule-in-m9): a daily GitHub Actions workflow with the built-in `GITHUB_TOKEN` that commits the snapshot when content changed; check the 60-day inactivity rule and whether the host redeploys on such pushes), keep per-repository last known-good data, and regenerate prepared answers after a refresh that changed content.

**Exit criteria:** Refresh outcomes are distinguishable, failed ingestion does not silently erase valid data, and changed facts cannot leave dependent cached answers knowingly stale.

Plan and decisions: [M9 plan](plans/m9-refresh-pipeline-and-versions.md), [ADR 0010](adr/0010-refresh-status-and-content-versions.md). `pnpm --filter portfolio refresh` keeps per-repository last known-good data, writes a status file, and treats the content fingerprint as the profile version. Prepared answers are not regenerated automatically (stale ones are answered live). The daily workflow is a template in [docs/guides/scheduled-refresh.md](guides/scheduled-refresh.md), activated in the deployment repository in M12.

### M10 — Contact workflow

**Objective:** Provide a safe, confirmed way for a visitor to contact the profile owner.

**Activities:**
- Collect/clarify the visitor's message.
- Prepare an email using the configured recipient.
- Display recipient and content for review.
- Require explicit confirmation before sending.
- Validate fields, apply abuse protection, keep credentials server-side, and handle provider failures truthfully.

**Exit criteria:** No email is sent without confirmation, and the UI accurately reports whether sending succeeded.

Plan and decisions: [M10 plan](plans/m10-contact-workflow.md), [ADR 0012](adr/0012-contact-workflow.md). Setup: [docs/guides/contact-setup.md](guides/contact-setup.md). [M10.1](plans/m10-1-daily-send-limit.md) adds a limit of one email per visitor per day, held in Redis. The host rate limit is set at deployment (M12); M11 reviews rate limits together with chat.

### M11 — Reliability, security, and AI evaluation

**Objective:** Improve correctness and failure handling across the MVP.

**Activities:**
- Review untrusted inputs, prompt-injection exposure, tool authorization, rate limits, output limits, and secrets handling.
- Add representative source fixtures and failure-path tests.
- Create a small AI evaluation set for answerable, unanswerable, exaggeration-prone, and injection-related questions.
- Check citations and show their provenance: match the record ids an answer cites against the records returned in that turn, and append a server-built sources block (id, record, basis, source, observed date) so every stated fact comes with its proof. Design: [M5 plan, Deferred to M11](plans/m5-tools-grounded-lookup.md#deferred-to-m11-server-built-provenance-for-cited-facts).
  Also decide how identity facts are cited: the model cites the identity block as `[owner_identity]`,
  which no tool returns, so M7's gate rejects the prepared overview answer and that starter is
  always answered live (accepted for M7 on 2026-10-29; see the [M7 plan, Review
  results](plans/m7-prepared-starter-answers.md#review-results)).
- Repository wording (moved from M8's observations by the M9 plan): the model called unlicensed
  public repositories "open-source" and wrote "repositories by <user>". Consider prompt rules (a
  public repository without a license is not open source; "under the account", not "by") and
  check them with the evaluation set. See the [M8 plan,
  Observations](plans/m8-github-source-adapter.md#review-results).
- Verify error states and observability without logging unnecessary personal data.
- Document known limitations.

**Exit criteria:** Important safety and reliability requirements have tests or explicit documented limitations; evaluation results reflect actual runs.

Plan and decisions: [M11 plan](plans/m11-reliability-security-evaluation.md), split into M11.1 (protection and failure paths), M11.2 (citations and provenance), and M11.3 (evaluation and limitations). [ADR 0013](adr/0013-chat-daily-limits.md) records the chat limits.

### M12 — Second-consumer test, documentation, and deployment decision

**Objective:** Validate that the reusable library is not coupled to the first portfolio app.

**Activities:**
- Create a small second profile or consumer configuration.
- Verify the same reusable APIs work without editing package internals.
- Improve setup and package usage documentation.
- Review public package exports and dependency direction.
- Decide whether deployment is useful now; obtain approval before publishing or deploying.
- With the deployment repository: activate the scheduled refresh from [docs/guides/scheduled-refresh.md](guides/scheduled-refresh.md) and check its first run, whether the host deploys the job's push, and whether `GITHUB_TOKEN` can read pinned repositories (M9 left these unverified).
- Check how much of the refresh a second consumer has to copy from `apps/portfolio/src/server/refresh/refresh.ts` (raised during M9 review, deliberately not moved yet). Candidates for `@promptfolio/source-github`: `mergeGitHubSnapshot` (pure, now in the app's `github-source.ts`) and a `refreshGitHubSnapshot` that combines `fetchGitHubSnapshot` and `carryForward`. The refresh status schema is source-neutral, so it would go to `core`, and only once a second source exists. These stay in the app: the "write only on a new profile version" rule (needs `profileFingerprint` from `@promptfolio/ai`), files, environment, and exit codes. The scheduled workflow stays a deployment template.

**Exit criteria:** The second consumer works through documented public APIs and configuration/data changes. Deployment is optional until separately approved.

Plan and results: [M12 plan](plans/m12-second-consumer-and-deployment.md). The exit criteria are met. The developer chose not to deploy for now (2026-10-31), so the firewall rule, the real 429 and IP header checks, the scheduled refresh, and a deployment path for a real profile remain in M12.3, which stays optional.

### M13 — Library readiness

**Objective:** Get the reusable packages ready to publish, without publishing them.

**Exit criteria:** A packed tarball installs and works in a separate project, and each package's API is free of reference-app assumptions. Publishing is a separate milestone with its own approval.

Plan and decisions: [M13 plan](plans/m13-library-readiness.md).

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
