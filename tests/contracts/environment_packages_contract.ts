import assert from "node:assert/strict";
import { normalizeEnvironmentPackages, normalizeSandboxConfig } from "../../apps/control-plane-api/src/runtime/sandboxConfig";

// normalizeEnvironmentPackages tolerates both stored shapes and drops blanks
{
  const fromObjects = normalizeEnvironmentPackages({ packages: [{ manager: "pip", name: "requests==2.0" }, { manager: "npm", name: "" }] });
  assert.deepEqual(fromObjects, [{ manager: "pip", name: "requests==2.0" }], "object-shaped packages keep non-blank entries");

  const fromTuples = normalizeEnvironmentPackages({ packages: [["pip", "numpy"], ["", "  "]] as unknown[] });
  assert.deepEqual(fromTuples, [{ manager: "pip", name: "numpy" }], "tuple-shaped packages normalize and drop blank names");

  const missingManager = normalizeEnvironmentPackages({ packages: [{ name: "cowsay" }] });
  assert.deepEqual(missingManager, [{ manager: "pip", name: "cowsay" }], "manager defaults to pip");

  assert.deepEqual(normalizeEnvironmentPackages({}), [], "no packages -> empty");
}

// vefaas sandbox config carries packages through normalization (the end-to-end gap this closes)
{
  const config = normalizeSandboxConfig({
    sandbox: { provider: "vefaas", vefaas: { function_id: "fn", gateway_url: "https://gw" } },
    packages: [{ manager: "pip", name: "pandas" }, { manager: "apt", name: "jq" }]
  });
  assert.equal(config.sandbox.provider, "vefaas");
  if (config.sandbox.provider !== "vefaas") throw new Error("expected vefaas sandbox");
  assert.deepEqual(config.sandbox.packages, [{ manager: "pip", name: "pandas" }, { manager: "apt", name: "jq" }], "vefaas sandbox carries packages");
}

// absent packages normalize to an empty list, never undefined
{
  const config = normalizeSandboxConfig({ sandbox: { provider: "vefaas", vefaas: { function_id: "fn", gateway_url: "https://gw" } } });
  if (config.sandbox.provider !== "vefaas") throw new Error("expected vefaas sandbox");
  assert.deepEqual(config.sandbox.packages, [], "missing packages -> empty array");
}

console.log("environment_packages_contract: OK");
