# ADR 0006: Profile data location in the reference app

- **Status:** Accepted
- **Date:** 2026-10-27

## Context

`apps/portfolio` must stay profile-independent so anyone can clone it and supply their own data,
while the profile owner needs to develop against real data without committing it. Profile data
must stay out of reusable package code.

## Decision

- Profile files are JSON files in `apps/portfolio/profile/`.
- The repository commits only `example.profile.json`, which contains fictional data.
- The app loads the file named by the `PROMPTFOLIO_PROFILE_FILE` environment variable (a file name
  inside `profile/`), defaulting to the example. Paths outside `profile/` are rejected.
- Real profiles live in `*.local.json` files, which `.gitignore` excludes. The variable is set in
  `apps/portfolio/.env.local` (also ignored); `.env.example` documents it.
- There is no silent fallback from a configured file to the example: a missing or invalid file is
  reported, so a deployment cannot quietly show a fictional person.
- File reading happens in the app (`src/server/profile.ts`); `core` receives parsed data and a
  source description, including the file's modification time as `observedAt`.

Alternatives considered: committing real data (breaks profile independence), a TypeScript data
file (executable code), and YAML (an extra parser dependency).

## Consequences

- The production deployment mechanism for a real profile is undecided: a gitignored file is not
  part of a Git-based deployment. Options (a deployment repository, build-time injection, or a
  fetched URL) are decided with the deployment approach (M12).
- The home page is statically prerendered, so in production builds the profile is read at build
  time; refresh behavior is revisited in M9.
- *Update (M8):* a profile can have a GitHub configuration and snapshot next to it
  (`<profile>.github.json`, `<profile>.github-snapshot.json`), gitignored for `*.local` profiles
  like the profile. The fictional example has no GitHub source; a real profile with its GitHub
  source belongs in the owner's own deployment repository, decided with deployment
  ([ADR 0009](0009-github-source-as-fetched-snapshot.md)).
