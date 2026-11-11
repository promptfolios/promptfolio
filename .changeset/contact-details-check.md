---
"@promptfolio/core": minor
---

New `findContactDetails(data)` reports text in raw profile data that looks like an email address or phone number (`mailto:` and `tel:` links, and runs of 10 to 15 digits), as `ProfileIssue`s with their paths. It is a heuristic and only reports: a store's checks can fail on a finding, and a consumer can leave the text out before rendering it or sending it to a model.
