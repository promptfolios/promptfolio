# ADR 0016: Package builds with tsc

- **Status:** Accepted
- **Date:** 2026-11-02

## Context

The packages exported TypeScript source, which works inside this workspace but not from npm: Node does not strip types under
`node_modules`, and compiled output with extensionless imports fails with `ERR_MODULE_NOT_FOUND`. The workspace should keep
its no-build convenience, because apps and tests see a source change immediately.

## Decision

- **Build with plain `tsc`.** Relative imports use `.ts`, and `rewriteRelativeImportExtensions` turns them into `.js` in the
  output. Every file stays its own module, so `dist/` mirrors `src/`.
- **Two sets of exports.** `exports` keeps pointing at `src` for the workspace, and `publishConfig.exports` points at `dist`.
  pnpm swaps them when it packs.
- **Build against built `core`.** `ai` and `source-github` map `@promptfolio/core` to `core`'s declarations in
  `tsconfig.build.json`, and `pnpm -r build` builds `core` first.
- **`LICENSE` in each package.** npm includes one automatically only from the package's own folder.

## Alternatives

- **`.js` import paths in source:** also works, but they name files that do not exist. Node's own type stripping, Vitest,
  Next.js, and jiti all accept `.ts`.
- **A bundler such as `tsdown`:** a new dependency, with nothing here needing a bundle, and its declaration output with
  TypeScript 7 is unverified.
- **Exports pointing at `dist` in the workspace too:** every source change would need a rebuild before apps and tests saw it.

## Consequences

- `dist/` declarations keep `.ts` import paths. TypeScript resolves those to the `.d.ts` files beside them, checked under NodeNext
  and Bundler. A consumer must use a TypeScript version with this behaviour, so the packed-tarball test covers it.
- The workspace never runs the published entry points, so only a test of the packed tarball can show they work:
  `pnpm test:tarballs`, in CI on each supported Node version.
- `packages/contact` keeps extensionless imports, because it is not being packaged.

## Amendment: source maps and shipped source

Each package also ships its `src` (without tests or fixtures), with source maps and declaration maps in `dist/` that point at
it. Consumers get stack traces and "Go to Definition" in the original TypeScript, as the AI SDK packages do. Because `dist/`
mirrors `src/`, a map's `sources` is a plain relative path such as `../src/index.ts`. The cost is a larger tarball. Shipped
`.ts` files are never resolved by `exports`, which still point only at `dist`.
