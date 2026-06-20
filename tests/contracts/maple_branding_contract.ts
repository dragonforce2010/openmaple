import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const app = [
  "apps/admin-web/src/App.tsx",
  "apps/admin-web/src/AppFrame.tsx",
  "apps/admin-web/src/appConfig.ts",
  "apps/admin-web/src/config/i18n.ts",
  "apps/admin-web/src/pages/sessions/SessionViews.tsx",
  "apps/admin-web/src/pages/sessions/AskMapleDrawer.tsx",
  "apps/admin-web/src/components/shared/code.tsx",
  "apps/admin-web/src/components/shared/events.tsx",
  "apps/admin-web/src/components/shared/forms.tsx",
  "apps/admin-web/src/components/shared/labels.tsx",
  "apps/admin-web/src/components/shared/layout.tsx",
  "apps/admin-web/src/components/shared/misc.ts",
  "apps/admin-web/src/pages/docs/DocumentationView.tsx",
  "apps/admin-web/src/pages/docs/documentationIntroContent.tsx",
  "apps/admin-web/src/pages/docs/documentationSdkContent.tsx"
].map((path) => readFileSync(path, "utf8")).join("\n");
const sdk = readFileSync("packages/sdk/index.mjs", "utf8");
const sdkTypes = readFileSync("packages/sdk/index.d.ts", "utf8");
const cli = [
  "packages/cli/maple.mjs",
  "packages/cli/main.go",
  "packages/cli/cmd/root.go",
  "packages/cli/cmd/api.go",
  "packages/cli/cmd/agent.go",
  "packages/cli/cmd/environment.go",
  "packages/cli/cmd/session_command.go",
  "packages/cli/cmd/vault.go",
  "packages/cli/cmd/workspace.go",
  "packages/cli/cmd/model_config.go",
  "packages/cli/cmd/mcp.go",
  "packages/cli/cmd/memory.go",
  "packages/cli/cmd/platform_resources.go",
  "packages/cli/cmd/skill.go",
  "packages/cli/skills/maple-managed-agent/SKILL.md"
].map((path) => readFileSync(path, "utf8")).join("\n");
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const html = readFileSync("apps/admin-web/index.html", "utf8");
const readme = readFileSync("README.md", "utf8");

for (const forbidden of [
  "Claude Console",
  "Ask Claude",
  "Managed Agents Login",
  "Managed Agents 登录",
  "from anthropic import",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_BASE_URL"
]) {
  assert.equal(app.includes(forbidden), false, `src/App.tsx should not expose ${forbidden}`);
}

assert.match(app, /Maple/);
assert.match(app, /OpenMaple/);
assert.match(app, /Ask Maple/);
assert.match(app, /MapleClient/);
assert.match(app, /MAPLE_API_KEY/);
assert.match(html, /Maple/);

assert.match(sdk, /class MapleClient/);
assert.match(sdkTypes, /class MapleClient/);
assert.equal(sdk.includes("ManagedAgentsClient"), false, "SDK implementation should not export old ManagedAgentsClient alias");
assert.equal(sdkTypes.includes("ManagedAgentsClient"), false, "SDK types should not export old ManagedAgentsClient alias");
assert.equal(sdk.includes("MAGCLI_"), false, "SDK implementation should not read MAGCLI_* env vars");
assert.equal(cli.includes("MAGCLI_"), false, "Maple CLI should not read MAGCLI_* env vars");
assert.equal(cli.includes("magcli"), false, "Maple CLI source should not expose the old magcli name");
assert.equal(cli.includes("mag.manifest.json"), false, "Maple CLI should generate maple.manifest.json");
assert.equal(cli.includes(".mag/build"), false, "Maple CLI should build into .maple/build");

assert.equal(pkg.name, "openmaple");
assert.equal(pkg.bin?.maple, "packages/cli/maple.mjs");
assert.equal(pkg.bin?.magcli, undefined, "package bin should not expose magcli");
assert.equal(pkg.scripts?.maple, "bun packages/cli/maple.mjs");
assert.equal(pkg.scripts?.magcli, undefined, "package scripts should not expose magcli");
const cliPkg = JSON.parse(readFileSync("packages/cli/package.json", "utf8"));
assert.equal(cliPkg.private, false, "Maple CLI package must be publishable to npm");
assert.equal(cliPkg.bin?.maple, "maple.mjs");
assert.ok(cliPkg.files?.includes("cmd"), "Maple CLI npm package must include Go command sources");
assert.ok(cliPkg.files?.includes("internal"), "Maple CLI npm package must include Go internal sources");
assert.ok(cliPkg.files?.includes("skills"), "Maple CLI npm package must include embedded skill sources");
assert.equal(existsSync("scripts/magcli.mjs"), false, "old scripts/magcli.mjs entrypoint should be removed");
assert.equal(existsSync("docs/product-manual/magcli-sdk-onboarding.md"), false, "old magcli onboarding doc path should be removed");
assert.match(cli, /Maple CLI/);
assert.match(cli, /~\/.maple\/config.json/);
for (const command of [
  "agent",
  "environment",
  "session",
  "vault",
  "workspace",
  "model-config",
  "mcp",
  "memory-store",
  "api <METHOD> <path>"
]) {
  assert.match(cli, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `Maple CLI should expose ${command}`);
}

for (const [label, content] of [["README", readme]] as const) {
  for (const forbidden of ["magcli", "scripts/magcli", "ManagedAgentsClient", "MAGCLI_", "mag.manifest.json", ".mag/build"]) {
    assert.equal(content.includes(forbidden), false, `${label} should not mention ${forbidden}`);
  }
}

console.log("maple branding contract passed");
