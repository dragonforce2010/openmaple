import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string>; packageManager?: string };
const scripts = packageJson.scripts ?? {};
const dependencies = { ...(packageJson as { dependencies?: Record<string, string> }).dependencies, ...(packageJson as { devDependencies?: Record<string, string> }).devDependencies };

assert.equal(packageJson.packageManager?.startsWith("bun@"), true, "package.json must declare Bun as the package manager");
assert.equal(existsSync("bun.lock"), true, "bun.lock must exist");
assert.equal(existsSync("package-lock.json"), false, "package-lock.json must not be the active project lockfile");
assert.equal(dependencies["better-sqlite3"], undefined, "Bun runtime must not depend on legacy local database packages");
assert.equal(existsSync("vite.config.ts"), false, "Bun frontend must not keep vite.config.ts");
assert.equal(existsSync("apps/admin-web/vite.config.ts"), true, "admin-web must own the Vite config in the monorepo");

for (const [name, command] of Object.entries(scripts)) {
  assert.doesNotMatch(command, /\bnpm\s+run\b/, `${name} must use bun run instead of npm run`);
  if (name === "smoke:local") {
    assert.match(command, /^node scripts\/local-trial-smoke\.mjs$/, "smoke:local must stay Node-only for Docker Compose and Codespaces trials");
  } else {
    assert.doesNotMatch(command, /\bnode\s+scripts\//, `${name} must use bun for project scripts`);
  }
  assert.doesNotMatch(command, /\btsx\b/, `${name} must use bun for TypeScript entrypoints`);
}

const e2e = readFileSync("tests/e2e/e2e.mjs", "utf8");
assert.match(e2e, /spawn\("bun",\s*\["run",\s*script\]/, "E2E auto-start must spawn bun run <script>");
assert.doesNotMatch(e2e, /spawn\("npm"/, "E2E auto-start must not spawn npm");

console.log("bun runtime contract passed");
