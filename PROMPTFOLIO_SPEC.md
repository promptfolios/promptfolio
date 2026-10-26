# Promptfolio — Product and Engineering Specification

## 1. Product vision

Promptfolio is a library-first, AI-powered conversational professional portfolio. A visitor explores a person's professional background through a persistent chat workspace rather than a conventional portfolio page with an optional chatbot.

The reusable packages are the core product. The portfolio application is the first consumer and a practical demonstration of the packages.

### Core principles

- **Library first:** reusable behavior lives in packages, not in the portfolio app.
- **Real conversation:** seeded prompts start useful conversations, and visitors can ask natural follow-up questions.
- **Evidence over invention:** answers are grounded in available profile data and clearly communicate uncertainty.
- **Current information:** source ingestion, refresh, versioning, and cache invalidation keep the profile reasonably current.
- **Composable boundaries:** sources, model providers, and persistence can be replaced where doing so has practical value.
- **Incremental learning:** build and review one small milestone at a time.
- **Use existing tools:** prefer established libraries over rebuilding commodity infrastructure.
- **Constrained assistant:** use a general-purpose model with domain-specific data and tools; do not train a custom model as part of the MVP.

## 2. Objectives and users

### Product objective

Create a polished, interactive professional portfolio that can answer questions about a profile using grounded information, explain relevant experience, and provide a safe contact path.

### Learning objective

Build practical AI engineering knowledge by implementing the system incrementally: model integration, streaming, tool calling, structured data, ingestion, provenance, caching, persistence, evaluation, and authorization.

### Intended users

- **Profile owner / developer:** maintains profile information and source connections and learns from the implementation.
- **Portfolio visitor / recruiter:** asks about experience, projects, skills, contributions, and contact options.
- **Library consumer:** integrates the reusable packages into a different portfolio without changing package internals.

## 3. MVP scope

The MVP should deliver a working end-to-end experience while remaining small enough to understand and review. Exact implementation choices must be proposed and approved milestone by milestone.

### 3.1 Conversational workspace

- The main interface is a chat workspace, not a floating chat popup.
- Provide 4–5 useful seeded conversation starters, such as professional overview, relevant projects, technical skills, open-source work, and work experience.
- A seeded starter should launch a real conversation and allow ordinary follow-up messages.
- Visitors can start a fresh conversation and continue the current one.
- Include clear loading, streaming, empty, error, and retry states as supported by the selected stack.
- Make the layout responsive and accessible; keyboard navigation and readable focus states matter.
- Do not build a full content-management system or account portal for the MVP.

### 3.2 Profile data and evidence

Represent professional information as structured data rather than relying on a large prompt containing every fact.

The profile model should be able to represent, as applicable:

- Basic identity and professional summary.
- Roles and employment history.
- Skills and technologies.
- Projects and their descriptions, responsibilities, outcomes, and links.
- Education and certifications.
- Open-source contributions and public repositories.
- Public contact options.
- Source/provenance metadata and the time/version at which information was observed.

Each meaningful fact should retain enough provenance to explain where it came from. Depending on the source, metadata may include source identifier, source URL, retrieval time, source type, confidence or validation state, and a reference to the original item.

Keep distinctions clear between:
- Information explicitly provided by the profile owner.
- Information observed from a public source.
- Derived summaries or inferences.
- Information not known or not supported.

Do not represent inferred claims as verified facts. Avoid collecting sensitive personal information that is not needed for the portfolio.

### 3.3 Initial data sources

The first implementation should support two source types:

1. **Structured profile source:** a developer-maintained file or object containing canonical profile facts.
2. **GitHub source adapter:** retrieves selected public profile and repository information through GitHub's supported public/API capabilities.

Keep the initial source scope deliberately narrow. Do not add LinkedIn, X, personal blogs, arbitrary websites, or other social platforms during the MVP unless explicitly approved.

