import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { loadProjectEnv } = await import("../../apps/control-plane-api/src/env");

const root = mkdtempSync(join(tmpdir(), "maple-project-env-"));
writeFileSync(
  join(root, "maple.config.yaml"),
  [
    "env:",
    "  MAPLE_ENV_CONTRACT_PROJECT: from-yaml",
    "  MAPLE_ENV_CONTRACT_YAML_ONLY: from-yaml-only",
    "  MAPLE_ENV_CONTRACT_KEEP: from-yaml",
    "  MAPLE_ALIYUN_REGION: cn-hangzhou",
    ""
  ].join("\n")
);
writeFileSync(
  join(root, ".env"),
  [
    "MAPLE_ENV_CONTRACT_PROJECT=from-project",
    "MAPLE_ENV_CONTRACT_KEEP=from-project",
    "export MAPLE_ENV_CONTRACT_EXPORTED=from-export",
    "MAPLE_ENV_CONTRACT_QUOTED=\"from quoted value\"",
    `MAPLE_SANDBOX_CONFIG=${join(root, "missing-sandbox.config.json")}`,
    "MAPLE_VEFAAS_REGION=cn-north-test",
    ""
  ].join("\n")
);

delete process.env.MAPLE_ENV_CONTRACT_PROJECT;
delete process.env.MAPLE_ENV_CONTRACT_EXPORTED;
delete process.env.MAPLE_ENV_CONTRACT_QUOTED;
delete process.env.MAPLE_ENV_CONTRACT_YAML_ONLY;
delete process.env.MAPLE_SANDBOX_CONFIG;
delete process.env.VEFAAS_REGION;
delete process.env.MAPLE_VEFAAS_REGION;
delete process.env.MAPLE_ALIYUN_REGION;
process.env.MAPLE_ENV_CONTRACT_KEEP = "from-shell";

const loaded = loadProjectEnv({ cwd: root });

assert.equal(loaded.path, join(root, ".env"));
assert.equal(process.env.MAPLE_ENV_CONTRACT_PROJECT, "from-project");
assert.equal(process.env.MAPLE_ENV_CONTRACT_YAML_ONLY, "from-yaml-only");
assert.equal(process.env.MAPLE_ENV_CONTRACT_EXPORTED, "from-export");
assert.equal(process.env.MAPLE_ENV_CONTRACT_QUOTED, "from quoted value");
assert.equal(process.env.MAPLE_ENV_CONTRACT_KEEP, "from-shell");
assert.deepEqual(
  loaded.loaded.sort(),
  [
    "MAPLE_ENV_CONTRACT_EXPORTED",
    "MAPLE_ENV_CONTRACT_PROJECT",
    "MAPLE_ENV_CONTRACT_QUOTED",
    "MAPLE_ENV_CONTRACT_YAML_ONLY",
    "MAPLE_ALIYUN_REGION",
    "MAPLE_SANDBOX_CONFIG",
    "MAPLE_VEFAAS_REGION"
  ].sort()
);
assert.deepEqual(loaded.skipped.sort(), ["MAPLE_ENV_CONTRACT_KEEP"].sort());

const { getSandboxDefaults } = await import("../../apps/control-plane-api/src/sandboxConfig");
assert.equal(getSandboxDefaults().vefaas.region, "cn-north-test");
assert.equal(getSandboxDefaults().aliyun_fc.region, "cn-hangzhou");

delete process.env.VEFAAS_REGION;
delete process.env.MAPLE_VEFAAS_REGION;
process.env.MAPLE_SANDBOX_CONFIG = join(root, "missing-default-sandbox.config.json");
assert.equal(getSandboxDefaults().vefaas.region, "cn-beijing");

process.env.MAPLE_SANDBOX_PROVIDER = "vefaas";
delete process.env.MAPLE_AGENT_RUNTIME_PROVIDER;
delete process.env.MAPLE_AGENT_PROVIDER;
const vefaasSandboxDefaults = getSandboxDefaults();
assert.equal(vefaasSandboxDefaults.default_provider, "vefaas");
assert.equal(vefaasSandboxDefaults.default_agent_runtime_provider, "local");
assert.equal(vefaasSandboxDefaults.vefaas_sandbox.region, "cn-beijing");
delete process.env.MAPLE_SANDBOX_PROVIDER;

console.log("project .env contract passed");
