# Learning notes

Short notes on the concepts behind Promptfolio, each tied to where it appears in this codebase.
They complement the [architecture overview](../ARCHITECTURE.md) (what the structure is) and the
[ADRs](../adr/) (why a decision was made) by explaining *how a concept works here*.

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
| Browser persistence             | [browser-persistence.md](browser-persistence.md)             | M6            | in use  |
| Prepared answers and invalidation | [prepared-answers-and-invalidation.md](prepared-answers-and-invalidation.md) | M7 | in use |
| Source adapters and snapshots   | [source-adapters-and-snapshots.md](source-adapters-and-snapshots.md) | M8 | in use |
| Calling external APIs           | [calling-external-apis.md](calling-external-apis.md)         | M8            | in use  |
| Refresh status and last known good | [refresh-status-and-last-known-good.md](refresh-status-and-last-known-good.md) | M9 | in use |
| Scheduled jobs                  | [scheduled-jobs.md](scheduled-jobs.md)                       | M9            | planned |

Add or update a note whenever a milestone introduces or changes a concept (see `CLAUDE.md`,
"Learning documentation").