Source-specific fetching and normalization should be separated from the common profile representation. Source data should not leak provider-specific assumptions into the AI-facing core API.

### 3.4 Ingestion, normalization, and refresh

Create a pipeline that can:

1. Fetch or read source data.
2. Validate source responses and expected fields.
3. Normalize source-specific records into the canonical profile model.
4. Preserve provenance and observation timestamps.
5. Handle partial failures without silently replacing valid data with invalid or empty data.
6. Compare new data with the current profile version.
7. Publish an updated version when meaningful data changes.
8. Invalidate or recompute cached answers that depend on changed data.

The first version may run ingestion manually or at application startup if that is the smallest reliable design. A scheduled refresh mechanism can be added when the runtime and deployment model are known. Do not add queues or a complex orchestration service prematurely.

Define freshness behavior explicitly. A failed source refresh should be observable and should not falsely imply that stale data is current. Store enough status information to distinguish a successful refresh, a partial failure, and a previous known-good version.

### 3.5 AI response generation

- Use a general-purpose model through an approved provider/library integration.
- Keep model interaction behind a reusable interface where this meaningfully helps the library consumer.
- Support streaming responses if the chosen integration and UI allow it without excessive complexity.
- Provide the model with only the profile context or tool results needed for the current request.
- Prefer structured lookup and deterministic tools for known profile facts before introducing semantic search.
- Responses must be grounded in the supplied profile evidence.
- If the data does not support an answer, the assistant should say so or ask a clarifying question rather than inventing details.
- Avoid unsupported superlatives, fabricated metrics, implied verification, or claims of ownership/contribution that sources do not establish.
- Keep model prompts and orchestration separate from UI components.
- Record enough information to debug failures without logging secrets or unnecessary visitor data.

For terminology, treat this as a **constrained/domain-specific conversational assistant** powered by a general model. Do not claim that the MVP is a small language model (SLM), and do not train a model as part of this scope.

### 3.6 Initial tools and retrieval

Start with a small set of explicit tools that answer useful portfolio questions. Candidate capabilities include:

- Search or filter structured profile facts.
- Retrieve details about a project, role, skill, or public repository.
- Fetch approved, current GitHub data when needed, subject to rate limits and availability.
- Prepare a contact action for confirmation.

Tool inputs must be validated. Tool execution and permissions are controlled by application code, not by the model. Return compact, typed results with source references where possible.

Do not start with a vector database or advanced RAG. Structured profile lookup is the default for the MVP. Add semantic retrieval only when concrete evaluation examples show that deterministic lookup is insufficient.

### 3.7 Seeded conversations and caching

Seeded conversation starters should be useful, not merely decorative buttons. A starter may display a prepared answer or initiate a stored/constructed conversation, but its behavior must be consistent with the current profile data.

If prepared answers are cached:

- Associate each answer with the relevant profile version and any other dependencies that affect correctness.
- Invalidate or recompute an answer when relevant profile facts change.
- Avoid serving an answer known to be stale.
- Make cache behavior testable.
- Use a simple cache strategy appropriate to the actual deployment; do not add infrastructure without a clear need.

A cache miss or invalidated answer should degrade gracefully into normal generation. Do not hard-code a response that silently contradicts newer profile data.

### 3.8 Conversation persistence

Persist conversation history only to the extent needed for visitors to continue a conversation within the supported product experience.

- Define whether history is scoped to a browser session, visitor, or account; the MVP should not assume authenticated user accounts.
- Do not expose one visitor's conversation to another.
- Keep stored messages and metadata minimal.
- Establish sensible retention and size limits.
- Treat message content as untrusted input.
- Make storage replaceable if that is practical, but avoid a generic persistence framework before there are multiple real implementations.

If durable persistence materially increases MVP complexity, propose a simpler session-scoped first step and explain the trade-off before implementation.

### 3.9 Contact workflow

Provide a way for an interested visitor to contact the profile owner.

