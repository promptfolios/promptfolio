# ADR 0011: Contributions as commits attributed to the owner

- **Status:** Accepted
- **Date:** 2026-10-30

## Context

M8 reads only the owner's own repositories ([ADR 0009](0009-github-source-as-fetched-snapshot.md)),
so work on other people's projects is invisible. A pin or a fork shows interest, not work. Merged
pull requests are good evidence but miss projects that take changes through their own review system
or through direct commits, because no merged pull request exists on GitHub.

## Decision

1. **The evidence is a commit** that GitHub attributes to the owner, on the default branch of another
   owner's public repository, found with one commit search of up to 3 pages. Pins only rank results;
   forks and pins without commits make no record.
2. **A new source-neutral `Contribution` record** in core: the id is a source key
   (`github.com/<owner>/<name>/commit/<hash>`), and it holds the first line of the message, the
   repository, and the month. Up to 5 per repository and 15 in total, latest first. Change sizes,
   counts, stars, and the commit author's name and email are never stored.
3. **Public is enforced in code:** the query says `is:public`, and a result is dropped unless its own
   `private` flag is `false`.
4. **Mirrors:** a hash found in several repositories stays in the one with most stars (one request per
   such repository; stars are not stored), ties alphabetically.
5. **The step succeeds or fails as a whole, and never fails a run that has an earlier snapshot:** on
   failure all earlier contributions are kept with their dates, and the run is partial.
6. **Owner control:** `excludeContributionsTo` hides a repository, and a project with a repository's
   id is the owner's notes for contributions to it.

Alternatives considered: merged pull requests only (better titles, but miss those projects); commits
and pull requests together (two searches and two record forms; can be added if headlines prove too
weak); a "pinned" record (true, but invites implying involvement); GraphQL `contributionsCollection`
(needs a token); change sizes (more requests, and invites size claims).

## Consequences

- Attribution rests on the commit's author email, which anyone can set, and GitHub does not verify it.
  The prompt says "attributes", and the owner can hide a repository.
- Commit headlines say less than pull request titles.
- Only 300 commits are read, so a very active repository can push older work elsewhere out of reach.
- Commits with an email not linked to the account are not found, and only default branches are searched.
- A new commit in an active repository makes a new profile version, so prepared answers go stale
  more often; they are answered live until regenerated.
- Details: [M8.1 plan](../plans/m8-1-github-contributions.md), learning note on
  [contributions and evidence](../learning/contributions-and-evidence.md).
