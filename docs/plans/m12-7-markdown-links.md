# M12.7 plan: Markdown links instead of the sources panel

- **Status:** Done (2026-11-01), in review.
- **Date:** 2026-11-01
- **Decision:** [ADR 0014](../adr/0014-markdown-links-instead-of-sources-panel.md)

## Objective

Answers read like a general chat assistant's: record names as inline links, with no `[1]` markers and no sources panel.

## Scope

- **Removed:** citations in the prompt, the server's citation check and `data-sources` chunk, the markers, the panel, and
  the `citedIds` export.
- **Added:** a prompt rule to link a record's name to its exact `url`, `profileLinkUrls` in `@promptfolio/core`, and a
  `ProfileLink` component that shows anything outside the profile as plain text.
- **Evaluation:** every turn must link only inside the profile. A case's `cites` became `returns` (the tools returned
  that record) and `links` (the answer links that URL).
- **Saved threads:** old sources parts are dropped on load, so those messages are kept.

## Exclusions

- The model and provider did not change.
- Dated evaluation results stay as written, and no new live evaluation was run.

## Verification

- `pnpm verify`. The test count falls because the citation tests went with the code.
- In the browser: a live answer about GitHub showed its repositories and commits as links, all from the profile, with no
  panel or markers.
- Tests: links outside the profile show as plain text, and a thread saved with sources still loads and continues.