- The assistant may collect or clarify the visitor's message and prepare a contact email.
- Show the intended recipient and message content before sending.
- Require explicit visitor confirmation before any email is sent.
- Validate and limit user-supplied fields.
- Keep email provider credentials server-side.
- Handle provider failures clearly; do not claim a message was sent unless the provider confirms success.
- Apply basic abuse protection and rate limits.
- Do not allow model output alone to choose arbitrary recipients or bypass confirmation.

Use the profile owner's configured contact address. Do not invent or hard-code an address into reusable package code.

### 3.10 Security, privacy, and reliability

- Treat model output, visitor messages, external source data, and retrieved content as untrusted.
- Prevent prompt injection in retrieved content from changing tool permissions or application rules.
- Enforce authorization, tool allowlists, validation, rate limits, and confirmation in code.
- Keep secrets in server-side environment/configuration and out of client bundles, source control, and logs.
- Do not expose private profile fields or another visitor's conversation.
- Bound input length, output/token use, tool execution, network requests, and retries.
- Handle unavailable providers, malformed source responses, rate limits, and partial failures.
- Provide useful error states without exposing stack traces, tokens, or internal secrets.
- Document required environment variables and safe local setup.
- Do not claim the assistant is perfectly accurate or that external sources verify facts they do not establish.

### 3.11 Reusable-library validation and documentation

The app must consume reusable workspace packages through their public interfaces.

- Keep application-specific profile content, secrets, runtime configuration, and deployment details in the app or its configuration.
- Document package responsibilities and public entry points.
- Include setup instructions, required environment variables, and how to run tests/checks.
- Verify that a second, distinct profile or small consumer can use the library with configuration/data changes rather than editing the library implementation.
- Keep examples minimal and aligned with the actual API.
- Do not publish packages or deploy publicly without explicit authorization.

## 4. Architecture principles and constraints

### 4.1 Library-first monorepo

Use a PNPM TypeScript workspace. Keep apps and packages in separate top-level areas, for example:

- `apps/portfolio` — reference portfolio UI and app-specific configuration.
- `packages/...` — reusable domain, source, AI, and UI functionality as justified by real boundaries.
- `docs/` — product roadmap and important design decisions.

#### Role of the packages and the reference application

- **Packages are stack-agnostic building blocks.** The `@promptfolio/*` packages do not ship a complete UI or a backend server. They provide profile, source, AI, and related functionality that a developer can integrate into the UI framework, server, and hosting platform of their choice.
- **`apps/portfolio` is the full-stack reference implementation.** It shows developers how to build a promptfolio with the packages, and it is the environment used to develop and test the packages over time.
- **The reference application is profile-independent.** It contains no hard-coded personal data. A developer should be able to clone it, supply their own profile data and environment variables, and deploy their own promptfolio website without changing application or package code. Profile-specific data and secrets are supplied through configuration, data files, and environment variables.

This is a conceptual starting point, not a mandate to create every possible package immediately. Decide package boundaries during repository discovery and the approved foundation milestone. A small number of cohesive packages is preferable to many thin packages.

Potential responsibilities may eventually include:
- Canonical profile types and validation.
- Source interfaces and adapters.
- AI orchestration and typed tools.
- React-facing hooks/components.
- Persistence/cache implementations.

Only split these into separate packages when the boundary is useful and the public API can be kept clear.

### 4.2 Dependency direction

- The application may depend on reusable packages.
- Reusable packages must not depend on the application.
- Core profile/domain types should not depend on UI frameworks or model-provider SDKs unless a deliberate, documented decision justifies it.
- Provider adapters implement interfaces owned by the appropriate reusable layer, rather than leaking provider-specific types through every package.
- Avoid circular dependencies and accidental imports from package internals.
- Keep public exports explicit.

### 4.3 Technology decisions

