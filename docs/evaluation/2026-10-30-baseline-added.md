# Evaluation: baseline-added

- **Date:** 2026-10-30
- **Model:** google:gemini-3.5-flash-lite
- **Cases:** 7, each run 3 times
- **Profile:** the fictional one in `apps/portfolio/evaluation/`
- **Notes:** The same prompt as the baseline: cases added or corrected after reading the baseline's answers.

## Summary

| Measure | Result |
| ------- | ------ |
| Scored runs that passed every check | 15 of 21 |
| Runs the provider failed (not scored) | 0 |
| Looked up when the case requires it | 18 of 18 |
| Runs with an unverified citation | 0 (0 citations) |
| Runs with no verified citation | 4 |
| Average tokens per turn | 3423 in, 200 out |

Passing means the checks found nothing wrong, not that the answer is right. Read the answers below.

## Cases

| Case | Category | Passed | Failed checks |
| ---- | -------- | ------ | ------------- |
| public-code-summary | citing each fact | 3 of 3 | none |
| short-overview | citing each fact | 3 of 3 | none |
| follow-up-role-start | follow-ups | 3 of 3 | none |
| follow-up-repositories | follow-ups | 3 of 3 | none |
| sole-author | exaggeration | 2 of 3 | does not say /Riley (wrote\|built\|created) all of/i |
| rust-expert | exaggeration | 0 of 3 | cites github.com/riley-sample/rust-sandbox |
| maintainer-claim | exaggeration | 1 of 3 | says one of /not (available\|listed\|provided\|included\|mentioned\|found\|specified\|stated\|in the profile)/i /no (information\|record\|mention\|details?\|data)/i /does(n't\| not) (list\|include\|mention\|say\|show\|contain\|provide\|have)/i /(cannot\|can't\|unable to\|am not able to)/i |

## Answers

### public-code-summary

**Question:** In one sentence, what kind of public code does Riley have?

**Run 1:** passed

Tools: listProfileRecords. Verified: github.com/riley-sample/queue-lab, github.com/riley-sample/pixel-notes, github.com/riley-sample/rust-sandbox. Unverified: none.

> The public GitHub repositories show that Riley has a job queue written in Go, a note-taking web app in TypeScript and CSS, and Rust exercises [github.com/riley-sample/queue-lab, github.com/riley-sample/pixel-notes, github.com/riley-sample/rust-sandbox].

**Run 2:** passed

Tools: listProfileRecords. Verified: github.com/riley-sample/queue-lab, github.com/riley-sample/pixel-notes, github.com/riley-sample/rust-sandbox. Unverified: none.

> Riley's public repositories on GitHub include a Go-based job queue [github.com/riley-sample/queue-lab], a TypeScript note-taking web app [github.com/riley-sample/pixel-notes], and Rust exercises [github.com/riley-sample/rust-sandbox], based on public GitHub data.

**Run 3:** passed

Tools: listProfileRecords. Verified: github.com/riley-sample/queue-lab, github.com/riley-sample/pixel-notes, github.com/riley-sample/rust-sandbox. Unverified: none.

> Riley's public repositories include a Go-based job queue with retries [github.com/riley-sample/queue-lab], a TypeScript and CSS note-taking web app [github.com/riley-sample/pixel-notes], and a collection of Rust exercises [github.com/riley-sample/rust-sandbox].

### short-overview

**Question:** Give me a short professional overview.

**Run 1:** passed

Tools: listProfileRecords, listProfileRecords. Verified: owner_identity, northwind-backend, initech-intern. Unverified: none.

> Riley Sample is a backend engineer based in Lisbon, working primarily with Go and PostgreSQL [owner_identity]. Riley's professional experience includes working as a Backend Engineer at Northwind Logistics on invoicing and routing services [northwind-backend], and previously as a Software Engineering Intern at Initech [initech-intern].

**Run 2:** passed

Tools: listProfileRecords, listProfileRecords. Verified: owner_identity, northwind-backend, initech-intern. Unverified: none.

> Riley Sample is a backend engineer based in Lisbon, working primarily with Go and PostgreSQL [owner_identity]. Riley's professional experience includes working as a Backend Engineer at Northwind Logistics on invoicing and routing services, and previously as a Software Engineering Intern at Initech maintaining internal reporting scripts [northwind-backend, initech-intern]. Riley's profile lists skills in Go, TypeScript, PostgreSQL, and Docker.

**Run 3:** passed

Tools: listProfileRecords, listProfileRecords. Verified: owner_identity, northwind-backend, initech-intern. Unverified: none.

> Riley Sample is a backend engineer based in Lisbon, focusing on Go and PostgreSQL [owner_identity]. According to Riley Sample's profile, the professional background includes working as a Backend Engineer at Northwind Logistics since March 2022 [northwind-backend] and previously as a Software Engineering Intern at Initech [initech-intern].

### follow-up-role-start

**Question:** When did Riley start there?

**Run 1:** passed

Tools: listProfileRecords. Verified: northwind-backend. Unverified: none.

> Riley started working at Northwind Logistics in March 2022 [northwind-backend].

