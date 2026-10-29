// Runs a TypeScript script against the workspace's TypeScript-source packages.
// Usage: node scripts/run-ts.mjs <script.ts>
//
// Node's own type stripping cannot resolve the packages' extensionless imports, so jiti
// loads the script. jiti does not apply the `react-server` condition, so `server-only`
// (which throws outside a React Server Components build) is aliased to its empty module,
// as `src/server/model.test.ts` does with `vi.mock`.
import { createRequire } from "node:module";
import path from "node:path";
import { createJiti } from "jiti";

const script = process.argv[2];
if (!script) {
  console.error("Usage: node scripts/run-ts.mjs <script.ts>");
  process.exit(1);
}

const require = createRequire(import.meta.url);
const serverOnlyEmpty = path.join(path.dirname(require.resolve("server-only")), "empty.js");
const jiti = createJiti(import.meta.url, { alias: { "server-only": serverOnlyEmpty } });

await jiti.import(path.resolve(script));