- Language: TypeScript.
- Package manager/workspaces: PNPM.
- Frontend: choose a current, maintainable React-based setup appropriate to the existing repository; do not introduce a framework without a reason.
- AI integration: evaluate TanStack AI and Vercel AI SDK against the current project needs and actual stable APIs before committing. The first version should focus on core model/chat/tool APIs. Do not base the MVP on an experimental agent harness unless the developer explicitly approves that risk.
- Persistence: choose the smallest solution that supports the approved session/conversation requirements.
- Data retrieval: structured lookup first; no vector database by default.
- Deployment: defer provider-specific deployment decisions until the application works locally and requirements are clear.

Before selecting or changing a significant dependency, explain compatibility, API maturity, maintenance, complexity, and relevant alternatives.

### 4.4 Reuse rather than reinvent

Prefer established tools for chat streaming, schema validation, HTTP access, persistence, and email delivery when they fit. Do not build a custom model client, streaming protocol, job queue, vector database, or general agent framework merely for learning. Learning should come from understanding the integration and its trade-offs.

## 5. Testing and evaluation requirements

### Conventional tests

Test:
- Profile schema validation and normalization.
- Source adapter parsing, malformed responses, and partial failures.
- Provenance preservation and profile version changes.
- Tool input validation, authorization, and error behavior.
- Cache keys, freshness, invalidation, and fallback behavior.
- Conversation isolation and persistence limits.
- Contact confirmation, validation, and provider failure handling.
- Public package exports and the second-consumer use case.
- UI loading, error, retry, and confirmation states where practical.

Use unit tests for deterministic logic and integration tests for important package boundaries. Do not rely on live external services for every test; mock external calls and test adapters against representative fixtures.

### AI evaluation

Maintain a small set of representative questions and expected evidence/behavior, including:
- Questions answerable from structured facts.
- Questions requiring a source lookup.
- Questions with insufficient evidence.
- Questions that invite exaggerated claims.
- Prompt-injection attempts embedded in source data.
- Tool requests that must be rejected or confirmed.

Evaluate whether answers use supported evidence, preserve uncertainty, avoid invented claims, and use tools appropriately. Prefer deterministic assertions about tool calls, citations/evidence references, and required constraints over brittle exact-string matching. A fluent answer alone is not proof of correctness.

## 6. MVP acceptance criteria

The MVP is acceptable when the approved implementation satisfies these outcomes:

1. The project has a working PNPM TypeScript monorepo with clear app/package boundaries.
2. The portfolio app consumes reusable packages through public interfaces.
3. A visitor can use the chat workspace, start from a seeded prompt, and ask follow-up questions.
4. The assistant answers supported questions using canonical profile data and/or approved source results.
5. The assistant communicates when evidence is missing and does not knowingly invent profile facts.
6. Structured profile data and public GitHub data can be normalized into the common model, with provenance retained.
7. Refresh/version behavior avoids silently replacing valid data with failed or malformed results.
8. Cached seeded answers cannot knowingly remain stale after relevant profile changes.
9. Conversation history follows the documented scope and is not exposed across visitors.
10. Contact email sending requires explicit confirmation and reports success/failure truthfully.
11. Secrets remain server-side; tool permissions and validation are enforced by code.
12. Relevant tests, type checks, lint/build checks, and AI evaluation examples are documented with actual results.
13. Setup and package usage are documented.
14. A second distinct profile/consumer can use the library without editing reusable package internals.
15. Each milestone was implemented and reviewed incrementally; no full-MVP one-shot generation was used.

The exact persistence, refresh scheduling, and deployment approach may be simplified if the developer approves the trade-offs before implementation.

## 7. Implementation reference

The full milestone sequence, dependency ordering, and deferred ideas live in [`docs/ROADMAP.md`](docs/ROADMAP.md). `CLAUDE.md` contains the always-relevant agent workflow and safety rules; this specification is the source of truth for product behavior and acceptance criteria.

When requirements conflict, stop and explain the conflict rather than silently choosing whichever wording is easiest to implement. The developer approves meaningful changes to scope and architecture.
