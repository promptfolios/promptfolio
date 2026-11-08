# Learning notes

Short notes on the concepts behind Promptfolio, each tied to where it appears in this codebase.
They complement the [architecture overview](../ARCHITECTURE.md) (what the structure is) and the
[ADRs](../adr/) (why a decision was made) by explaining *how a concept works here*.

Notes are for AI concepts and other hard or non-obvious ideas, not a log of implementation
changes: a new field, log line, or option is described by the code, its tests, and the changeset.

Every note follows the same template: what it is, why it matters in Promptfolio, how it works,
where it lives in the code, common pitfalls, and further reading (official docs only).

Status: **in use** (built and exercised by code), **planned** (described ahead of the milestone
that builds it; code links are marked "planned").

| Concept                         | File                                                         | First appears | Status  |
| ------------------------------- | ------------------------------------------------------------ | ------------- | ------- |
| Structured data vs. prompt text | [structured-data-vs-prompt.md](structured-data-vs-prompt.md) | M2            | in use  |
| Provenance and claim basis      | [provenance-and-basis.md](provenance-and-basis.md)           | M2            | in use  |
| Record ids                      | [record-ids.md](record-ids.md)                               | M2            | in use  |
| Validation at boundaries        | [validation-at-boundaries.md](validation-at-boundaries.md)   | M2            | in use  |
| Chat runtime and threads        | [chat-runtime-and-threads.md](chat-runtime-and-threads.md)   | M3            | in use  |
| System prompt                   | [system-prompt.md](system-prompt.md)                         | M4            | in use  |
| Context selection               | [context-selection.md](context-selection.md)                 | M4            | in use  |
| Model requests and tokens       | [model-requests-and-tokens.md](model-requests-and-tokens.md) | M4            | in use  |
| Streaming                       | [streaming.md](streaming.md)                                 | M4            | in use  |
| Server-side secrets             | [server-side-secrets.md](server-side-secrets.md)             | M4            | in use  |
| Tool calling                    | [tool-calling.md](tool-calling.md)                           | M5            | in use  |
| Browser persistence             | [browser-persistence.md](browser-persistence.md)             | M6            | removed in M18.2 |
| Setting the theme before the page paints | [theme-before-paint.md](theme-before-paint.md) | M12.8 | in use |
| Generated starter questions | [generated-starter-questions.md](generated-starter-questions.md) | M12.9 | in use |
| Links in answers | [links-in-answers.md](links-in-answers.md) | M12.7 | in use |
| Prepared answers and invalidation | [prepared-answers-and-invalidation.md](prepared-answers-and-invalidation.md) | M7 | removed in M12.5 |
| Source adapters and snapshots   | [source-adapters-and-snapshots.md](source-adapters-and-snapshots.md) | M8 | in use |
| Calling external APIs           | [calling-external-apis.md](calling-external-apis.md)         | M8            | in use  |
| Contributions and evidence     | [contributions-and-evidence.md](contributions-and-evidence.md) | M8.1 | in use |
| Refresh status and last known good | [refresh-status-and-last-known-good.md](refresh-status-and-last-known-good.md) | M9 | in use |
| Scheduled jobs                  | [scheduled-jobs.md](scheduled-jobs.md)                       | M9            | planned |
| Contact confirmation and idempotency | [contact-confirmation-and-idempotency.md](contact-confirmation-and-idempotency.md) | M10 | in use |
| Abuse protection on serverless  | [abuse-protection-on-serverless.md](abuse-protection-on-serverless.md) | M10 | in use |
| Prompt-injection exposure       | [prompt-injection-exposure.md](prompt-injection-exposure.md) | M11.1 | in use |
| AI evaluation                   | [ai-evaluation.md](ai-evaluation.md)                         | M11.3 | in use |
| Public API and a second consumer | [public-api-and-second-consumer.md](public-api-and-second-consumer.md) | M12.1 | in use |
| Peer dependencies | [peer-dependencies.md](peer-dependencies.md) | M13.1 | in use |
| Package exports and builds | [package-exports-and-builds.md](package-exports-and-builds.md) | M13.3 | in use |
| Versioning and releases | [versioning-and-releases.md](versioning-and-releases.md) | M13.4 | in use |
| Continuous integration | [continuous-integration.md](continuous-integration.md) | M13.4 | in use |
| Provider failover | [provider-failover.md](provider-failover.md) | M14 | in use |
| Server-side conversation history | [server-side-history.md](server-side-history.md) | M18.1 | in use |

Add or update a note whenever a milestone introduces or changes a concept (see `CLAUDE.md`,
"Learning documentation").
