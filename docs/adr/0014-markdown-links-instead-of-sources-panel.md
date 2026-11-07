# ADR 0014: Markdown links in answers instead of citations and a sources panel

- **Status:** Accepted
- **Date:** 2026-11-01

## Context

From M11.2, the model cited record ids in square brackets. The server checked each one against the records returned in
that turn and sent a sources block, which the page drew as numbered markers and a panel below the answer.

The developer wants answers to read like a general chat assistant's: record names as ordinary links, with nothing added
below them. A panel also said little to most visitors, and models kept getting the bracket format wrong
([the evaluation](../evaluation/README.md)).

## Decision

1. The model links a record's name to the `url` a tool result gives it, in Markdown. A record without a url gets no link.
2. The citation check, the `data-sources` chunk, the markers, and the panel are removed.
3. **Only an exact URL from the profile's structured fields becomes a link.** `profileLinkUrls` in `@promptfolio/core`
   collects them, the page passes them to the chat, and the Markdown link component shows anything else as plain text.
   README text is not read, because a README can link anywhere.
4. Attribution stays in the answer's words: the prompt still asks the model to say whose claim a fact is, and to give the
   source, basis, and observation date when asked.

The check runs on rendered links in the browser, not on the stream on the server. The risk is to the visitor reading the
answer, and a visitor can already send the server anything, so the browser is the right place. It also covers every way
Markdown can write a link, needs no change to streaming, and applies to saved threads.

## Alternatives

- **Keep citations and add links.** It keeps the check, but the answer then shows the ids or markers the developer wants
  gone.
- **Keep the check on the server and show nothing.** The model would still have to write ids in its text for the server to
  read, and those would have to be hidden.
- **Trust the prompt to keep links honest.** A prompt is not a boundary. Text in a public source could get the model to
  write a link that sends the conversation to another site.
- **Allow any link on a known host, such as `github.com`.** Anyone can publish a page there, and a query string can still
  carry conversation text.

## Consequences

- A visitor no longer sees the basis and observation date unless they ask. They remain in every tool result.
- **Nothing shows which record a sentence relies on.** Roles, education, and the identity summary usually have no URL, so
  those answers carry no link. A fact the model invents shows no warning, as before, and now has no missing citation to
  count either.
- The evaluation is weaker: it checks that tools returned the expected records and that links stay in the profile, not
  that an answer used those records. A person reading the answers matters more.
- Earlier evaluation results measured citations, so they are not comparable on those rows.
- Links to the visitor are stricter than before. Until now, any `http` link the model wrote was clickable.
- Threads saved earlier keep their messages. Their stored sources are dropped, and old answers show raw `[record-id]` text.
- A consumer with its own UI has to apply the same rule to links. `profileLinkUrls` gives it the list.
- **2026-11-07:** `listProfileRecords` now returns each project's `links` in its summary, as repository summaries
  already returned `url`. Links are how answers show sources, and a model can only link a url it saw in a tool result.
  Weaker models often answer after the list without calling `getProfileRecord`, and wrote answers with no links or `#`
  placeholders. Roles have no links in the schema, so they are unchanged.
