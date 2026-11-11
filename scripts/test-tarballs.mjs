/**
 * Checks what a consumer really gets, which the workspace's own tests cannot: they run TypeScript
 * source, and never the published files. So this packs each package, installs the tarballs with npm
 * in a project outside the repository, type-checks a consumer under both module modes, and runs it.
 *
 *   pnpm test:tarballs
 *
 * It needs network access to install, so it runs in CI and not in `pnpm verify`. `--keep` leaves the
 * project in place and prints where it is, to look around after a failure.
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const PACKAGES = ["core", "ai", "source-github", "source-remote"];
/** Module settings a consumer might use: one for Node without a bundler, and one for a bundler. */
const MODULE_MODES = [
  { module: "NodeNext", moduleResolution: "NodeNext" },
  { module: "ESNext", moduleResolution: "Bundler" },
];
const UNWANTED_IN_TARBALL = /\.test\.|fixtures|tsconfig/;
const REQUIRED_IN_TARBALL = [
  "package/package.json",
  "package/README.md",
  "package/LICENSE",
  // Source and the maps that point at it, for consumers' stack traces and "Go to Definition".
  "package/src/index.ts",
  "package/dist/index.js.map",
  "package/dist/index.d.ts.map",
];

const repo = path.resolve(import.meta.dirname, "..");
const root = mkdtempSync(path.join(tmpdir(), "promptfolio-tarballs-"));
const tarballs = path.join(root, "tarballs");
const project = path.join(root, "project");
mkdirSync(tarballs);
mkdirSync(project);

function run(command, cwd) {
  console.log(`\n$ ${command}`);
  execSync(command, { cwd, stdio: "inherit" });
}

/** Quotes a path for the shell. Temporary folders can hold spaces. */
const quoted = (value) => JSON.stringify(value);

function tarballPath(name) {
  return path.join(tarballs, `promptfolio-${name}-${version(name)}.tgz`);
}

function manifest(name) {
  return JSON.parse(readFileSync(path.join(repo, "packages", name, "package.json"), "utf8"));
}

function version(name) {
  return manifest(name).version;
}

function checkContents(name) {
  const files = execSync(`tar -tzf ${quoted(path.basename(tarballPath(name)))}`, {
    cwd: tarballs,
    encoding: "utf8",
  })
    .split(/\r?\n/)
    .filter(Boolean);
  for (const file of REQUIRED_IN_TARBALL) assert.ok(files.includes(file), `${name}: no ${file}`);
  assert.ok(files.includes("package/dist/index.js"), `${name}: no compiled entry point`);
  assert.ok(files.includes("package/dist/index.d.ts"), `${name}: no declarations`);
  const unwanted = files.filter((file) => UNWANTED_IN_TARBALL.test(file));
  assert.deepEqual(unwanted, [], `${name}: files a consumer should not get`);
  console.log(`${name}: ${files.length} files, as expected`);
}

try {
  // In dependency order, because `prepack` builds each package against the one before it.
  for (const name of PACKAGES) {
    run(`pnpm pack --pack-destination ${quoted(tarballs)}`, path.join(repo, "packages", name));
  }
  for (const name of PACKAGES) checkContents(name);

  copyFileSync(
    path.join(repo, "scripts", "tarball-consumer", "consumer.ts"),
    path.join(project, "consumer.ts"),
  );
  writeFileSync(
    path.join(project, "package.json"),
    JSON.stringify({ name: "outside-consumer", private: true, type: "module" }),
  );
  const installs = [
    ...PACKAGES.map((name) => quoted(tarballPath(name))),
    quoted(`ai@${catalogVersion("ai")}`),
    "typescript@7",
    "@types/node@24",
    // The AI SDK's own types need this, and `skipLibCheck` stays off so ours are checked too.
    "@types/json-schema@7",
  ];
  run(`npm install --no-audit --no-fund ${installs.join(" ")}`, project);

  for (const mode of MODULE_MODES) {
    writeFileSync(
      path.join(project, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          ...mode,
          noEmit: true,
          strict: true,
          target: "ES2023",
          lib: ["ES2023", "DOM", "DOM.Iterable"],
          types: ["node"],
          skipLibCheck: false,
        },
        files: ["consumer.ts"],
      }),
    );
    run("npx --no-install tsc -p tsconfig.json", project);
    console.log(`Type-checked under ${mode.moduleResolution}`);
  }

  run("node --no-warnings consumer.ts", project);
  console.log(`\nTarballs work outside the workspace, on Node ${process.version}.`);
} finally {
  if (process.argv.includes("--keep")) console.log(`\nKept: ${project}`);
  else rmSync(root, { recursive: true, force: true });
}

/** A dependency's range from the workspace catalog, which a tarball's consumer gets as written. */
function catalogVersion(name) {
  const workspace = readFileSync(path.join(repo, "pnpm-workspace.yaml"), "utf8");
  const match = workspace.match(new RegExp(`^\\s*"?${name}"?:\\s*(\\S+)\\s*$`, "m"));
  assert.ok(match, `${name} is not in the catalog`);
  return match[1];
}