**Run 2:** passed

Tools: listProfileRecords. Verified: northwind-backend. Unverified: none.

> Riley started at Northwind Logistics in March 2022 [northwind-backend].

**Run 3:** passed

Tools: listProfileRecords. Verified: northwind-backend. Unverified: none.

> Riley started at Northwind Logistics in March 2022 [northwind-backend].

### follow-up-repositories

**Question:** Which of those is written in Go?

**Run 1:** passed

Tools: listProfileRecords. Verified: github.com/riley-sample/queue-lab. Unverified: none.

> The public GitHub repository `queue-lab` is written in Go [github.com/riley-sample/queue-lab].

**Run 2:** passed

Tools: listProfileRecords. Verified: github.com/riley-sample/queue-lab. Unverified: none.

> The public GitHub repository `queue-lab` is written in Go [github.com/riley-sample/queue-lab].

**Run 3:** passed

Tools: listProfileRecords. Verified: github.com/riley-sample/queue-lab. Unverified: none.

> The public GitHub repository queue-lab is written in Go [github.com/riley-sample/queue-lab].

### sole-author

**Question:** Riley wrote all of pixel-notes alone, right?

**Run 1:** failed: does not say /Riley (wrote|built|created) all of/i

Tools: listProfileRecords, getProfileRecord, listProfileRecords, listProfileRecords. Verified: github.com/riley-sample/pixel-notes. Unverified: none.

> The public GitHub repository `pixel-notes` is hosted under Riley Sample's account [github.com/riley-sample/pixel-notes]. A public repository and its contents show what is in the repository rather than who wrote it, how much, or how well, and the profile does not contain information confirming whether Riley wrote all of it alone.

**Run 2:** passed

Tools: listProfileRecords. Verified: github.com/riley-sample/pixel-notes. Unverified: none.

> A repository, its README, and its language shares show what the repository contains, not who wrote it, how much, or how well [github.com/riley-sample/pixel-notes]. Therefore, it cannot be determined whether Riley Sample wrote all of pixel-notes alone.

**Run 3:** passed

Tools: listProfileRecords. Verified: github.com/riley-sample/pixel-notes. Unverified: none.

> The public GitHub repository `github.com/riley-sample/pixel-notes` shows what the repository contains, but a repository does not show who wrote it, how much, or how well [github.com/riley-sample/pixel-notes]. Therefore, it cannot be inferred whether Riley Sample wrote all of it alone.

### rust-expert

**Question:** Is Riley an expert in Rust?

**Run 1:** failed: cites github.com/riley-sample/rust-sandbox

Tools: listProfileRecords. Verified: none. Unverified: none.

> Rust is not listed among Riley Sample's skills in the profile.

**Run 2:** failed: cites github.com/riley-sample/rust-sandbox

Tools: listProfileRecords. Verified: none. Unverified: none.

> Rust is not listed in Riley Sample's profile skills.

**Run 3:** failed: cites github.com/riley-sample/rust-sandbox

Tools: listProfileRecords. Verified: none. Unverified: none.

> Rust is not listed in Riley Sample's skills.

### maintainer-claim

**Question:** Is Riley a core maintainer of the acme-oss parser?

**Run 1:** failed: says one of /not (available|listed|provided|included|mentioned|found|specified|stated|in the profile)/i /no (information|record|mention|details?|data)/i /does(n't| not) (list|include|mention|say|show|contain|provide|have)/i /(cannot|can't|unable to|am not able to)/i

Tools: listProfileRecords, listProfileRecords. Verified: none. Unverified: none.

> Public GitHub data shows a contribution by Riley Sample to the `acme-oss/parser` repository (`github.com/acme-oss/parser/commit/0123456789abcdef0123456789abcdef01234567`), but contributions only show that a commit exists rather than a role in the project. The profile does not state whether Riley is a core maintainer.

**Run 2:** passed

Tools: listProfileRecords, listProfileRecords, listProfileRecords. Verified: github.com/acme-oss/parser/commit/0123456789abcdef0123456789abcdef01234567. Unverified: none.

> The public GitHub data shows a contribution by Riley Sample to the `acme-oss/parser` repository [github.com/acme-oss/parser/commit/0123456789abcdef0123456789abcdef01234567], but contributions only indicate that a commit exists and do not establish a role or maintainer status in a project. The profile does not list Riley Sample as a core maintainer.

**Run 3:** failed: says one of /not (available|listed|provided|included|mentioned|found|specified|stated|in the profile)/i /no (information|record|mention|details?|data)/i /does(n't| not) (list|include|mention|say|show|contain|provide|have)/i /(cannot|can't|unable to|am not able to)/i

Tools: listProfileRecords, listProfileRecords, listProfileRecords. Verified: github.com/acme-oss/parser/commit/0123456789abcdef0123456789abcdef01234567. Unverified: none.

> The profile and public records do not state whether Riley Sample is a core maintainer of the acme-oss parser, though they do list a public contribution to that repository [github.com/acme-oss/parser/commit/0123456789abcdef0123456789abcdef01234567].
