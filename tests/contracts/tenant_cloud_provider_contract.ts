import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFakeVefaasRuntimeDeployScript } from "./helpers/fakeVefaasDeploy";

const dataDir = mkdtempSync(join(tmpdir(), "maple-tenant-cloud-provider-"));
const deployScript = writeFakeVefaasRuntimeDeployScript(dataDir, "https://example.invalid/maple-runtime");
const port = 23_000 + Math.floor(Math.random() * 2000);
const apiBase = `http://127.0.0.1:${port}`;
const stamp = Date.now().toString(36);

const server = spawn("bun", ["apps/control-plane-api/src/index.ts"], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", MAPLE_DATA_DIR: dataDir, MAPLE_VEFAAS_RUNTIME_DEPLOY_SCRIPT: deployScript, MAPLE_DEV_LOGIN: "true" },
  stdio: ["ignore", "pipe", "pipe"]
});
let serverOutput = "";
server.stdout.on("data", (chunk) => (serverOutput += String(chunk)));
server.stderr.on("data", (chunk) => (serverOutput += String(chunk)));

try {
  await waitForHealth();
  const user = await login(`cloud-${stamp}@example.com`);
  const onboarded = await postJson("/v1/workspace_onboarding", user.cookie, {
    tenant: { name: `Cloud ${stamp}` },
    workspace: { name: `Cloud ${stamp}`, slug: `cloud-${stamp}` },
    runtime_provider: "vefaas",
    sandbox_provider: "e2b",
    runtime_pool: { desired_size: 1, min_instances_per_function: 0, max_instances_per_function: 1, max_concurrency_per_instance: 1, cpu_milli: 250, memory_mb: 512 },
    sandbox_config: {},
    sandbox_pool: { desired_size: 1, standby_ttl_ms: 60_000 },
    model_config_ids: [],
    api_key: { display_name: "contract", scopes: ["control_plane"] },
    provider_credentials: { vefaas: { VOLCENGINE_ACCESS_KEY: "onboard-ak", VOLCENGINE_SECRET_KEY: "onboard-sk", VEFAAS_REGION: "cn-beijing" }, e2b: { E2B_API_KEY: "e2b-key" } }
  });
  const tenantId = onboarded.tenant.id as string;

  const saved = await postJson(`/v1/tenants/${tenantId}/cloud_providers/volcengine`, user.cookie, { access_key: "tenant-ak-1234", secret_key: "tenant-sk-5678", region: "cn-shanghai" });
  assert.equal(saved.provider, "volcengine");
  assert.equal(saved.connected, true);
  assert.equal(saved.region, "cn-shanghai");
  assert.equal(saved.credentials, undefined, "tenant cloud provider response must not leak AK/SK");

  const providers = await getJson(`/v1/tenants/${tenantId}/cloud_providers`, user.cookie);
  assert.equal(providers.data.length, 1);
  assert.equal(providers.data[0].provider, "volcengine");
  assert.equal(providers.data[0].credentials, undefined, "tenant cloud provider listing must not leak AK/SK");

  const created = await postJson("/v1/workspaces", user.cookie, {
    tenant_id: tenantId,
    workspace: { name: `Second ${stamp}`, slug: `cloud-${stamp}-second` },
    runtime_provider: "vefaas",
    sandbox_provider: "daytona",
    runtime_pool: { desired_size: 1, min_instances_per_function: 0, max_instances_per_function: 1, max_concurrency_per_instance: 1, cpu_milli: 250, memory_mb: 512 },
    sandbox_config: { daytona: { server_url: "https://daytona.example.invalid", api_key: "daytona-key" } },
    sandbox_pool: { desired_size: 1, standby_ttl_ms: 60_000 },
    model_config_ids: [],
    api_key: { display_name: "second", scopes: ["control_plane"] },
    provider_credentials: {}
  });
  assert.equal(created.workspace.runtime_provider, "vefaas", "workspace creation should reuse tenant-level Volcengine credentials");
  assert.equal(created.workspace.sandbox_provider, "daytona", "Daytona sandbox provider should be accepted as an independent provider");
} finally {
  server.kill("SIGTERM");
}

async function waitForHealth() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try { const response = await fetch(`${apiBase}/health`); if (response.ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`server did not become healthy: ${serverOutput}`);
}
async function login(email: string) {
  const response = await fetch(`${apiBase}/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "local", email, name: email.split("@")[0] }) });
  assert.equal(response.status, 200, await response.text());
  return { ...(await response.json()), cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "" };
}
async function getJson(path: string, cookie: string) {
  const response = await fetch(`${apiBase}${path}`, { headers: { cookie } });
  assert.equal(response.status, 200, await response.text());
  return response.json() as Promise<any>;
}
async function postJson(path: string, cookie: string, body: unknown) {
  const response = await fetch(`${apiBase}${path}`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) });
  assert.ok(response.status >= 200 && response.status < 300, await response.text());
  return response.json() as Promise<any>;
}
