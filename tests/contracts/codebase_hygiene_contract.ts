import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const activeDocs = {
  "CLAUDE.md": readFileSync("CLAUDE.md", "utf8"),
  "README.md": readFileSync("README.md", "utf8"),
  "CONTEXT.md": readFileSync("CONTEXT.md", "utf8"),
  "apps/admin-web/src/pages/docs/documentationIntroContent.tsx": readFileSync("apps/admin-web/src/pages/docs/documentationIntroContent.tsx", "utf8"),
  "docs/architecture/maple-platform-architecture.md": readFileSync("docs/architecture/maple-platform-architecture.md", "utf8")
};
const migrations = {
  "migrations/migrate_model_config_global.mjs": readFileSync("migrations/migrate_model_config_global.mjs", "utf8"),
  "migrations/migrate_tenancy_hardening.mjs": readFileSync("migrations/migrate_tenancy_hardening.mjs", "utf8")
};
const gitignore = readFileSync(".gitignore", "utf8");
const eslintConfig = readFileSync("eslint.config.js", "utf8");

assert.equal(existsSync("apps/control-plane-api/src/infra/mysql_child.mjs"), true, "mysql helper must live under infra");
assert.equal(gitignore.includes(".codex/"), true, ".codex local agent config should stay ignored");
assert.equal(existsSync("apps/admin-web/src/components/shared/AppShared.tsx"), false, "shared UI barrel should stay removed");
assert.equal(eslintConfig.includes("max-lines': 'off'"), false, "max-lines should not have stale exemptions");

for (const [path, source] of Object.entries(activeDocs)) {
  for (const forbidden of ["server/index.ts", "server/store.ts", "server/web.ts", "server/mysql_child.mjs"]) {
    assert.equal(source.includes(forbidden), false, `${path} should not point agents at removed ${forbidden}`);
  }
}

for (const [path, source] of Object.entries(migrations)) {
  assert.match(
    source,
    /from "\.\.\/apps\/control-plane-api\/src\/infra\/mysql_child\.mjs"/,
    `${path} should import the live mysql helper`
  );
  assert.equal(source.includes("../apps/control-plane-api/src/mysql_child.mjs"), false, `${path} should not import removed root shim`);
}

const trackedFiles = spawnSync("git", ["ls-files", "scripts", "migrations", "README.md", "CLAUDE.md", "CONTEXT.md"], {
  encoding: "utf8"
}).stdout.trim().split("\n").filter(Boolean);

for (const path of trackedFiles) {
  const source = readFileSync(path, "utf8");
  assert.equal(source.includes("../server/mysql_child.mjs"), false, `${path} should not reference removed server/mysql_child.mjs`);
}

const adminSourceFiles = spawnSync("git", ["ls-files", "apps/admin-web/src"], {
  encoding: "utf8"
}).stdout.trim().split("\n").filter((path) => /\.(ts|tsx)$/.test(path));

for (const path of adminSourceFiles) {
  if (!existsSync(path)) continue;
  const source = readFileSync(path, "utf8");
  assert.equal(source.includes("components/shared/AppShared"), false, `${path} should import focused shared modules`);
}

console.log("codebase hygiene contract passed");
