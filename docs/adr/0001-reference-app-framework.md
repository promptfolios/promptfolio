# ADR 0001: Next.js for the reference application

- **Status:** Accepted
- **Date:** 2026-10-27

## Context

The `@promptfolio/*` packages are stack-agnostic and do not ship a complete UI or server.
`apps/portfolio` is the full-stack reference implementation: it needs a UI, server-side routes for
model calls (to keep provider credentials out of the browser) with streaming responses, and a
simple, free deployment path that other developers can clone and reuse.

The project's primary goal is learning AI engineering, not learning a new web framework.

Long-running servers on free hosting tiers sleep after inactivity, and their cold starts are slow
enough to lose visitors.

## Options considered

1. **Next.js (App Router).** Mature; the developer has prior experience; first-class Vercel
   deployment; the Vercel AI SDK documentation uses Next.js route handlers for its examples.
   Downsides: heavier development server in a monorepo (previously observed in another project),
   additional framework concepts (Server Components, caching), and a pull towards Vercel.
2. **TanStack Start.** Vite-based, documented as stable, server-rendered, with server routes and
   several documented hosting targets. Downsides: no prior experience, smaller ecosystem, and fewer
   AI integration examples; learning it would compete with the AI learning goal.
3. **Vite + React SPA with a Hono server.** Lightest and most explicit; Hono deploys serverlessly
   (for example on Vercel) without a sleeping long-running server. Downsides: no server rendering
   for link previews, and more manual wiring of two entry points into one deployment.

## Decision

Use **Next.js** for `apps/portfolio`.

To limit its downsides:

- Keep the app deliberately plain: a client-side chat page and plain route handlers that accept a
  `Request` and return a `Response`. Avoid server actions and Next.js caching features unless a
  later milestone justifies them.
- Keep all Next.js-specific code inside `apps/portfolio`; packages remain framework-agnostic.
- Track development-server memory use. Baseline at M1: about 272 MB working set for the dev server
  process after serving the home page (Next.js 16.4.3 with Turbopack, Windows 11).

## Consequences

- **Serverless deployment assumption.** Targeting Vercel (or a similar serverless host) means no
  in-memory state survives between requests. The answer cache (M7), profile versions (M9), and rate
  limits (M10) will need small external storage, and scheduled refresh will need a cron trigger.
  This applies regardless of framework; storage choices are made in those milestones.
  *Update (M7):* the answer cache needed no external storage: prepared answers are files deployed
  with the profile and checked against content fingerprints on every request
  ([ADR 0008](0008-prepared-answers-as-files.md)).
  *Update (M9):* profile versions needed none either: the version is the content fingerprint, and
  refresh status is a file written next to the snapshot. The cron trigger is a documented GitHub
  Actions workflow ([ADR 0010](0010-refresh-status-and-content-versions.md)).
  *Update (M10.1):* as expected here, the contact limit needed small external storage: Upstash Redis
  holds one email per visitor per day, a host's firewall stops bursts, and the email provider's
  idempotency key stops duplicates ([ADR 0012](0012-contact-workflow.md)). M11 reviews this together
  with chat limits.
- Workspace packages are consumed from TypeScript source. Next.js 16.4 (Turbopack) compiles them
  without `transpilePackages`.
- Next.js 16.4 type-checks with the project-local `tsc` CLI by default, so TypeScript 7 works for
  `next build`.
