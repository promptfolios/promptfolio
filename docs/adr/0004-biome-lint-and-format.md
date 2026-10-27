# ADR 0004: Biome for linting and formatting

- **Status:** Accepted
- **Date:** 2026-10-27

## Context

The workspace uses TypeScript 7. At the time of this decision, `typescript-eslint` (8.72.1)
declares support only for TypeScript `>=4.8.4 <6.1.0`, because TypeScript 7 does not yet provide
the JavaScript compiler API it relies on. `eslint-config-next` depends on `typescript-eslint`, so
it is affected as well.

## Options considered

1. **Biome:** one tool and one configuration for linting, formatting, and import sorting; does not
   depend on the TypeScript compiler; React, Next.js, and test rule domains. Fewer rules than the
   ESLint ecosystem.
2. **Oxlint + oxfmt:** ESLint-compatible rules and type-aware linting built on TypeScript 7's
   native engine. Two tools; the formatter was pre-1.0.
3. **ESLint + typescript-eslint + Prettier:** the largest rule ecosystem, but requires installing
   TypeScript 6 alongside TypeScript 7 for linting.

## Decision

Use **Biome**, pinned to an exact version (2.5.15 at adoption) because formatter output can change
between releases. Upgrade deliberately.

Root scripts: `pnpm lint` (`biome check .`, read-only), `pnpm lint:fix`, and `pnpm verify`
(lint, typecheck, test, build).

Biome does not detect React, Next.js, or test domains from nested `package.json` files when run
from the repository root, so `biome.json` enables them explicitly with path-scoped overrides.

## Consequences

- New packages that need React or test rules must be added to the overrides in `biome.json`.
- Accessibility linting is narrower than ESLint's; add a dedicated accessibility check during UI
  work (M3) or hardening (M11).
- Revisit ESLint once typescript-eslint supports TypeScript 7, or Oxlint if stronger type-aware
  rules are needed.
