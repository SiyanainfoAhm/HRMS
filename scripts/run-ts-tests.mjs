// Runs every *.test.ts / *.test.mjs under src with tsx / node and fails if any fails.
// Usage: node scripts/run-ts-tests.mjs   (or: npm test)
import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("../src", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const tsxCli = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
const files = walk(root).filter((f) => /\.test\.(ts|mjs)$/.test(f)).sort();
const failed = [];
for (const file of files) {
  const isTs = file.endsWith(".ts");
  // tsx is a pinned devDependency: run it from node_modules, never through npx (no registry access).
  const args = isTs ? [tsxCli, file] : [file];
  const result = spawnSync(process.execPath, args, { stdio: "pipe", encoding: "utf8" });
  const label = relative(process.cwd(), file);
  if (result.status === 0) {
    console.log(`ok    ${label}`);
  } else {
    failed.push(label);
    console.log(`FAIL  ${label}\n${result.stdout}\n${result.stderr}`);
  }
}
console.log(`\n${files.length - failed.length}/${files.length} test files passed`);
process.exit(failed.length === 0 ? 0 : 1);
