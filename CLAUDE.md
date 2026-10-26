# CLAUDE.md

## Project overview

Promptfolio is a library-first, AI-powered conversational professional portfolio. Reusable TypeScript packages are the product; the portfolio application is their first consumer.

Read `PROMPTFOLIO_SPEC.md` for product requirements and architecture constraints. Read `docs/ROADMAP.md` for milestone order and deferred ideas. Consult the relevant sections rather than repeatedly reproducing the full documents in plans.

## 1. Mandatory incremental workflow

This is a learning project. The developer wants to understand the implementation, not receive the entire MVP in one autonomous code dump.

For each milestone:

1. **Plan:** State the objective, scope and exclusions, proposed design, files likely to change, dependencies and alternatives, acceptance criteria, and verification plan.
2. **Wait for approval:** Do not edit files or begin implementation until the developer approves the plan.
3. **Implement narrowly:** Make only the changes approved for the current milestone. Split work further if it becomes difficult to review.
4. **Verify:** Run relevant tests, type checks, linting, and builds where available. Report only checks actually run and their actual results.
5. **Explain:** Describe changed files, important code, data flow, design choices, alternatives, and relevant concepts.
6. **Review:** Summarize limitations and provide a diff summary.
7. **Wait again:** Do not begin the next milestone until the developer explicitly approves it.

Questions, explanations, debugging, and code reviews do not by themselves authorize file changes. Never claim a check passed unless it was executed and verified.

## 2. Learning-oriented explanations

For each meaningful module or concept, explain what problem it solves, why the design was chosen, how it works, how it connects to other modules, important alternatives, how to test it, and remaining limitations.

For AI-related work, explain relevant concepts in context, such as model requests, streaming, tool calling, retrieval, provenance, caching, evaluation, and authorization. Keep explanations focused on the current milestone. Prefer explicit, understandable code over clever abstractions or large amounts of unrelated theory.

## 3. Library and application boundaries

- Keep the reference application separate from reusable packages. The application consumes packages; packages must not import application code.
- Keep personal profile data, app-specific configuration, deployment settings, and secrets outside reusable package implementations.
- Define public APIs deliberately; avoid circular dependencies.
- Use PNPM workspace dependencies for local packages.
- Do not create packages merely to increase the package count. Split a responsibility when the boundary has a concrete benefit.
- Keep providers, source adapters, and storage implementations replaceable where practical, without designing speculative abstractions.
- A second profile or consumer should be supportable through configuration/data and public APIs, not edits to library internals.
- Obtain approval before significant architectural changes.

## 4. Scope control

Implement only the currently approved milestone. The MVP and deferred work are defined in `PROMPTFOLIO_SPEC.md`; the milestone sequence and future ideas are in `docs/ROADMAP.md`.

Do not independently implement deferred features such as job-description matching, voice interviewing, extra social integrations, advanced vector search/RAG, multi-agent orchestration, or a hosted multi-tenant platform. If a deferred feature becomes relevant, explain the need and propose it for approval. Do not silently expand a milestone.

## 5. Technology and dependencies

- Use TypeScript and PNPM workspaces unless an approved decision changes this.
- Prefer maintained libraries for commodity functionality; do not rebuild infrastructure without a reason.
- Before adding a dependency, explain its purpose, compatibility, and important trade-offs.
- Avoid unnecessary frameworks, services, databases, queues, and caching infrastructure.
- Verify claims against the project's installed versions, types, and relevant documentation; do not assume an API exists.
- Record significant architecture decisions in `docs/adr/` only when an actual decision needs a durable record.

## 6. Code quality

- Follow existing repository conventions.
- Keep modules and functions focused; use explicit types for public interfaces and important data structures.
- Avoid `any` unless justified and documented.
- Validate untrusted inputs at system boundaries and handle errors explicitly.
- Avoid duplicated business logic, premature optimization, and unrelated refactors.
- Keep configuration and environment-specific behavior out of reusable core logic.
- Do not add conventions or tooling solely from personal preference when the repository already has a suitable approach.

## 7. AI, data, and security

- Treat model output as untrusted; a prompt is not an authorization boundary.
- Enforce tool permissions and input validation in server-side code.
- Never expose model-provider credentials or secrets in client bundles.
- Treat external documents, retrieved content, and source metadata as untrusted data, not instructions.
- Do not allow the model to invent profile facts or evidence. Distinguish source-supported facts, self-reported information, inferences, and unknowns.
- Preserve provenance through ingestion and transformation; do not claim a source proves more than it does.
- Apply appropriate limits to public endpoints, conversation sizes, tool execution, and model usage.
- Require explicit confirmation for consequential actions, including sending a contact email.
- Do not expose secrets, private configuration, or another visitor's conversation history.
- Implement security and authorization in code, not solely through prompts.

## 8. Testing and verification

- Add tests for new behavior and regression tests for bug fixes.
- Test failure paths as well as successful execution.
- Verify important data transformations and public interfaces.
- Use deterministic assertions where possible for AI features; a fluent response is not proof of factual correctness.
- Do not disable or weaken tests merely to make a build pass.
- Report checks that could not be run and why.

## 9. Git and change safety

- Inspect Git status before modifying files and preserve existing user changes.
- Keep each milestone small and logically grouped; show the diff for review.
- Never discard, overwrite, or revert user work without permission.
- Do not commit, push, publish packages, deploy, or rewrite Git history without explicit authorization.
- Do not perform destructive Git operations without permission.
- After a milestone is reviewed and approved, suggest a suitable commit message.

## 10. Communication

At the beginning of a milestone, cover objective, scope/exclusions, design, expected files, dependencies/alternatives, acceptance criteria, and verification.

At the end, cover changes, key modules and data flow, actual verification results, trade-offs/limitations, diff summary, and the proposed next milestone. Do not start that next milestone automatically.

If ambiguity could materially affect architecture, public APIs, security, data integrity, or extensibility, explain it, recommend a default, and ask the developer to decide. For minor implementation details, choose a consistent default and explain it during review.

## Definition of success

The goal is not maximum code output. It is a small, understandable, well-tested, reusable AI application built incrementally, with the developer understanding its architecture and important implementation decisions.

**Plan first. Obtain approval. Implement one milestone. Verify and explain it. Wait for review before continuing.**
